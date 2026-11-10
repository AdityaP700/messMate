const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isAuthenticated, hasRole } = require('../middleware/auth');
const {
  getTodayIST,
  getCurrentOrUpcomingMeal,
  MEAL_SCHEDULE
} = require('../utils/time');
const { computeAnalytics } = require('../utils/analytics');
const {
  VALID_MESS_CODES,
  VALID_ROUTING_TYPES,
  VALID_COMPLAINT_STATUSES,
  normalizeMessHall
} = require('../utils/messConfig');

// All routes require admin or superadmin
router.use(isAuthenticated, hasRole('admin', 'superadmin'));

/**
 * 1. GET /api/admin/students
 * List all students (with search by roll_no, name, hostel)
 */
router.get('/students', async (req, res) => {
  try {
    const { search, mess_hall } = req.query;
    let sql = `
      SELECT u.id, u.roll_no, u.name, u.email, u.hostel, u.mess_hall, u.room_no, u.is_active, u.created_at,
             (SELECT COUNT(*) FROM coupons c WHERE c.student_id = u.id AND c.status = 'active') AS active_coupons_count
      FROM users u
      WHERE u.role = 'student'
    `;
    const params = [];

    if (mess_hall && VALID_MESS_CODES.includes(mess_hall)) {
      sql += ' AND u.mess_hall = ?';
      params.push(mess_hall);
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      sql += ' AND (u.roll_no LIKE ? OR u.name LIKE ? OR u.hostel LIKE ? OR u.mess_hall LIKE ?)';
      params.push(q, q, q, q);
    }

    sql += ' ORDER BY u.roll_no ASC';

    const [students] = await db.query(sql, params);
    return res.status(200).json({ students });
  } catch (err) {
    console.error('List students error:', err);
    return res.status(500).json({ error: 'Failed to retrieve students list.' });
  }
});

/**
 * 2. PUT /api/admin/menu/:id
 * Update a menu item { items }
 */
router.put('/menu/:id', async (req, res) => {
  try {
    const menuId = parseInt(req.params.id, 10);
    const { items } = req.body;
    const adminId = req.session.user.id;

    if (!items || !items.trim()) {
      return res.status(400).json({ error: 'Menu items description cannot be empty.' });
    }

    const [result] = await db.query(
      'UPDATE menu SET items = ?, updated_by = ? WHERE id = ?',
      [items.trim(), adminId, menuId]
    );

    if (result.matchedRows === 0) {
      return res.status(404).json({ error: 'Menu entry not found.' });
    }

    const [updated] = await db.query('SELECT * FROM menu WHERE id = ?', [menuId]);
    return res.status(200).json({ message: 'Menu updated successfully.', menu: updated[0] });
  } catch (err) {
    console.error('Update menu error:', err);
    return res.status(500).json({ error: 'Failed to update menu item.' });
  }
});

/**
 * 3. GET /api/admin/payments/pending
 * List all pending payments with student info and order details
 */
router.get('/payments/pending', async (req, res) => {
  try {
    const [payments] = await db.query(
      `SELECT p.id, p.student_id, p.amount, p.method, p.screenshot_path, p.status, p.notes, p.created_at,
              u.roll_no, u.name AS student_name, u.hostel, u.mess_hall, u.room_no,
              o.id AS order_id, o.mess_hall AS order_mess_hall, o.start_date, o.end_date, o.meals_selected, o.includes_sunday
       FROM payments p
       JOIN users u ON p.student_id = u.id
       LEFT JOIN coupon_orders o ON p.id = o.payment_id
       WHERE p.status = 'pending'
       ORDER BY p.created_at ASC`
    );
    return res.status(200).json({ payments });
  } catch (err) {
    console.error('Pending payments error:', err);
    return res.status(500).json({ error: 'Failed to fetch pending payments.' });
  }
});

/**
 * 4. PUT /api/admin/payments/:id/verify
 * Approve or reject a payment { action: "verify"|"reject", notes }
 * If verify: generate individual coupon rows for each meal on each date according to meals_selected JSON.
 */
