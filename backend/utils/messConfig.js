/**
 * Canonical configuration and schema-extension helpers for IIIT Bhubaneswar's
 * dual-vendor shared dining setup (both Boys Wing & Girls Wing eat across both messes).
 */

const MESS_HALLS = {
  mess_1: {
    code: 'mess_1',
    name: 'Ground & 1st Floor Mess',
    shortName: 'Ground & 1st Floor',
    vendor: 'Vendor 1 (Main Hall)',
    description: 'Established 2-floor dining hall (Ground + First Floor) operated by Vendor 1.'
  },
  mess_2: {
    code: 'mess_2',
    name: 'New Mess',
    shortName: 'New Mess',
    vendor: 'Vendor 2 (New Wing)',
    description: 'Newly opened dining facility operated by Vendor 2.'
  }
};

const VALID_MESS_CODES = Object.keys(MESS_HALLS);
const VALID_HOSTEL_WINGS = ['Boys Wing', 'Girls Wing'];
const VALID_ROUTING_TYPES = ['via_mess_rep', 'direct'];
const VALID_COMPLAINT_STATUSES = ['open', 'in_progress', 'escalated_to_vendor', 'resolved'];

function normalizeMessHall(value, fallback = 'mess_1') {
  if (typeof value === 'string') {
    const clean = value.trim().toLowerCase();
    if (VALID_MESS_CODES.includes(clean)) return clean;
    if (clean === 'all') return 'all';
  }
  return fallback;
}

function getMessMeta(code) {
  return MESS_HALLS[code] || MESS_HALLS.mess_1;
}

/**
 * Safely adds dual-mess, vendor routing, and escalation columns to existing MySQL DBs.
 */
async function ensureMessSchemaColumns(db) {
  const colChecks = [
    {
      table: 'users',
      column: 'mess_hall',
      ddl: "ALTER TABLE users ADD COLUMN mess_hall VARCHAR(20) NOT NULL DEFAULT 'mess_1' AFTER hostel"
    },
    {
      table: 'coupon_orders',
      column: 'mess_hall',
      ddl: "ALTER TABLE coupon_orders ADD COLUMN mess_hall VARCHAR(20) NOT NULL DEFAULT 'mess_1' AFTER student_id"
    },
    {
      table: 'coupons',
      column: 'mess_hall',
      ddl: "ALTER TABLE coupons ADD COLUMN mess_hall VARCHAR(20) NOT NULL DEFAULT 'mess_1' AFTER student_id"
    },
    {
      table: 'complaints',
      column: 'mess_hall',
      ddl: "ALTER TABLE complaints ADD COLUMN mess_hall VARCHAR(20) NOT NULL DEFAULT 'mess_1' AFTER student_id"
    },
    {
      table: 'complaints',
      column: 'routing_type',
      ddl: "ALTER TABLE complaints ADD COLUMN routing_type ENUM('via_mess_rep','direct') NOT NULL DEFAULT 'via_mess_rep' AFTER category"
    },
    {
      table: 'complaints',
      column: 'vendor_note',
      ddl: 'ALTER TABLE complaints ADD COLUMN vendor_note TEXT NULL AFTER response'
    }
  ];

  for (const item of colChecks) {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [item.table, item.column]
    );
    if (rows[0].cnt === 0) {
      await db.query(item.ddl);
    }
  }

  const [statusCol] = await db.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'complaints' AND COLUMN_NAME = 'status'`
  );
  const colType = String(statusCol[0]?.COLUMN_TYPE || '');
  if (colType && !colType.includes('escalated_to_vendor')) {
    await db.query(
      "ALTER TABLE complaints MODIFY COLUMN status ENUM('open','in_progress','escalated_to_vendor','resolved') DEFAULT 'open'"
    );
  }
}

module.exports = {
  MESS_HALLS,
  VALID_MESS_CODES,
  VALID_HOSTEL_WINGS,
  VALID_ROUTING_TYPES,
  VALID_COMPLAINT_STATUSES,
  normalizeMessHall,
  getMessMeta,
  ensureMessSchemaColumns
};
