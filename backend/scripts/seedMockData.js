/**
 * Mock Seed Script: 100 Students, 3 Mess Representatives (Admins),
 * 10-day Coupons/Skips/Consumption History, Leaves, Complaints & Redressals,
 * Meal Ratings, Announcements, and Daily Reports.
 *
 * Usage: npm run seed (or called automatically when DB has <= 1 user)
 */

const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { getTodayIST } = require('../utils/time');

const FIRST_NAMES = [
  'Aarav', 'Priya', 'Rohan', 'Ananya', 'Vivaan', 'Ishita', 'Aditya', 'Sneha', 'Kabir', 'Meera',
  'Siddharth', 'Kavya', 'Arjun', 'Divya', 'Pranav', 'Neha', 'Karan', 'Shreya', 'Rishabh', 'Tanvi',
  'Nikhil', 'Pooja', 'Harsh', 'Aditi', 'Ayush', 'Riya', 'Manish', 'Swati', 'Dev', 'Nandini',
  'Saurabh', 'Kriti', 'Yash', 'Sakshi', 'Tushar', 'Anjali', 'Varun', 'Pallavi', 'Abhishek', 'Simran',
  'Gaurav', 'Deepika', 'Omkar', 'bhavana', 'Subham', 'Lipsa', 'Biswajit', 'Soumya', 'Chinmay', 'Smruti'
];

const LAST_NAMES = [
  'Mohanty', 'Nair', 'Patnaik', 'Mishra', 'Das', 'Panda', 'Behera', 'Sahoo', 'Tripathy', 'Rout',
  'Nayak', 'Jena', 'Swain', 'Parida', 'Senapati', 'Barik', 'Mahapatra', 'Sharma', 'Verma', 'Gupta'
];

const HOSTELS = ['BH1', 'BH2', 'BH3', 'GH1'];

