/**
 * Mock Seed Script: 100 Students (Boys Wing / Girls Wing eating across both campus messes),
 * 3 Mess Representatives (Student Governing Body), 10-day per-mess Coupons/Skips/Consumption
 * History, Leaves, Complaints (Direct vs Via Mess Rep & Vendor Escalation), Ratings & Reports.
 *
 * Usage: npm run seed (or called automatically when DB has <= 1 user)
 */

const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { getTodayIST } = require('../utils/time');
const { ensureMessSchemaColumns } = require('../utils/messConfig');

const FIRST_NAMES = [
  'Aarav', 'Priya', 'Rohan', 'Ananya', 'Vivaan', 'Ishita', 'Aditya', 'Sneha', 'Kabir', 'Meera',
  'Siddharth', 'Kavya', 'Arjun', 'Divya', 'Pranav', 'Neha', 'Karan', 'Shreya', 'Rishabh', 'Tanvi',
  'Nikhil', 'Pooja', 'Harsh', 'Aditi', 'Ayush', 'Riya', 'Manish', 'Swati', 'Dev', 'Nandini',
  'Saurabh', 'Kriti', 'Yash', 'Sakshi', 'Tushar', 'Anjali', 'Varun', 'Pallavi', 'Abhishek', 'Simran',
  'Gaurav', 'Deepika', 'Omkar', 'Bhavana', 'Subham', 'Lipsa', 'Biswajit', 'Soumya', 'Chinmay', 'Smruti'
];

const LAST_NAMES = [
  'Mohanty', 'Nair', 'Patnaik', 'Mishra', 'Das', 'Panda', 'Behera', 'Sahoo', 'Tripathy', 'Rout',
  'Nayak', 'Jena', 'Swain', 'Parida', 'Senapati', 'Barik', 'Mahapatra', 'Sharma', 'Verma', 'Gupta'
];