router.put('/payments/:id/verify', async (req, res) => {
  const paymentId = parseInt(req.params.id, 10);
  const { action, notes } = req.body;
  const adminId = req.session.user.id;

  if (!action || !['verify', 'reject'].includes(action)) {
    return res.status(400).json({ error: "Action must be either 'verify' or 'reject'." });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [payments] = await connection.query(
      'SELECT id, student_id, amount, status FROM payments WHERE id = ? FOR UPDATE',
      [paymentId]
    );

    if (payments.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Payment record not found.' });
    }

    const payment = payments[0];
    if (payment.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({
        error: `Payment has already been marked as '${payment.status}'. Cannot re-verify or re-reject.`
      });
    }

    if (action === 'reject') {
      await connection.query(
        'UPDATE payments SET status = "rejected", verified_by = ?, notes = ? WHERE id = ?',
        [adminId, notes ? notes.trim() : null, paymentId]
      );
      await connection.commit();
      return res.status(200).json({ message: 'Payment rejected successfully.' });
    }

    // Action: VERIFY
    await connection.query(
      'UPDATE payments SET status = "verified", verified_by = ?, notes = ? WHERE id = ?',
      [adminId, notes ? notes.trim() : null, paymentId]
    );

    // Look up coupon_order
    const [orders] = await connection.query(
      'SELECT id, student_id, mess_hall, start_date, end_date, meals_selected, includes_sunday FROM coupon_orders WHERE payment_id = ?',
      [paymentId]
    );

    let generatedCouponsCount = 0;
    if (orders.length > 0) {
      const order = orders[0];
      const studentId = order.student_id;
      const messHall = normalizeMessHall(order.mess_hall, 'mess_1');
      let mealsSelected = order.meals_selected;
      if (typeof mealsSelected === 'string') {
        try {
          mealsSelected = JSON.parse(mealsSelected);
        } catch (e) {
          mealsSelected = {};
        }
      }

      const includesSunday = Boolean(order.includes_sunday);
      const start = new Date(`${order.start_date}T00:00:00`);
      const end = new Date(`${order.end_date}T00:00:00`);
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      const couponRows = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayName = dayNames[d.getDay()];
        if (dayName === 'Sunday' && !includesSunday) {
          continue;
        }

        const dateStr = d.toISOString().substring(0, 10);
        const dayMeals = mealsSelected[dayName] || [];

        for (const meal of dayMeals) {
          const source = (dayName === 'Sunday') ? 'sunday' : 'prepaid';
          couponRows.push([studentId, messHall, meal, dateStr, source, 'active']);
        }
      }

      if (couponRows.length > 0) {
        // Bulk insert coupons with IGNORE or ON DUPLICATE KEY UPDATE to prevent crash if existing
        await connection.query(
          `INSERT IGNORE INTO coupons (student_id, mess_hall, meal_type, meal_date, source, status)
           VALUES ?`,
          [couponRows]
        );
        generatedCouponsCount = couponRows.length;
      }
    }

    await connection.commit();
    return res.status(200).json({
      message: `Payment verified successfully. Generated ${generatedCouponsCount} coupons.`,
      status: 'verified'
    });
  } catch (err) {
    await connection.rollback();
    console.error('Payment verify error:', err);
    return res.status(500).json({ error: 'Failed to verify payment.' });
  } finally {
    connection.release();
  }
});

/**
 * 5. GET /api/admin/claims/today
 * Show all students with active coupons for today's current meal
 */
router.get('/claims/today', async (req, res) => {
  try {
    const today = getTodayIST();
    const mealType = req.query.meal_type || getCurrentOrUpcomingMeal();
    const messHall = req.query.mess_hall;

    let sql = `
      SELECT c.id AS coupon_id, c.student_id, c.mess_hall, c.meal_type, c.meal_date, c.source, c.status, c.created_at,
             u.roll_no, u.name AS student_name, u.hostel, u.room_no
      FROM coupons c
      JOIN users u ON c.student_id = u.id
      WHERE c.meal_date = ? AND c.meal_type = ? AND c.status = 'active'
    `;
    const params = [today, mealType];

    if (messHall && VALID_MESS_CODES.includes(messHall)) {
      sql += ' AND c.mess_hall = ?';
      params.push(messHall);
    }

    sql += ' ORDER BY u.roll_no ASC';

    const [claims] = await db.query(sql, params);

    return res.status(200).json({
      meal_date: today,
      meal_type: mealType,
      schedule: MEAL_SCHEDULE[mealType],
      count: claims.length,
      claims
    });
  } catch (err) {
    console.error('Claims today error:', err);
    return res.status(500).json({ error: 'Failed to fetch active claims for today.' });
  }
});

/**
 * 6. POST /api/admin/claims/:coupon_id
 * Mark a coupon as "used" (claimed), set claimed_at to now
 */