function addDaysIST(baseDateStr, offsetDays) {
  const d = new Date(`${baseDateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().substring(0, 10);
}

async function seedMockData() {
  console.log('[Seed] Initializing 100 mock students, 3 mess reps, and 10-day dining analytics...');
  const today = getTodayIST();
  const studentHash = await bcrypt.hash('student123', 10);
  const adminHash = await bcrypt.hash('admin123', 10);

  // 1. Seed 3 Mess Representatives / Admins
  const admins = [
    ['REP001', 'Rohan Senapati', 'rep1@iiitbbsr.ac.in', adminHash, 'BH1', 'MR-01', 'admin', true],
    ['REP002', 'Ananya Das', 'rep2@iiitbbsr.ac.in', adminHash, 'GH1', 'MR-02', 'admin', true],
    ['ADM001', 'Suresh Panda', 'messadmin@iiitbbsr.ac.in', adminHash, 'Mess Office', 'G-01', 'admin', true]
  ];

  await db.query(
    `INSERT IGNORE INTO users (roll_no, name, email, password_hash, hostel, room_no, role, is_active)
     VALUES ?`,
    [admins]
  );

  const [adminRows] = await db.query(
    "SELECT id, roll_no FROM users WHERE role IN ('admin', 'superadmin') ORDER BY id ASC"
  );
  const verifierId = adminRows.find(a => a.roll_no === 'REP001')?.id || adminRows[0]?.id || 1;

  // 2. Seed 100 Mock Students (B122001 .. B122100)
  const studentValues = [];
  for (let i = 1; i <= 100; i++) {
    const num = String(i).padStart(3, '0');
    const rollNo = `B122${num}`;
    let fullName;
    let hostel;
    let roomNo;

    if (i === 1) {
      fullName = 'Aarav Mohanty';
      hostel = 'BH1';
      roomNo = '204';
    } else if (i === 2) {
      fullName = 'Priya Nair';
      hostel = 'GH1';
      roomNo = '112';
    } else {
      const fn = FIRST_NAMES[(i - 1) % FIRST_NAMES.length];
      const cleanFn = fn.charAt(0).toUpperCase() + fn.slice(1);
      const ln = LAST_NAMES[(i * 3) % LAST_NAMES.length];
      fullName = `${cleanFn} ${ln}`;
      hostel = HOSTELS[i % 4];
      roomNo = `${1 + (i % 4)}${String((i % 30) + 1).padStart(2, '0')}`;
    }

    const email = `b122${num}@iiitbbsr.ac.in`;
    studentValues.push([rollNo, fullName, email, studentHash, hostel, roomNo, 'student', true]);
  }

  await db.query(
    `INSERT IGNORE INTO users (roll_no, name, email, password_hash, hostel, room_no, role, is_active)
     VALUES ?`,
    [studentValues]
  );

  // Fetch all B122xxx students
  const [students] = await db.query(
    "SELECT id, roll_no, name FROM users WHERE roll_no LIKE 'B122%' ORDER BY roll_no ASC"
  );

  // Avoid duplicating mock payments/orders if already seeded for B122001
  const [existingOrder] = await db.query(
    'SELECT COUNT(*) AS cnt FROM coupon_orders WHERE student_id = ?',
    [students[0].id]
  );

  if (existingOrder[0].cnt === 0) {
    const startDate = addDaysIST(today, -6);
    const endDate = addDaysIST(today, 3);
    const allWeekMeals = JSON.stringify({
      Monday: ['breakfast', 'lunch', 'snacks', 'dinner'],
      Tuesday: ['breakfast', 'lunch', 'snacks', 'dinner'],
      Wednesday: ['breakfast', 'lunch', 'snacks', 'dinner'],
      Thursday: ['breakfast', 'lunch', 'snacks', 'dinner'],
      Friday: ['breakfast', 'lunch', 'snacks', 'dinner'],
      Saturday: ['breakfast', 'lunch', 'snacks', 'dinner'],
      Sunday: ['breakfast', 'lunch', 'snacks', 'dinner']
    });

    // 3. Verified prepaid payments + orders for first 92 students
    for (let idx = 0; idx < Math.min(92, students.length); idx++) {
      const st = students[idx];
      const method = idx % 3 === 0 ? 'cash' : 'online';
      const [payRes] = await db.query(
        `INSERT INTO payments (student_id, amount, method, status, verified_by, notes, created_at)
         VALUES (?, 1450.00, ?, 'verified', ?, '10-day mess subscription', ?)`,
        [st.id, method, verifierId, `${startDate} 10:15:00`]
      );
      await db.query(
        `INSERT INTO coupon_orders (student_id, payment_id, start_date, end_date, meals_selected, includes_sunday)
         VALUES (?, ?, ?, ?, ?, TRUE)`,
        [st.id, payRes.insertId, startDate, endDate, allWeekMeals]
      );
    }

    // 4. 4 Pending payments for Admin Verify Queue demo (students 93-96)
    for (let idx = 92; idx < Math.min(96, students.length); idx++) {
      const st = students[idx];
      const [payRes] = await db.query(
        `INSERT INTO payments (student_id, amount, method, status, notes)
         VALUES (?, 725.00, 'cash', 'pending', 'Awaiting counter verification')`,
        [st.id]
      );
      await db.query(
        `INSERT INTO coupon_orders (student_id, payment_id, start_date, end_date, meals_selected, includes_sunday)
         VALUES (?, ?, ?, ?, ?, TRUE)`,
        [st.id, payRes.insertId, addDaysIST(today, 1), addDaysIST(today, 5), allWeekMeals]
      );
    }

    // 5. Mess Leave Requests (students 86-90 approved, 83-85 pending)
    const approvedLeaveIds = new Set();
    for (let idx = 85; idx < 90 && idx < students.length; idx++) {
      const st = students[idx];
      approvedLeaveIds.add(st.id);
      await db.query(
        `INSERT INTO mess_leave (student_id, start_date, end_date, reason, status, approved_by)
         VALUES (?, ?, ?, 'Outstation family function / academic event', 'approved', ?)`,
        [st.id, addDaysIST(today, -2), addDaysIST(today, 2), verifierId]
      );
    }
    for (let idx = 82; idx < 85 && idx < students.length; idx++) {
      const st = students[idx];
      await db.query(
        `INSERT INTO mess_leave (student_id, start_date, end_date, reason, status)
         VALUES (?, ?, ?, 'Home visit / medical rest', 'pending')`,
        [st.id, addDaysIST(today, 1), addDaysIST(today, 4)]
      );
    }

    // 6. Generate 10 days of realistic coupon rows (ate / skipped / on_leave / expired / active)
    const couponBatch = [];
    const meals = ['breakfast', 'lunch', 'snacks', 'dinner'];

    for (let dayOffset = -6; dayOffset <= 3; dayOffset++) {
      const mealDate = addDaysIST(today, dayOffset);
      for (let idx = 0; idx < Math.min(92, students.length); idx++) {
        const st = students[idx];
        const isLeaveWindow = approvedLeaveIds.has(st.id) && dayOffset >= -2 && dayOffset <= 2;

        meals.forEach((meal, mIdx) => {
          let status = 'active';
          let claimedAt = null;
          const seed = (idx * 17 + (dayOffset + 10) * 13 + mIdx * 7) % 100;

          if (isLeaveWindow) {
            status = 'on_leave';
          } else if (dayOffset < 0) {
            // Past days: ~74% ate, ~16% skipped, ~10% expired (no-show waste)
            if (seed < 74) {
              status = 'used';
              claimedAt = `${mealDate} ${['08:15:00', '12:45:00', '16:25:00', '20:10:00'][mIdx]}`;
            } else if (seed < 90) {
              status = 'skipped';
            } else {
              status = 'expired';
            }
          } else if (dayOffset === 0) {
            // Today: Showcase students B122001 & B122002 have active dinner + tomorrow coupons ready for demo
            if (idx <= 1 && meal === 'dinner') {
              status = 'active';
            } else if (mIdx < 3) {
              // Breakfast, lunch, snacks mostly concluded/served
              if (seed < 75) {
                status = 'used';
                claimedAt = `${mealDate} ${['08:10:00', '12:50:00', '16:20:00', '20:05:00'][mIdx]}`;
              } else if (seed < 92) {
                status = 'skipped';
              } else {
                status = 'expired';
              }
            } else {
              // Dinner today: mix of already claimed, active (upcoming), and skipped
              if (seed < 45) {
                status = 'used';
                claimedAt = `${mealDate} 20:05:00`;
              } else if (seed < 82) {
                status = 'active';
              } else {
                status = 'skipped';
              }
            }
          } else {
            // Future days: mostly active with some proactive skips
            status = seed < 14 ? 'skipped' : 'active';
          }

          couponBatch.push([st.id, meal, mealDate, 'prepaid', status, claimedAt]);
        });
      }
    }

    // Spot walk-in coupons for students 97-100 today
    for (let idx = 96; idx < students.length; idx++) {
      const st = students[idx];
      await db.query(
        `INSERT INTO payments (student_id, amount, method, status, verified_by, notes)
         VALUES (?, 50.00, 'cash', 'verified', ?, 'Walk-in spot coupon purchase')`,
        [st.id, verifierId]
      );
      couponBatch.push([st.id, 'lunch', today, 'spot', 'used', `${today} 13:05:00`]);
    }

    // Batch insert coupons in chunks of 500
    for (let i = 0; i < couponBatch.length; i += 500) {
      const chunk = couponBatch.slice(i, i + 500);
      await db.query(
        `INSERT IGNORE INTO coupons (student_id, meal_type, meal_date, source, status, claimed_at)
         VALUES ?`,
        [chunk]
      );
    }

    // 7. Realistic Complaints & Redressals
    const complaintsSeed = [
      [students[0].id, addDaysIST(today, -3), 'lunch', 'food_quality', 'Dal was slightly watery during second batch serving.', false, 'resolved', 'Instructed kitchen head to maintain consistency across all batches.', verifierId, `${addDaysIST(today, -3)} 15:10:00`, `${addDaysIST(today, -3)} 13:15:00`],
      [students[1].id, addDaysIST(today, -2), 'breakfast', 'hygiene', 'Serving spoons near idli counter needed replacement.', false, 'resolved', 'Replaced serving ladles immediately and sanitized counter.', verifierId, `${addDaysIST(today, -2)} 10:05:00`, `${addDaysIST(today, -2)} 08:20:00`],
      [students[4].id, addDaysIST(today, -2), 'dinner', 'quantity', 'Paneer pieces ran short after 8:30 PM.', false, 'resolved', 'Fresh paneer tray prepared within 15 minutes; buffer increased by 15%.', verifierId, `${addDaysIST(today, -2)} 21:15:00`, `${addDaysIST(today, -2)} 20:35:00`],
      [students[7].id, addDaysIST(today, -1), 'snacks', 'food_quality', 'Tea was lukewarm at counter 2.', true, 'resolved', 'Checked urn thermostat and recalibrated temperature.', verifierId, `${addDaysIST(today, -1)} 17:40:00`, `${addDaysIST(today, -1)} 16:30:00`],
      [students[11].id, addDaysIST(today, -1), 'lunch', 'hygiene', 'Floor near handwash basin was wet and slippery.', false, 'resolved', 'Housekeeping cleaned area and placed anti-slip mat.', verifierId, `${addDaysIST(today, -1)} 14:00:00`, `${addDaysIST(today, -1)} 12:40:00`],
      [students[15].id, addDaysIST(today, -1), 'dinner', 'staff_behavior', 'Counter attendant was rushing students in the queue.', true, 'resolved', 'Cautioned counter staff on courteous service.', verifierId, `${addDaysIST(today, -1)} 21:45:00`, `${addDaysIST(today, -1)} 20:10:00`],
      [students[19].id, today, 'breakfast', 'food_quality', 'Sambhar needed slightly less salt today.', false, 'resolved', 'Adjusted spice/salt ratio with head cook for remaining meals.', verifierId, `${today} 09:45:00`, `${today} 08:15:00`],
      [students[22].id, today, 'lunch', 'quantity', 'Curd bowls finished 10 minutes before closing.', false, 'resolved', 'Restocked 30 extra curd cups for late diners.', verifierId, `${today} 14:15:00`, `${today} 13:45:00`],
      [students[25].id, today, 'snacks', 'food_quality', 'Bread pakora oiliness was slightly high.', false, 'in_progress', 'Inspecting frying temperature with kitchen supervisor.', verifierId, null, `${today} 16:35:00`],
      [students[28].id, today, 'lunch', 'hygiene', 'Tray drying rack near exit needs periodic wiping.', true, 'in_progress', 'Assigned housekeeping check between 1 PM and 2 PM.', verifierId, null, `${today} 13:20:00`],
      [students[0].id, today, 'dinner', 'quantity', 'Extra chapati counter queue is moving slowly.', false, 'open', null, null, null, `${today} 20:05:00`],
      [students[31].id, today, 'dinner', 'other', 'Drinking water cooler 2 is dispensing warm water.', true, 'open', null, null, null, `${today} 19:50:00`]
    ];

    await db.query(
      `INSERT INTO complaints (student_id, meal_date, meal_type, category, description, is_anonymous, status, response, responded_by, resolved_at, created_at)
       VALUES ?`,
      [complaintsSeed]
    );

    // 8. Meal Ratings across today and past 2 days
    const ratingsBatch = [];
    for (let d = -2; d <= 0; d++) {
      const mDate = addDaysIST(today, d);
      for (let idx = 0; idx < 35; idx++) {
        const meal = meals[(idx + d + 4) % 4];
        const score = ((idx * 3 + d + 10) % 3) + 3; // 3, 4, or 5
        ratingsBatch.push([students[idx].id, mDate, meal, score, null]);
      }
    }
    await db.query(
      `INSERT IGNORE INTO meal_ratings (student_id, meal_date, meal_type, rating, comment)
       VALUES ?`,
      [ratingsBatch]
    );

    // 9. Historical Daily Reports (past 6 days + today)
    for (let d = -6; d <= 0; d++) {
      const rDate = addDaysIST(today, d);
      await db.query(
        `INSERT INTO daily_reports (
           report_date, total_breakfast, total_lunch, total_snacks, total_dinner,
           total_skips, total_spot, total_complaints, complaints_resolved, revenue
         )
         SELECT
           ?,
           SUM(CASE WHEN meal_type = 'breakfast' AND status = 'used' THEN 1 ELSE 0 END),
           SUM(CASE WHEN meal_type = 'lunch' AND status = 'used' THEN 1 ELSE 0 END),
           SUM(CASE WHEN meal_type = 'snacks' AND status = 'used' THEN 1 ELSE 0 END),
           SUM(CASE WHEN meal_type = 'dinner' AND status = 'used' THEN 1 ELSE 0 END),
           SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END),
           SUM(CASE WHEN source = 'spot' THEN 1 ELSE 0 END),
           (SELECT COUNT(*) FROM complaints WHERE meal_date = ?),
           (SELECT COUNT(*) FROM complaints WHERE meal_date = ? AND status = 'resolved'),
           (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'verified' AND DATE(created_at) = ?)
         FROM coupons
         WHERE meal_date = ?
         ON DUPLICATE KEY UPDATE
           total_breakfast = VALUES(total_breakfast),
           total_lunch = VALUES(total_lunch),
           total_snacks = VALUES(total_snacks),
           total_dinner = VALUES(total_dinner),
           total_skips = VALUES(total_skips),
           total_spot = VALUES(total_spot),
           total_complaints = VALUES(total_complaints),
           complaints_resolved = VALUES(complaints_resolved),
           revenue = VALUES(revenue)`,
        [rDate, rDate, rDate, rDate, rDate]
      );
    }

    // 10. Rich Mess Announcements
    await db.query(
      `INSERT INTO announcements (title, message, priority, created_by)
       VALUES
       ('Zero Food-Waste Drive', 'Please skip upcoming meals at least 60 minutes ahead so the kitchen prepares exact portions.', 'important', ?),
       ('Special Friday Dinner Menu', 'Veg & Chicken Biryani with Raita will be served this Friday from 7:30 PM to 9:00 PM.', 'info', ?)`,
      [verifierId, verifierId]
    );
  }

  console.log('[Seed] Mock dataset ready: 100 students (B122001..B122100), 3 mess reps (REP001/REP002/ADM001), Dean (ADMIN001).');
}

if (require.main === module) {
  seedMockData()
    .then(async () => {
      await db.end();
      process.exit(0);
    })
    .catch(async err => {
      console.error('[Seed] Failed:', err);
      await db.end();
      process.exit(1);
    });
}

module.exports = { seedMockData };