function addDaysIST(baseDateStr, offsetDays) {
  const d = new Date(`${baseDateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().substring(0, 10);
}

async function seedMockData() {
  console.log('[Seed] Initializing 2-mess shared dining dataset (100 students, 3 mess reps, vendor escalation)...');
  await ensureMessSchemaColumns(db);

  const today = getTodayIST();
  const studentHash = await bcrypt.hash('student123', 10);
  const adminHash = await bcrypt.hash('admin123', 10);

  // 1. Seed 3 Mess Representatives / Governing Body (upsert hostel & mess scope cleanly)
  const admins = [
    ['REP001', 'Rohan Senapati', 'rep1@iiitbbsr.ac.in', adminHash, 'Student Body', 'mess_1', 'MR-01', 'admin', true],
    ['REP002', 'Ananya Das', 'rep2@iiitbbsr.ac.in', adminHash, 'Student Body', 'mess_2', 'MR-02', 'admin', true],
    ['ADM001', 'Suresh Panda', 'messadmin@iiitbbsr.ac.in', adminHash, 'Mess Committee', 'all', 'G-01', 'admin', true]
  ];

  await db.query(
    `INSERT INTO users (roll_no, name, email, password_hash, hostel, mess_hall, room_no, role, is_active)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       hostel = VALUES(hostel),
       mess_hall = VALUES(mess_hall)`,
    [admins]
  );

  // Migrate any legacy named hostels (BH1/BH2/BH3/GH1) on existing accounts to Boys Wing / Girls Wing
  await db.query("UPDATE users SET hostel = 'Girls Wing' WHERE hostel IN ('GH1', 'Girls Hostel 1')");
  await db.query("UPDATE users SET hostel = 'Boys Wing' WHERE hostel IN ('BH1', 'BH2', 'BH3', 'Boys Hostel 1', 'Boys Hostel 2', 'Boys Hostel 3')");

  const [adminRows] = await db.query(
    "SELECT id, roll_no FROM users WHERE role IN ('admin', 'superadmin') ORDER BY id ASC"
  );
  const rep1Id = adminRows.find(a => a.roll_no === 'REP001')?.id || adminRows[0]?.id || 1;
  const rep2Id = adminRows.find(a => a.roll_no === 'REP002')?.id || rep1Id;

  // 2. Seed 100 Mock Students (B122001 .. B122100) across Boys Wing & Girls Wing + both messes
  const studentValues = [];
  for (let i = 1; i <= 100; i++) {
    const num = String(i).padStart(3, '0');
    const rollNo = `B122${num}`;
    let fullName;
    let hostelWing;
    let messHall;
    let roomNo;

    if (i === 1) {
      fullName = 'Aarav Mohanty';
      hostelWing = 'Boys Wing';
      messHall = 'mess_1'; // Ground & 1st Floor Mess (Vendor 1)
      roomNo = '204';
    } else if (i === 2) {
      fullName = 'Priya Nair';
      hostelWing = 'Girls Wing';
      messHall = 'mess_2'; // New Mess (Vendor 2)
      roomNo = '112';
    } else {
      const fn = FIRST_NAMES[(i - 1) % FIRST_NAMES.length];
      const cleanFn = fn.charAt(0).toUpperCase() + fn.slice(1);
      const ln = LAST_NAMES[(i * 3) % LAST_NAMES.length];
      fullName = `${cleanFn} ${ln}`;
      hostelWing = i % 2 === 1 ? 'Boys Wing' : 'Girls Wing';
      messHall = (i % 10 < 6) ? 'mess_1' : 'mess_2'; // ~60% Ground & 1st Floor Mess, ~40% New Mess
      roomNo = `${1 + (i % 4)}${String((i % 30) + 1).padStart(2, '0')}`;
    }

    const email = `b122${num}@iiitbbsr.ac.in`;
    studentValues.push([rollNo, fullName, email, studentHash, hostelWing, messHall, roomNo, 'student', true]);
  }

  await db.query(
    `INSERT INTO users (roll_no, name, email, password_hash, hostel, mess_hall, room_no, role, is_active)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       hostel = VALUES(hostel),
       mess_hall = VALUES(mess_hall)`,
    [studentValues]
  );

  // Sync existing mock orders/coupons to match student's assigned mess_hall if upgrading from old schema
  await db.query(
    `UPDATE coupon_orders o
     JOIN users u ON o.student_id = u.id
     SET o.mess_hall = u.mess_hall
     WHERE u.roll_no LIKE 'B122%' AND u.mess_hall IN ('mess_1', 'mess_2')`
  );
  await db.query(
    `UPDATE coupons c
     JOIN users u ON c.student_id = u.id
     SET c.mess_hall = u.mess_hall
     WHERE u.roll_no LIKE 'B122%' AND u.mess_hall IN ('mess_1', 'mess_2')`
  );

  const [students] = await db.query(
    "SELECT id, roll_no, name, mess_hall FROM users WHERE roll_no LIKE 'B122%' ORDER BY roll_no ASC"
  );

  // Check if mock orders already seeded for B122001
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
      const verifier = st.mess_hall === 'mess_2' ? rep2Id : rep1Id;
      const [payRes] = await db.query(
        `INSERT INTO payments (student_id, amount, method, status, verified_by, notes, created_at)
         VALUES (?, 1450.00, ?, 'verified', ?, '10-day mess subscription', ?)`,
        [st.id, method, verifier, `${startDate} 10:15:00`]
      );
      await db.query(
        `INSERT INTO coupon_orders (student_id, mess_hall, payment_id, start_date, end_date, meals_selected, includes_sunday)
         VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
        [st.id, st.mess_hall, payRes.insertId, startDate, endDate, allWeekMeals]
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
        `INSERT INTO coupon_orders (student_id, mess_hall, payment_id, start_date, end_date, meals_selected, includes_sunday)
         VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
        [st.id, st.mess_hall, payRes.insertId, addDaysIST(today, 1), addDaysIST(today, 5), allWeekMeals]
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
        [st.id, addDaysIST(today, -2), addDaysIST(today, 2), rep1Id]
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

    // 6. Generate 10 days of realistic per-mess coupon rows (ate / skipped / on_leave / expired / active)
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
            if (seed < 74) {
              status = 'used';
              claimedAt = `${mealDate} ${['08:15:00', '12:45:00', '16:25:00', '20:10:00'][mIdx]}`;
            } else if (seed < 90) {
              status = 'skipped';
            } else {
              status = 'expired';
            }
          } else if (dayOffset === 0) {
            if (idx <= 1 && meal === 'dinner') {
              status = 'active';
            } else if (mIdx < 3) {
              if (seed < 75) {
                status = 'used';
                claimedAt = `${mealDate} ${['08:10:00', '12:50:00', '16:20:00', '20:05:00'][mIdx]}`;
              } else if (seed < 92) {
                status = 'skipped';
              } else {
                status = 'expired';
              }
            } else {
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
            status = seed < 14 ? 'skipped' : 'active';
          }

          couponBatch.push([st.id, st.mess_hall, meal, mealDate, 'prepaid', status, claimedAt]);
        });
      }
    }

    // Spot walk-in coupons for students 97-100 today
    for (let idx = 96; idx < students.length; idx++) {
      const st = students[idx];
      await db.query(
        `INSERT INTO payments (student_id, amount, method, status, verified_by, notes)
         VALUES (?, 50.00, 'cash', 'verified', ?, 'Walk-in spot coupon purchase')`,
        [st.id, rep1Id]
      );
      couponBatch.push([st.id, st.mess_hall, 'lunch', today, 'spot', 'used', `${today} 13:05:00`]);
    }

    for (let i = 0; i < couponBatch.length; i += 500) {
      const chunk = couponBatch.slice(i, i + 500);
      await db.query(
        `INSERT IGNORE INTO coupons (student_id, mess_hall, meal_type, meal_date, source, status, claimed_at)
         VALUES ?`,
        [chunk]
      );
    }

    // 7. Realistic Complaints & Redressals (Via Mess Rep + Direct, across Mess 1 & Mess 2, with Vendor Escalation)
    const complaintsSeed = [
      [students[0].id, 'mess_1', addDaysIST(today, -3), 'lunch', 'food_quality', 'via_mess_rep', 'Dal was slightly watery during second batch serving on the 1st floor.', false, 'resolved', 'Instructed Vendor 1 kitchen head to maintain consistency across Ground & 1st floor batches.', 'Vendor 1 supervisor revised pulse-water ratio.', rep1Id, `${addDaysIST(today, -3)} 15:10:00`, `${addDaysIST(today, -3)} 13:15:00`],
      [students[1].id, 'mess_2', addDaysIST(today, -2), 'breakfast', 'hygiene', 'via_mess_rep', 'Serving spoons near New Mess idli counter needed replacement.', false, 'resolved', 'Replaced serving ladles immediately and sanitized New Mess counter.', 'Vendor 2 housekeeping team replaced utensils.', rep2Id, `${addDaysIST(today, -2)} 10:05:00`, `${addDaysIST(today, -2)} 08:20:00`],
      [students[4].id, 'mess_1', addDaysIST(today, -2), 'dinner', 'quantity', 'via_mess_rep', 'Paneer pieces ran short after 8:30 PM on Ground floor.', false, 'resolved', 'Fresh paneer tray prepared within 15 minutes; buffer increased by 15%.', 'Vendor 1 confirmed 15% buffer stock.', rep1Id, `${addDaysIST(today, -2)} 21:15:00`, `${addDaysIST(today, -2)} 20:35:00`],
      [students[7].id, 'mess_2', addDaysIST(today, -1), 'snacks', 'food_quality', 'direct', 'Tea was lukewarm at New Mess counter.', true, 'resolved', 'Checked urn thermostat and recalibrated temperature.', 'Vendor 2 electrical check complete.', rep2Id, `${addDaysIST(today, -1)} 17:40:00`, `${addDaysIST(today, -1)} 16:30:00`],
      [students[11].id, 'mess_1', addDaysIST(today, -1), 'lunch', 'hygiene', 'via_mess_rep', 'Floor near handwash basin was wet and slippery.', false, 'resolved', 'Housekeeping cleaned area and placed anti-slip mat.', 'Vendor 1 floor attendant scheduled hourly mopping.', rep1Id, `${addDaysIST(today, -1)} 14:00:00`, `${addDaysIST(today, -1)} 12:40:00`],
      [students[15].id, 'mess_2', addDaysIST(today, -1), 'dinner', 'staff_behavior', 'direct', 'Counter attendant in New Mess was rushing students in the queue.', true, 'resolved', 'Cautioned Vendor 2 counter staff on courteous service.', 'Vendor 2 manager conducted shift briefing.', rep2Id, `${addDaysIST(today, -1)} 21:45:00`, `${addDaysIST(today, -1)} 20:10:00`],
      [students[19].id, 'mess_1', today, 'breakfast', 'food_quality', 'via_mess_rep', 'Sambhar needed slightly less salt today.', false, 'resolved', 'Adjusted spice/salt ratio with Ground & 1st floor cook.', 'Vendor 1 acknowledged seasoning feedback.', rep1Id, `${today} 09:45:00`, `${today} 08:15:00`],
      [students[22].id, 'mess_2', today, 'lunch', 'quantity', 'via_mess_rep', 'Curd bowls in New Mess finished 10 minutes before closing.', false, 'resolved', 'Restocked 30 extra curd cups for late diners.', 'Vendor 2 increased daily curd allocation.', rep2Id, `${today} 14:15:00`, `${today} 13:45:00`],
      [students[25].id, 'mess_2', today, 'snacks', 'food_quality', 'via_mess_rep', 'Bread pakora oiliness was slightly high in New Mess.', false, 'escalated_to_vendor', 'Verified with Mess Rep inspection; escalated to Vendor 2 catering lead to switch oil batch & drain tray.', 'Awaiting Vendor 2 corrective report by tomorrow snacks.', rep2Id, null, `${today} 16:35:00`],
      [students[28].id, 'mess_1', today, 'lunch', 'hygiene', 'via_mess_rep', 'Tray drying rack near 1st floor exit needs periodic wiping.', true, 'escalated_to_vendor', 'Mess Rep inspected 1st floor rack; escalated to Vendor 1 supervisor for sanitizer wipe rotation.', 'Vendor 1 scheduled 30-min sanitization intervals.', rep1Id, null, `${today} 13:20:00`],
      [students[0].id, 'mess_1', today, 'dinner', 'quantity', 'via_mess_rep', 'Extra chapati counter queue on Ground floor is moving slowly.', false, 'open', null, null, null, null, `${today} 20:05:00`],
      [students[31].id, 'mess_2', today, 'dinner', 'other', 'direct', 'New Mess drinking water cooler is dispensing warm water.', true, 'in_progress', 'Maintenance technician notified by Mess Committee.', null, rep2Id, null, `${today} 19:50:00`]
    ];

    await db.query(
      `INSERT INTO complaints (student_id, mess_hall, meal_date, meal_type, category, routing_type, description, is_anonymous, status, response, vendor_note, responded_by, resolved_at, created_at)
       VALUES ?`,
      [complaintsSeed]
    );

    // 8. Meal Ratings across today and past 2 days
    const ratingsBatch = [];
    for (let d = -2; d <= 0; d++) {
      const mDate = addDaysIST(today, d);
      for (let idx = 0; idx < 35; idx++) {
        const meal = meals[(idx + d + 4) % 4];
        const score = ((idx * 3 + d + 10) % 3) + 3;
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

    // 10. Mess Announcements
    await db.query(
      `INSERT INTO announcements (title, message, priority, created_by)
       VALUES
       ('New Mess Open for All Wings', 'Both Boys & Girls Wings can now opt for Ground & 1st Floor Mess (Vendor 1) or the newly opened New Mess (Vendor 2).', 'important', ?),
       ('Zero Food-Waste & Rep Triage Drive', 'Skip meals 60 minutes ahead to prevent overcooking. Route urgent mess issues via Mess Representatives for faster Vendor escalation.', 'info', ?)`,
      [rep1Id, rep2Id]
    );
  } else {
    // Existing pre-seeded DB upgrade: normalize existing mock complaints to include mess_2, direct/via_mess_rep & escalated_to_vendor
    await db.query(
      `UPDATE complaints c
       JOIN users u ON c.student_id = u.id
       SET c.mess_hall = CASE WHEN u.mess_hall IN ('mess_1', 'mess_2') THEN u.mess_hall ELSE 'mess_1' END
       WHERE u.roll_no LIKE 'B122%'`
    );
    await db.query(
      `UPDATE complaints
       SET status = 'escalated_to_vendor',
           response = COALESCE(response, 'Verified by Student Mess Rep and forwarded to vendor catering team.'),
           vendor_note = COALESCE(vendor_note, 'Escalated by Student Mess Representative to Vendor supervisor for immediate kitchen action.')
       WHERE status = 'in_progress' OR id IN (SELECT id FROM (SELECT MIN(id) AS id FROM complaints WHERE status = 'open' GROUP BY mess_hall) t)`
    );
    await db.query(
      `UPDATE complaints
       SET routing_type = 'direct'
       WHERE MOD(id, 4) = 0`
    );
  }

  console.log('[Seed] Mock dataset ready: 100 students (Boys/Girls Wing -> Mess 1 & Mess 2), 3 mess reps (REP001/REP002/ADM001), Dean (ADMIN001).');
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