router.post('/claims/:coupon_id', async (req, res) => {
  try {
    const couponId = parseInt(req.params.coupon_id, 10);

    const [rows] = await db.query(
      'SELECT id, status, meal_type, meal_date FROM coupons WHERE id = ?',
      [couponId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Coupon not found.' });
    }

    const coupon = rows[0];
    if (coupon.status !== 'active') {
      return res.status(400).json({
        error: `Cannot claim coupon with status '${coupon.status}'. It is already ${coupon.status}.`
      });
    }

    await db.query(
      'UPDATE coupons SET status = "used", claimed_at = CURRENT_TIMESTAMP WHERE id = ?',
      [couponId]
    );

    return res.status(200).json({
      message: `Coupon #${couponId} claimed successfully.`,
      status: 'used'
    });
  } catch (err) {
    console.error('Claim coupon error:', err);
    return res.status(500).json({ error: 'Failed to process coupon claim.' });
  }
});

/**
 * 7. POST /api/admin/spot-coupon
 * Issue spot coupon for walk-in { student_roll_no, meal_type }
 */
router.post('/spot-coupon', async (req, res) => {
  const { student_roll_no, meal_type, mess_hall } = req.body;
  const adminId = req.session.user.id;

  if (!student_roll_no || !meal_type) {
    return res.status(400).json({ error: 'Please provide student_roll_no and meal_type.' });
  }

  const normalizedMeal = meal_type.toLowerCase();
  if (!MEAL_SCHEDULE[normalizedMeal]) {
    return res.status(400).json({ error: 'Invalid meal_type specified.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [students] = await connection.query(
      'SELECT id, roll_no, name, hostel, mess_hall, room_no FROM users WHERE roll_no = ? AND role = "student" AND is_active = TRUE',
      [student_roll_no.trim().toUpperCase()]
    );

    if (students.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Active student not found with given roll number.' });
    }

    const student = students[0];
    const targetMess = mess_hall && VALID_MESS_CODES.includes(mess_hall)
      ? mess_hall
      : normalizeMessHall(student.mess_hall, 'mess_1');
    const today = getTodayIST();

    // Check if student already has a coupon for today's meal
    const [existing] = await connection.query(
      'SELECT id, status FROM coupons WHERE student_id = ? AND meal_date = ? AND meal_type = ?',
      [student.id, today, normalizedMeal]
    );

    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        error: `Student already has a ${existing[0].status} coupon for ${normalizedMeal} on ${today}.`
      });
    }

    // Determine meal price from mess_settings
    const [settingsRows] = await connection.query(
      'SELECT setting_key, setting_value FROM mess_settings WHERE setting_key = ?',
      [`${normalizedMeal}_price`]
    );
    const amount = settingsRows.length > 0 ? parseFloat(settingsRows[0].setting_value) : 50.00;

    // 1. Create auto-verified cash payment record
    const [paymentResult] = await connection.query(
      `INSERT INTO payments (student_id, amount, method, status, verified_by, notes)
       VALUES (?, ?, 'cash', 'verified', ?, 'Walk-in spot coupon purchase')`,
      [student.id, amount, adminId]
    );

    // 2. Create coupon record (status='used', source='spot', claimed_at=NOW())
    const [couponResult] = await connection.query(
      `INSERT INTO coupons (student_id, mess_hall, meal_type, meal_date, source, status, claimed_at)
       VALUES (?, ?, ?, ?, 'spot', 'used', CURRENT_TIMESTAMP)`,
      [student.id, targetMess, normalizedMeal, today]
    );

    await connection.commit();

    return res.status(201).json({
      message: `Spot coupon issued and marked as used for ${student.name} (${student.roll_no}).`,
      coupon_id: couponResult.insertId,
      payment_id: paymentResult.insertId,
      mess_hall: targetMess,
      amount,
      meal_type: normalizedMeal,
      meal_date: today
    });
  } catch (err) {
    await connection.rollback();
    console.error('Spot coupon error:', err);
    return res.status(500).json({ error: 'Failed to issue spot coupon.' });
  } finally {
    connection.release();
  }
});

/**
 * 8. GET /api/admin/complaints
 * View all complaints (filters: ?status=open&date=YYYY-MM-DD)
 */
