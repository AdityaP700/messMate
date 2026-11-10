const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { isAuthenticated, hasRole } = require('../middleware/auth');
const { getTodayIST } = require('../utils/time');
const { computeAnalytics } = require('../utils/analytics');

// All routes require superadmin role
router.use(isAuthenticated, hasRole('superadmin'));

/**
 * 1. GET /api/superadmin/admins
 * List all admin users
 */
router.get('/admins', async (req, res) => {
  try {
    const [admins] = await db.query(
      `SELECT id, roll_no, name, email, hostel, room_no, role, is_active, created_at
       FROM users
       WHERE role = 'admin'
       ORDER BY created_at DESC`
    );
    return res.status(200).json({ admins });
  } catch (err) {
    console.error('List admins error:', err);
    return res.status(500).json({ error: 'Failed to retrieve admin list.' });
  }
});

/**
 * 2. POST /api/superadmin/admins
 * Create a new admin { roll_no, name, email, password, hostel }
 */
router.post('/admins', async (req, res) => {
  try {
    const { roll_no, name, email, password, hostel, room_no } = req.body;

    if (!roll_no || !name || !email || !password || !hostel) {
      return res.status(400).json({ error: 'Please provide roll_no, name, email, password, and hostel.' });
    }

    const trimmedRoll = roll_no.trim().toUpperCase();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    const trimmedHostel = hostel.trim();
    const trimmedRoom = (room_no || '').trim();

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // Check unique roll_no or email
    const [existing] = await db.query(
      'SELECT id, roll_no, email FROM users WHERE roll_no = ? OR email = ? LIMIT 1',
      [trimmedRoll, trimmedEmail]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'User with this roll number or email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      `INSERT INTO users (roll_no, name, email, password_hash, hostel, room_no, role, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 'admin', TRUE)`,
      [trimmedRoll, trimmedName, trimmedEmail, passwordHash, trimmedHostel, trimmedRoom]
    );

    return res.status(201).json({
      message: 'New admin account created successfully.',
      admin: {
        id: result.insertId,
        roll_no: trimmedRoll,
        name: trimmedName,
        email: trimmedEmail,
        hostel: trimmedHostel,
        room_no: trimmedRoom,
        role: 'admin',
        is_active: true
      }
    });
  } catch (err) {
    console.error('Create admin error:', err);
    return res.status(500).json({ error: 'Failed to create admin user.' });
  }
});

/**
 * 3. DELETE /api/superadmin/admins/:id
 * Deactivate an admin (set is_active = false, don't hard delete)
 */
router.delete('/admins/:id', async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const currentUserId = req.session.user.id;

    if (targetId === currentUserId) {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }

    const [result] = await db.query(
      'UPDATE users SET is_active = FALSE WHERE id = ? AND role = "admin"',
      [targetId]
    );

    if (result.matchedRows === 0) {
      return res.status(404).json({ error: 'Admin account not found or cannot be modified.' });
    }

    return res.status(200).json({ message: 'Admin account deactivated successfully.' });
  } catch (err) {
    console.error('Deactivate admin error:', err);
    return res.status(500).json({ error: 'Failed to deactivate admin.' });
  }
});

/**
 * 4. GET /api/superadmin/settings
 * Return all mess_settings
 */
