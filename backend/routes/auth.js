const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authLimiter } = require('../middleware/rateLimiter');

// Rate limiting on login and register
router.use('/login', authLimiter);
router.use('/register', authLimiter);

/**
 * POST /api/auth/register
 * Student self-registration (role always 'student')
 */
router.post('/register', async (req, res) => {
  try {
    const { roll_no, name, email, password, hostel, room_no } = req.body;

    if (!roll_no || !name || !email || !password || !hostel) {
      return res.status(400).json({ error: 'Please provide roll number, name, email, password, and hostel.' });
    }

    const trimmedRoll = roll_no.trim().toUpperCase();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    const trimmedHostel = hostel.trim();
    const trimmedRoom = (room_no || '').trim();

    // Roll number format validation: college format alphanumeric 3-20 chars
    const rollRegex = /^[A-Z0-9_-]{3,20}$/;
    if (!rollRegex.test(trimmedRoll)) {
      return res.status(400).json({ error: 'Invalid roll number format. Use uppercase alphanumeric characters.' });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // Password validation: minimum 6 characters
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // Check if roll_no or email already taken
    const [existing] = await db.query(
      'SELECT id, roll_no, email FROM users WHERE roll_no = ? OR email = ? LIMIT 1',
      [trimmedRoll, trimmedEmail]
    );

    if (existing.length > 0) {
      if (existing[0].roll_no === trimmedRoll) {
        return res.status(409).json({ error: 'A student with this roll number is already registered.' });
      }
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    // Hash password with bcrypt (10 rounds)
    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      `INSERT INTO users (roll_no, name, email, password_hash, hostel, room_no, role, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 'student', TRUE)`,
      [trimmedRoll, trimmedName, trimmedEmail, passwordHash, trimmedHostel, trimmedRoom]
    );

    const newUser = {
      id: result.insertId,
      roll_no: trimmedRoll,
      name: trimmedName,
      email: trimmedEmail,
      hostel: trimmedHostel,
      room_no: trimmedRoom,
      role: 'student'
    };

    // Auto login after registration
    req.session.user = newUser;

    return res.status(201).json({
      message: 'Registration successful!',
      user: newUser
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'An error occurred during registration. Please try again.' });
  }
});

/**
 * POST /api/auth/login
 * Login with email or roll_no + password
 */
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Please enter your Roll Number / Email and password.' });
    }

    const trimmedIdentifier = identifier.trim();

    // Query user by email or roll_no (case-insensitive for email, uppercase for roll_no)
    const [rows] = await db.query(
      `SELECT id, roll_no, name, email, password_hash, hostel, room_no, role, is_active
       FROM users
       WHERE roll_no = ? OR email = ?
       LIMIT 1`,
      [trimmedIdentifier.toUpperCase(), trimmedIdentifier.toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials. User not found.' });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Your account has been deactivated. Please contact the administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials. Incorrect password.' });
    }

    const sessionUser = {
      id: user.id,
      roll_no: user.roll_no,
      name: user.name,
      email: user.email,
      hostel: user.hostel,
      room_no: user.room_no,
      role: user.role
    };

    req.session.user = sessionUser;

    return res.status(200).json({
      message: 'Login successful.',
      user: sessionUser
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
});

/**
 * POST /api/auth/logout
 * Destroy session and clear cookie
 */
router.post('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(err => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ error: 'Could not log out. Please try again.' });
      }
      res.clearCookie('connect.sid');
      return res.status(200).json({ message: 'Logged out successfully.' });
    });
  } else {
    return res.status(200).json({ message: 'Already logged out.' });
  }
});

/**
 * GET /api/auth/me
 * Return current logged-in user info
 */
router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  return res.status(200).json({ user: req.session.user });
});

module.exports = router;
