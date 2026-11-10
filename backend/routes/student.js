const express = require('express');
const router = express.Router();
const db = require('../config/db');
const upload = require('../config/upload');
const { isAuthenticated, hasRole } = require('../middleware/auth');
const {
  getTodayIST,
  getDayOfWeekIST,
  isWithinMealWindow,
  canSkipMeal,
  MEAL_SCHEDULE
} = require('../utils/time');

// All routes require student role
router.use(isAuthenticated, hasRole('student'));

/**
 * Helper to fetch key-value map of mess settings
 */
async function getSettingsMap() {
  const [rows] = await db.query('SELECT setting_key, setting_value FROM mess_settings');
  const map = {
    breakfast_price: 30,
    lunch_price: 50,
    snacks_price: 15,
    dinner_price: 50,
    sunday_opt_in: 'true',
    skip_cutoff_minutes: 60
  };
  rows.forEach(r => {
    map[r.setting_key] = r.setting_value;
  });
  return map;
}

/**
 * GET /api/student/settings
 * Get current public mess settings (prices, sunday opt-in, cutoff)
 */
router.get('/settings', async (req, res) => {
  try {
    const settings = await getSettingsMap();
    return res.status(200).json({ settings });
  } catch (err) {
    console.error('Settings fetch error:', err);
    return res.status(500).json({ error: 'Failed to load mess settings.' });
  }
});

/**
 * 1. GET /api/student/menu
 * Return full weekly menu
 */
router.get('/menu', async (req, res) => {
  try {
    const [menu] = await db.query(
      `SELECT id, day_of_week, meal_type, items, updated_at
       FROM menu
       ORDER BY FIELD(day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'),
                FIELD(meal_type, 'breakfast','lunch','snacks','dinner')`
    );
    return res.status(200).json({ menu });
  } catch (err) {
    console.error('Menu error:', err);
    return res.status(500).json({ error: 'Failed to retrieve menu.' });
  }
});

/**
 * 2. GET /api/student/menu/today
 * Return today's menu (based on IST day of week)
 */
router.get('/menu/today', async (req, res) => {
  try {
    const todayDay = getDayOfWeekIST();
    const [menu] = await db.query(
      `SELECT id, day_of_week, meal_type, items, updated_at
       FROM menu
       WHERE day_of_week = ?
       ORDER BY FIELD(meal_type, 'breakfast','lunch','snacks','dinner')`,
      [todayDay]
    );
    return res.status(200).json({ day: todayDay, menu });
  } catch (err) {
    console.error('Today menu error:', err);
    return res.status(500).json({ error: "Failed to retrieve today's menu." });
  }
});

/**
 * 3. POST /api/student/coupons/buy
 * Buy coupons for a date range
 * Accepts JSON or multipart/form-data (for screenshot upload)
 */