router.get('/settings', async (req, res) => {
  try {
    const [settings] = await db.query('SELECT id, setting_key, setting_value, updated_at FROM mess_settings ORDER BY id ASC');
    return res.status(200).json({ settings });
  } catch (err) {
    console.error('Get settings error:', err);
    return res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

/**
 * 5. PUT /api/superadmin/settings
 * Update settings { key, value } or { settings: { key: value, ... } }
 */
router.put('/settings', async (req, res) => {
  try {
    const { key, value, settings } = req.body;

    if (settings && typeof settings === 'object') {
      for (const [k, v] of Object.entries(settings)) {
        await db.query(
          `INSERT INTO mess_settings (setting_key, setting_value)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [k, String(v)]
        );
      }
      return res.status(200).json({ message: 'Settings updated successfully.' });
    }

    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Please provide setting key and value.' });
    }

    await db.query(
      `INSERT INTO mess_settings (setting_key, setting_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key, String(value)]
    );

    return res.status(200).json({ message: `Setting '${key}' updated to '${value}'.` });
  } catch (err) {
    console.error('Update settings error:', err);
    return res.status(500).json({ error: 'Failed to update settings.' });
  }
});

/**
 * 6. GET /api/superadmin/reports
 * List all daily reports, newest first
 */
router.get('/reports', async (req, res) => {
  try {
    const [reports] = await db.query('SELECT * FROM daily_reports ORDER BY report_date DESC LIMIT 60');
    return res.status(200).json({ reports });
  } catch (err) {
    console.error('List reports error:', err);
    return res.status(500).json({ error: 'Failed to retrieve daily reports.' });
  }
});

/**
 * 7. GET /api/superadmin/reports/:date
 * Get specific daily report
 */
router.get('/reports/:date', async (req, res) => {
  try {
    const date = req.params.date;
    const [reports] = await db.query('SELECT * FROM daily_reports WHERE report_date = ?', [date]);

    if (reports.length === 0) {
      return res.status(404).json({ error: `No generated report found for date ${date}.` });
    }

    return res.status(200).json({ report: reports[0] });
  } catch (err) {
    console.error('Get report error:', err);
    return res.status(500).json({ error: 'Failed to retrieve report for date.' });
  }
});

/**
 * 8. GET /api/superadmin/stats/overview
 * System-wide stats: total students, total revenue this month, total coupons sold, average daily attendance
 */
router.get('/stats/overview', async (req, res) => {
  try {
    // 1. Total students & admins
    const [userCounts] = await db.query(
      `SELECT
         SUM(CASE WHEN role = 'student' AND is_active = TRUE THEN 1 ELSE 0 END) AS total_students,
         SUM(CASE WHEN role = 'admin' AND is_active = TRUE THEN 1 ELSE 0 END) AS total_admins
       FROM users`
    );

    // 2. Revenue this month
    const today = getTodayIST();
    const firstDayOfMonth = today.substring(0, 8) + '01';
    const [revRows] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS month_revenue
       FROM payments
       WHERE status = 'verified' AND created_at >= ?`,
      [firstDayOfMonth]
    );

    // 3. Total coupons sold
    const [couponsRows] = await db.query('SELECT COUNT(*) AS total_coupons FROM coupons');

    // 4. Total meals served (used coupons)
    const [usedCouponsRows] = await db.query(
      `SELECT COUNT(*) AS total_used, COUNT(DISTINCT meal_date) AS distinct_days
       FROM coupons
       WHERE status = 'used'`
    );
    const totalUsed = usedCouponsRows[0].total_used || 0;
    const distinctDays = usedCouponsRows[0].distinct_days || 1;
    const avgDailyAttendance = Math.round(totalUsed / distinctDays);

    // 5. Complaints breakdown
    const [compRows] = await db.query(
      `SELECT
         COUNT(*) AS total_complaints,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_complaints,
         SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_complaints
       FROM complaints`
    );

    const today_analytics = await computeAnalytics(today);

    return res.status(200).json({
      total_students: userCounts[0].total_students || 0,
      total_admins: userCounts[0].total_admins || 0,
      this_month_revenue: parseFloat(revRows[0].month_revenue) || 0,
      total_coupons_sold: couponsRows[0].total_coupons || 0,
      total_meals_served: totalUsed,
      avg_daily_attendance: avgDailyAttendance,
      complaints: compRows[0],
      today_analytics
    });
  } catch (err) {
    console.error('Stats overview error:', err);
    return res.status(500).json({ error: 'Failed to retrieve overview statistics.' });
  }
});

module.exports = router;
