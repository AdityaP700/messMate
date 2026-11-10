const express = require('express');
const session = require('express-session');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const db = require('./config/db');
const { getTodayIST } = require('./utils/time');
const { ensureMessSchemaColumns } = require('./utils/messConfig');
const { seedMockData } = require('./scripts/seedMockData');

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const adminRoutes = require('./routes/admin');
const superadminRoutes = require('./routes/superadmin');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Trust reverse proxy (Railway / Render / Nginx) for secure cookies & rate-limit IP
app.set('trust proxy', 1);

// Security & Parsing Middleware
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'iiit_mess_secure_session_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Static files
const frontendPath = path.join(__dirname, '../frontend');
const uploadsPath = path.join(__dirname, '../uploads');

app.use(express.static(frontendPath));
app.use('/uploads', express.static(uploadsPath));

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/superadmin', superadminRoutes);

// Ensure base schema (for fresh PaaS DBs like Railway) and incremental tables/columns exist
async function ensureExtraTables() {
  try {
    const [tables] = await db.query(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
    );
    if (tables[0].cnt === 0) {
      const schemaSql = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
      const statements = schemaSql
        .replace(/--.*$/gm, '')
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !/^CREATE DATABASE/i.test(s) && !/^USE\s+/i.test(s));
      for (const stmt of statements) {
        await db.query(stmt);
      }
      console.log('[Init] Base schema and seed data initialized.');
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(120) NOT NULL,
        message TEXT NOT NULL,
        priority ENUM('info','important') DEFAULT 'info',
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_announcements_user FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS meal_ratings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        meal_date DATE NOT NULL,
        meal_type ENUM('breakfast','lunch','snacks','dinner') NOT NULL,
        rating TINYINT NOT NULL,
        comment VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_student_meal_rating (student_id, meal_date, meal_type),
        CONSTRAINT chk_rating_range CHECK (rating BETWEEN 1 AND 5),
        CONSTRAINT fk_ratings_student FOREIGN KEY (student_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    const [cols] = await db.query(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'complaints' AND COLUMN_NAME = 'is_anonymous'`
    );
    if (cols[0].cnt === 0) {
      await db.query('ALTER TABLE complaints ADD COLUMN is_anonymous BOOLEAN DEFAULT FALSE AFTER description');
    }

    await ensureMessSchemaColumns(db);

    const [annCount] = await db.query('SELECT COUNT(*) AS cnt FROM announcements');
    if (annCount[0].cnt === 0) {
      await db.query(
        `INSERT INTO announcements (title, message, priority)
         VALUES (?, ?, 'info')`,
        [
          'Welcome to the Digital Mess Portal',
          'Prepaid coupons, meal skips (60 min cutoff), leave pauses, and real-time meal ratings are now live.'
        ]
      );
    }

    const [userCount] = await db.query('SELECT COUNT(*) AS cnt FROM users');
    if (userCount[0].cnt <= 1 && process.env.DISABLE_DEMO_SEED !== 'true') {
      await seedMockData();
    }
  } catch (err) {
    console.error('[Init] Schema sync skipped:', err.code || '', err.message);
  }
}

// Maintenance helper: mark past active coupons as expired
async function expirePastCoupons() {
  try {
    const today = getTodayIST();
    const [result] = await db.query(
      `UPDATE coupons
       SET status = 'expired'
       WHERE status = 'active' AND meal_date < ?`,
      [today]
    );
    if (result.affectedRows > 0) {
      console.log(`[Maintenance] Expired ${result.affectedRows} overdue coupons.`);
    }
  } catch (err) {
    // If database is not yet ready or tables not created, log softly
    console.error('[Maintenance] Expire coupons check error:', err.code || '', err.message);
  }
}

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  if (res.headersSent) return next(err);

  const status = err.status || 500;
  const isApi = req.originalUrl.startsWith('/api');

  if (isApi) {
    return res.status(status).json({
      error: err.message || 'Internal Server Error'
    });
  }

  return res.status(status).send(`Error: ${err.message || 'Internal Server Error'}`);
});

// Start Express server if run directly
let server = null;
if (require.main === module) {
  server = app.listen(PORT, async () => {
    console.log(`====================================================`);
    console.log(` IIIT Bhubaneswar Mess Management System Backend `);
    console.log(` Server running on http://localhost:${PORT} `);
    console.log(` Environment: ${process.env.NODE_ENV || 'development'} `);
    console.log(`====================================================`);

    // Ensure incremental schema tables and run initial coupon expiration check
    await ensureExtraTables();
    await expirePastCoupons();

    // Schedule coupon expiration check every hour (unref so tests/scripts can exit cleanly)
    const maintenanceTimer = setInterval(expirePastCoupons, 60 * 60 * 1000);
    maintenanceTimer.unref();
  });
}

module.exports = { app, server, expirePastCoupons };