router.post('/coupons/buy', upload.single('screenshot'), async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    let { start_date, end_date, meals_selected, includes_sunday, payment_method } = req.body;
    const studentId = req.session.user.id;

    if (!start_date || !end_date || !meals_selected || !payment_method) {
      await connection.rollback();
      return res.status(400).json({ error: 'Missing required fields: start_date, end_date, meals_selected, payment_method.' });
    }

    // Parse meals_selected if passed as JSON string
    if (typeof meals_selected === 'string') {
      try {
        meals_selected = JSON.parse(meals_selected);
      } catch (e) {
        await connection.rollback();
        return res.status(400).json({ error: 'Invalid meals_selected JSON format.' });
      }
    }

    const todayIST = getTodayIST();
    if (start_date < todayIST) {
      await connection.rollback();
      return res.status(400).json({ error: 'Start date cannot be in the past.' });
    }

    if (end_date < start_date) {
      await connection.rollback();
      return res.status(400).json({ error: 'End date must be on or after start date.' });
    }

    const isSundayIncluded = (includes_sunday === true || includes_sunday === 'true' || includes_sunday === '1');

    // Edge case guard: check for existing pending or verified order overlapping date range
    const [overlapOrders] = await connection.query(
      `SELECT o.id FROM coupon_orders o
       JOIN payments p ON o.payment_id = p.id
       WHERE o.student_id = ?
         AND p.status IN ('pending', 'verified')
         AND (o.start_date <= ? AND o.end_date >= ?)
       LIMIT 1`,
      [studentId, end_date, start_date]
    );

    if (overlapOrders.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        error: 'You already have an active, pending, or verified coupon order overlapping this date range.'
      });
    }

    // Calculate total amount based on mess_settings
    const settings = await getSettingsMap();
    const prices = {
      breakfast: parseFloat(settings.breakfast_price) || 30,
      lunch: parseFloat(settings.lunch_price) || 50,
      snacks: parseFloat(settings.snacks_price) || 15,
      dinner: parseFloat(settings.dinner_price) || 50
    };

    let totalAmount = 0;
    const start = new Date(`${start_date}T00:00:00`);
    const end = new Date(`${end_date}T00:00:00`);
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayName = dayNames[d.getDay()];
      if (dayName === 'Sunday' && !isSundayIncluded) {
        continue;
      }
      const dayMeals = meals_selected[dayName] || [];
      dayMeals.forEach(meal => {
        if (prices[meal]) {
          totalAmount += prices[meal];
        }
      });
    }

    if (totalAmount <= 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'No meals selected or total calculated amount is 0.' });
    }

    const method = payment_method.toLowerCase();
    if (!['cash', 'online'].includes(method)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Payment method must be cash or online.' });
    }

    let screenshotPath = null;
    if (method === 'online') {
      if (!req.file) {
        await connection.rollback();
        return res.status(400).json({ error: 'Screenshot is required for online payments.' });
      }
      screenshotPath = `/uploads/${req.file.filename}`;
    }

    // 1. Create payment record (pending status)
    const [paymentResult] = await connection.query(
      `INSERT INTO payments (student_id, amount, method, screenshot_path, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [studentId, totalAmount, method, screenshotPath]
    );
    const paymentId = paymentResult.insertId;

    // 2. Create coupon order record
    const [orderResult] = await connection.query(
      `INSERT INTO coupon_orders (student_id, payment_id, start_date, end_date, meals_selected, includes_sunday)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [studentId, paymentId, start_date, end_date, JSON.stringify(meals_selected), isSundayIncluded]
    );

    await connection.commit();

    return res.status(201).json({
      message: 'Coupon order submitted successfully. Awaiting payment verification by admin.',
      order_id: orderResult.insertId,
      payment_id: paymentId,
      amount: totalAmount,
      status: 'pending'
    });
  } catch (err) {
    await connection.rollback();
    console.error('Coupon buy error:', err);
    return res.status(500).json({ error: 'Failed to process coupon purchase order.' });
  } finally {
    connection.release();
  }
});

/**
 * 4. GET /api/student/coupons
 * Return all coupons for logged-in student (optional filters: ?status=active&date=YYYY-MM-DD)
 */
router.get('/coupons', async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { status, date } = req.query;

    let sql = `
      SELECT id, student_id, meal_type, meal_date, source, status, claimed_at, created_at
      FROM coupons
      WHERE student_id = ?
    `;
    const params = [studentId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (date) {
      sql += ' AND meal_date = ?';
      params.push(date);
    }

    sql += ` ORDER BY meal_date DESC, FIELD(meal_type, 'breakfast','lunch','snacks','dinner')`;

    const [coupons] = await db.query(sql, params);
    return res.status(200).json({ coupons });
  } catch (err) {
    console.error('Get coupons error:', err);
    return res.status(500).json({ error: 'Failed to retrieve coupons.' });
  }
});

/**
 * 5. POST /api/student/coupons/:id/skip
 * Mark a coupon as "skipped"
 */
router.post('/coupons/:id/skip', async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const couponId = parseInt(req.params.id, 10);

    const [rows] = await db.query(
      'SELECT id, student_id, meal_type, meal_date, status FROM coupons WHERE id = ? AND student_id = ?',
      [couponId, studentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Coupon not found or does not belong to you.' });
    }

    const coupon = rows[0];

    if (coupon.status !== 'active') {
      return res.status(400).json({ error: `Cannot skip coupon with status '${coupon.status}'. Only active coupons can be skipped.` });
    }

    const settings = await getSettingsMap();
    const cutoffMinutes = parseInt(settings.skip_cutoff_minutes || '60', 10);

    // Formatted date string YYYY-MM-DD
    const mealDateStr = typeof coupon.meal_date === 'string'
      ? coupon.meal_date.substring(0, 10)
      : new Date(coupon.meal_date).toISOString().substring(0, 10);

    const check = canSkipMeal(mealDateStr, coupon.meal_type, cutoffMinutes);
    if (!check.allowed) {
      return res.status(400).json({ error: check.reason });
    }

    await db.query('UPDATE coupons SET status = "skipped" WHERE id = ?', [couponId]);

    return res.status(200).json({
      message: `Coupon for ${coupon.meal_type} on ${mealDateStr} marked as skipped successfully.`,
      coupon_id: couponId,
      status: 'skipped'
    });
  } catch (err) {
    console.error('Coupon skip error:', err);
    return res.status(500).json({ error: 'Failed to skip coupon.' });
  }
});