router.get('/complaints', async (req, res) => {
  try {
    const { status, date, mess_hall, routing_type } = req.query;
    let sql = `
      SELECT c.id, c.student_id, c.mess_hall, c.meal_date, c.meal_type, c.category, c.routing_type,
             c.description, c.is_anonymous, c.status, c.response, c.vendor_note, c.resolved_at, c.created_at,
             CASE WHEN c.is_anonymous = TRUE THEN 'Anonymous' ELSE u.roll_no END AS roll_no,
             CASE WHEN c.is_anonymous = TRUE THEN 'Anonymous Student' ELSE u.name END AS student_name,
             CASE WHEN c.is_anonymous = TRUE THEN '' ELSE u.hostel END AS hostel,
             CASE WHEN c.is_anonymous = TRUE THEN '' ELSE u.room_no END AS room_no,
             a.name AS responded_by_name
      FROM complaints c
      JOIN users u ON c.student_id = u.id
      LEFT JOIN users a ON c.responded_by = a.id
      WHERE 1=1
    `;
    const params = [];

    if (status && VALID_COMPLAINT_STATUSES.includes(status)) {
      sql += ' AND c.status = ?';
      params.push(status);
    }
    if (date) {
      sql += ' AND c.meal_date = ?';
      params.push(date);
    }
    if (mess_hall && VALID_MESS_CODES.includes(mess_hall)) {
      sql += ' AND c.mess_hall = ?';
      params.push(mess_hall);
    }
    if (routing_type && VALID_ROUTING_TYPES.includes(routing_type)) {
      sql += ' AND c.routing_type = ?';
      params.push(routing_type);
    }

    sql += ' ORDER BY c.created_at DESC';

    const [complaints] = await db.query(sql, params);
    return res.status(200).json({ complaints });
  } catch (err) {
    console.error('Admin complaints error:', err);
    return res.status(500).json({ error: 'Failed to retrieve complaints list.' });
  }
});

/**
 * 9. PUT /api/admin/complaints/:id
 * Respond to complaint { response, status, vendor_note }
 */
router.put('/complaints/:id', async (req, res) => {
  try {
    const complaintId = parseInt(req.params.id, 10);
    const { response, status, vendor_note } = req.body;
    const adminId = req.session.user.id;

    if (!response || !status) {
      return res.status(400).json({ error: 'Please provide response text and updated status.' });
    }

    if (!VALID_COMPLAINT_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be open, in_progress, escalated_to_vendor, or resolved.' });
    }

    const isResolved = (status === 'resolved');
    const cleanVendorNote = vendor_note !== undefined && String(vendor_note).trim()
      ? String(vendor_note).trim()
      : null;

    const [result] = await db.query(
      `UPDATE complaints
       SET response = ?,
           vendor_note = COALESCE(?, vendor_note),
           status = ?,
           responded_by = ?,
           resolved_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE resolved_at END
       WHERE id = ?`,
      [response.trim(), cleanVendorNote, status, adminId, isResolved, complaintId]
    );

    if (result.matchedRows === 0) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }

    return res.status(200).json({
      message: 'Complaint updated successfully.',
      complaint_id: complaintId,
      status
    });
  } catch (err) {
    console.error('Update complaint error:', err);
    return res.status(500).json({ error: 'Failed to update complaint.' });
  }
});

/**
 * 10. GET /api/admin/leave/pending
 * View pending leave requests
 */
router.get('/leave/pending', async (req, res) => {
  try {
    const [leaves] = await db.query(
      `SELECT l.id, l.student_id, l.start_date, l.end_date, l.reason, l.status, l.created_at,
              u.roll_no, u.name AS student_name, u.hostel, u.room_no
       FROM mess_leave l
       JOIN users u ON l.student_id = u.id
       WHERE l.status = 'pending'
       ORDER BY l.created_at ASC`
    );
    return res.status(200).json({ leaves });
  } catch (err) {
    console.error('Pending leave error:', err);
    return res.status(500).json({ error: 'Failed to retrieve pending leave requests.' });
  }
});

/**
 * 11. PUT /api/admin/leave/:id
 * Approve/reject leave { action: "approve"|"reject" }
 * If approved: find all active coupons for that student between leave dates, change status to 'on_leave'.
 */