/**
 * 6. POST /api/student/leave
 * Apply for mess leave { start_date, end_date, reason }
 */
router.post('/leave', async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { start_date, end_date, reason } = req.body;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Please provide start_date and end_date.' });
    }

    const todayIST = getTodayIST();
    if (start_date < todayIST) {
      return res.status(400).json({ error: 'Leave start date cannot be in the past.' });
    }

    if (end_date < start_date) {
      return res.status(400).json({ error: 'End date must be on or after start date.' });
    }

    // Check overlapping leaves
    const [existingLeaves] = await db.query(
      `SELECT id FROM mess_leave
       WHERE student_id = ?
         AND status IN ('pending', 'approved')
         AND (start_date <= ? AND end_date >= ?)
       LIMIT 1`,
      [studentId, end_date, start_date]
    );

    if (existingLeaves.length > 0) {
      return res.status(400).json({
        error: 'You already have a pending or approved leave overlapping these dates.'
      });
    }

    const [result] = await db.query(
      `INSERT INTO mess_leave (student_id, start_date, end_date, reason, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [studentId, start_date, end_date, reason ? reason.trim() : null]
    );

    return res.status(201).json({
      message: 'Mess leave application submitted successfully.',
      leave_id: result.insertId,
      status: 'pending'
    });
  } catch (err) {
    console.error('Apply leave error:', err);
    return res.status(500).json({ error: 'Failed to submit leave request.' });
  }
});

/**
 * 7. GET /api/student/leave
 * View own leave requests
 */
router.get('/leave', async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const [leaves] = await db.query(
      `SELECT l.id, l.start_date, l.end_date, l.reason, l.status, l.created_at, u.name as approved_by_name
       FROM mess_leave l
       LEFT JOIN users u ON l.approved_by = u.id
       WHERE l.student_id = ?
       ORDER BY l.created_at DESC`,
      [studentId]
    );
    return res.status(200).json({ leaves });
  } catch (err) {
    console.error('Get leave error:', err);
    return res.status(500).json({ error: 'Failed to retrieve leave history.' });
  }
});

/**
 * 8. POST /api/student/complaints
 * Raise complaint { meal_type, category, description }
 * Auto-sets meal_date to today. Only allowed if current time is within meal window.
 */
router.post('/complaints', async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { meal_type, category, description, is_anonymous } = req.body;

    if (!meal_type || !category || !description) {
      return res.status(400).json({ error: 'Please provide meal_type, category, and description.' });
    }

    const validCategories = ['food_quality', 'hygiene', 'quantity', 'staff_behavior', 'other'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: 'Invalid complaint category.' });
    }

    const normalizedMeal = meal_type.toLowerCase();
    if (!MEAL_SCHEDULE[normalizedMeal]) {
      return res.status(400).json({ error: 'Invalid meal type.' });
    }

    // Only allowed if current IST time is within that meal's window
    if (!isWithinMealWindow(normalizedMeal)) {
      const schedule = MEAL_SCHEDULE[normalizedMeal];
      return res.status(400).json({
        error: `Complaints for ${normalizedMeal} can only be raised during its serving hours (${schedule.start} - ${schedule.end} IST).`
      });
    }

    const todayIST = getTodayIST();
    const anonFlag = Boolean(is_anonymous === true || is_anonymous === 'true');

    const [result] = await db.query(
      `INSERT INTO complaints (student_id, meal_date, meal_type, category, description, is_anonymous, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [studentId, todayIST, normalizedMeal, category, description.trim(), anonFlag]
    );

    return res.status(201).json({
      message: anonFlag ? 'Anonymous complaint submitted successfully.' : 'Complaint submitted successfully.',
      complaint_id: result.insertId,
      meal_date: todayIST,
      status: 'open'
    });
  } catch (err) {
    console.error('Complaint submit error:', err);
    return res.status(500).json({ error: 'Failed to submit complaint.' });
  }
});