router.put('/leave/:id', async (req, res) => {
  const leaveId = parseInt(req.params.id, 10);
  const { action } = req.body;
  const adminId = req.session.user.id;

  if (!action || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: "Action must be 'approve' or 'reject'." });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [leaves] = await connection.query(
      'SELECT id, student_id, start_date, end_date, status FROM mess_leave WHERE id = ? FOR UPDATE',
      [leaveId]
    );

    if (leaves.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Leave request not found.' });
    }

    const leave = leaves[0];
    if (leave.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({ error: `Leave request has already been ${leave.status}.` });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await connection.query(
      'UPDATE mess_leave SET status = ?, approved_by = ? WHERE id = ?',
      [newStatus, adminId, leaveId]
    );

    let updatedCouponsCount = 0;
    if (action === 'approve') {
      const [updateResult] = await connection.query(
        `UPDATE coupons
         SET status = 'on_leave'
         WHERE student_id = ?
           AND status = 'active'
           AND meal_date BETWEEN ? AND ?`,
        [leave.student_id, leave.start_date, leave.end_date]
      );
      updatedCouponsCount = updateResult.affectedRows;
    }

    await connection.commit();
    return res.status(200).json({
      message: `Leave request ${newStatus} successfully. ${updatedCouponsCount} coupons set to 'on_leave'.`,
      status: newStatus,
      updated_coupons: updatedCouponsCount
    });
  } catch (err) {
    await connection.rollback();
    console.error('Leave decision error:', err);
    return res.status(500).json({ error: 'Failed to process leave decision.' });
  } finally {
    connection.release();
  }
});

/**
 * 12. GET /api/admin/dashboard/stats
 * Today's stats: meals served per type, total students, pending payments, open complaints
 */