/**
 * 9. GET /api/student/complaints
 * View own complaints
 */
router.get('/complaints', async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const [complaints] = await db.query(
      `SELECT c.id, c.meal_date, c.meal_type, c.category, c.description, c.is_anonymous, c.status,
              c.response, c.resolved_at, c.created_at, u.name as responded_by_name
       FROM complaints c
       LEFT JOIN users u ON c.responded_by = u.id
       WHERE c.student_id = ?
       ORDER BY c.created_at DESC`,
      [studentId]
    );
    return res.status(200).json({ complaints });
  } catch (err) {
    console.error('Get complaints error:', err);
    return res.status(500).json({ error: 'Failed to retrieve complaints.' });
  }
});

/**
 * 10. GET /api/student/payments
 * View own payment history
 */
router.get('/payments', async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const [payments] = await db.query(
      `SELECT p.id, p.amount, p.method, p.screenshot_path, p.status, p.notes, p.created_at,
              o.start_date, o.end_date, o.meals_selected, o.includes_sunday
       FROM payments p
       LEFT JOIN coupon_orders o ON p.id = o.payment_id
       WHERE p.student_id = ?
       ORDER BY p.created_at DESC`,
      [studentId]
    );
    return res.status(200).json({ payments });
  } catch (err) {
    console.error('Get payments error:', err);
    return res.status(500).json({ error: 'Failed to retrieve payments.' });
  }
});

/**
 * 11. GET /api/student/announcements
 * Fetch latest mess announcements / notices
 */
router.get('/announcements', async (req, res) => {
  try {
    const [announcements] = await db.query(
      `SELECT a.id, a.title, a.message, a.priority, a.created_at, u.name AS author_name
       FROM announcements a
       LEFT JOIN users u ON a.created_by = u.id
       ORDER BY a.created_at DESC
       LIMIT 8`
    );
    return res.status(200).json({ announcements });
  } catch (err) {
    console.error('Get announcements error:', err);
    return res.status(500).json({ error: 'Failed to fetch announcements.' });
  }
});

/**
 * 12. GET /api/student/ratings/today
 * Get logged-in student's ratings & community averages for today
 */
router.get('/ratings/today', async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const today = getTodayIST();

    const [mine] = await db.query(
      'SELECT meal_type, rating, comment FROM meal_ratings WHERE student_id = ? AND meal_date = ?',
      [studentId, today]
    );

    const [averages] = await db.query(
      `SELECT meal_type, ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS total_votes
       FROM meal_ratings
       WHERE meal_date = ?
       GROUP BY meal_type`,
      [today]
    );

    return res.status(200).json({ date: today, mine, averages });
  } catch (err) {
    console.error('Get today ratings error:', err);
    return res.status(500).json({ error: 'Failed to fetch meal ratings.' });
  }
});

/**
 * 13. POST /api/student/ratings
 * Submit or update meal rating (1-5) for today
 */
router.post('/ratings', async (req, res) => {
  try {
    const studentId = req.session.user.id;
    const { meal_type, rating, comment } = req.body;
    const normalizedMeal = (meal_type || '').toLowerCase();
    const numericRating = parseInt(rating, 10);

    if (!MEAL_SCHEDULE[normalizedMeal]) {
      return res.status(400).json({ error: 'Invalid meal type.' });
    }

    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5.' });
    }

    const today = getTodayIST();
    const cleanComment = comment ? String(comment).trim().slice(0, 255) : null;

    await db.query(
      `INSERT INTO meal_ratings (student_id, meal_date, meal_type, rating, comment)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = COALESCE(VALUES(comment), comment)`,
      [studentId, today, normalizedMeal, numericRating, cleanComment]
    );

    return res.status(200).json({
      message: `Rated today's ${normalizedMeal} ${numericRating}/5.`,
      meal_type: normalizedMeal,
      rating: numericRating
    });
  } catch (err) {
    console.error('Submit rating error:', err);
    return res.status(500).json({ error: 'Failed to save rating.' });
  }
});

module.exports = router;