router.get('/dashboard/stats', async (req, res) => {
  try {
    const today = getTodayIST();

    // 1. Meals served today per type
    const [mealsRows] = await db.query(
      `SELECT meal_type, COUNT(*) AS count
       FROM coupons
       WHERE meal_date = ? AND status = 'used'
       GROUP BY meal_type`,
      [today]
    );

    const mealsServed = {
      breakfast: 0,
      lunch: 0,
      snacks: 0,
      dinner: 0
    };
    mealsRows.forEach(r => {
      mealsServed[r.meal_type] = r.count;
    });

    // 2. Total active students
    const [studentsCount] = await db.query(
      'SELECT COUNT(*) AS count FROM users WHERE role = "student" AND is_active = TRUE'
    );

    // 3. Pending payments
    const [paymentsCount] = await db.query(
      'SELECT COUNT(*) AS count FROM payments WHERE status = "pending"'
    );

    // 4. Open complaints
    const [complaintsCount] = await db.query(
      'SELECT COUNT(*) AS count FROM complaints WHERE status = "open"'
    );

    // 5. Total skips today
    const [skipsCount] = await db.query(
      'SELECT COUNT(*) AS count FROM coupons WHERE meal_date = ? AND status = "skipped"',
      [today]
    );

    // 6. Food waste & consumption projection analytics
    const analytics = await computeAnalytics(today);

    return res.status(200).json({
      date: today,
      meals_served: mealsServed,
      total_students: studentsCount[0].count,
      pending_payments: paymentsCount[0].count,
      open_complaints: complaintsCount[0].count,
      total_skips: skipsCount[0].count,
      analytics
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return res.status(500).json({ error: 'Failed to load dashboard statistics.' });
  }
});

/**
 * 13. GET /api/admin/reports/daily?date=YYYY-MM-DD
 * Return or generate daily report for a given date
 */
router.get('/reports/daily', async (req, res) => {
  try {
    const reportDate = req.query.date || getTodayIST();

    // Compute meals counts for this date
    const [couponsRows] = await db.query(
      `SELECT meal_type, status, source, COUNT(*) AS count
       FROM coupons
       WHERE meal_date = ?
       GROUP BY meal_type, status, source`,
      [reportDate]
    );

    let totalBreakfast = 0;
    let totalLunch = 0;
    let totalSnacks = 0;
    let totalDinner = 0;
    let totalSkips = 0;
    let totalSpot = 0;

    couponsRows.forEach(r => {
      if (r.status === 'used') {
        if (r.meal_type === 'breakfast') totalBreakfast += r.count;
        if (r.meal_type === 'lunch') totalLunch += r.count;
        if (r.meal_type === 'snacks') totalSnacks += r.count;
        if (r.meal_type === 'dinner') totalDinner += r.count;
      }
      if (r.status === 'skipped') {
        totalSkips += r.count;
      }
      if (r.source === 'spot') {
        totalSpot += r.count;
      }
    });

    // Compute revenue from verified payments created on that date
    const [revRows] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS revenue
       FROM payments
       WHERE status = 'verified' AND DATE(created_at) = ?`,
      [reportDate]
    );
    const revenue = parseFloat(revRows[0].revenue) || 0;

    // Complaints count
    const [compRows] = await db.query(
      `SELECT COUNT(*) AS total_complaints,
              SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved_complaints
       FROM complaints
       WHERE meal_date = ?`,
      [reportDate]
    );
    const totalComplaints = compRows[0].total_complaints || 0;
    const complaintsResolved = compRows[0].resolved_complaints || 0;

    // Insert or update daily_reports
    await db.query(
      `INSERT INTO daily_reports (
         report_date, total_breakfast, total_lunch, total_snacks, total_dinner,
         total_skips, total_spot, total_complaints, complaints_resolved, revenue
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         total_breakfast = VALUES(total_breakfast),
         total_lunch = VALUES(total_lunch),
         total_snacks = VALUES(total_snacks),
         total_dinner = VALUES(total_dinner),
         total_skips = VALUES(total_skips),
         total_spot = VALUES(total_spot),
         total_complaints = VALUES(total_complaints),
         complaints_resolved = VALUES(complaints_resolved),
         revenue = VALUES(revenue),
         generated_at = CURRENT_TIMESTAMP`,
      [
        reportDate, totalBreakfast, totalLunch, totalSnacks, totalDinner,
        totalSkips, totalSpot, totalComplaints, complaintsResolved, revenue
      ]
    );

    const [reportRows] = await db.query('SELECT * FROM daily_reports WHERE report_date = ?', [reportDate]);
    const waste_analytics = await computeAnalytics(reportDate);

    return res.status(200).json({ report: reportRows[0], waste_analytics });
  } catch (err) {
    console.error('Daily report error:', err);
    return res.status(500).json({ error: 'Failed to generate or retrieve daily report.' });
  }
});

/**
 * 14. GET /api/admin/announcements
 * List mess announcements
 */
router.get('/announcements', async (req, res) => {
  try {
    const [announcements] = await db.query(
      `SELECT a.id, a.title, a.message, a.priority, a.created_at, u.name AS author_name
       FROM announcements a
       LEFT JOIN users u ON a.created_by = u.id
       ORDER BY a.created_at DESC
       LIMIT 20`
    );
    return res.status(200).json({ announcements });
  } catch (err) {
    console.error('Admin announcements error:', err);
    return res.status(500).json({ error: 'Failed to load announcements.' });
  }
});

/**
 * 15. POST /api/admin/announcements
 * Post a new mess announcement
 */
router.post('/announcements', async (req, res) => {
  try {
    const { title, message, priority } = req.body;
    const adminId = req.session.user.id;

    if (!title || !title.trim() || !message || !message.trim()) {
      return res.status(400).json({ error: 'Please provide both title and message.' });
    }

    const level = priority === 'important' ? 'important' : 'info';
    const [result] = await db.query(
      'INSERT INTO announcements (title, message, priority, created_by) VALUES (?, ?, ?, ?)',
      [title.trim().slice(0, 120), message.trim(), level, adminId]
    );

    return res.status(201).json({
      message: 'Announcement posted.',
      id: result.insertId
    });
  } catch (err) {
    console.error('Post announcement error:', err);
    return res.status(500).json({ error: 'Failed to post announcement.' });
  }
});

/**
 * 16. DELETE /api/admin/announcements/:id
 * Delete an announcement
 */
router.delete('/announcements/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [result] = await db.query('DELETE FROM announcements WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Announcement not found.' });
    }
    return res.status(200).json({ message: 'Announcement removed.' });
  } catch (err) {
    console.error('Delete announcement error:', err);
    return res.status(500).json({ error: 'Failed to delete announcement.' });
  }
});

/**
 * 17. GET /api/admin/ratings/summary
 * Today's & overall meal rating summary
 */
router.get('/ratings/summary', async (req, res) => {
  try {
    const today = getTodayIST();
    const [byMeal] = await db.query(
      `SELECT meal_type, ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS votes
       FROM meal_ratings
       WHERE meal_date = ?
       GROUP BY meal_type`,
      [today]
    );

    const [overall] = await db.query(
      'SELECT ROUND(AVG(rating), 1) AS avg_rating, COUNT(*) AS votes FROM meal_ratings'
    );

    return res.status(200).json({
      date: today,
      today_by_meal: byMeal,
      overall: overall[0]
    });
  } catch (err) {
    console.error('Ratings summary error:', err);
    return res.status(500).json({ error: 'Failed to fetch ratings summary.' });
  }
});

module.exports = router;
