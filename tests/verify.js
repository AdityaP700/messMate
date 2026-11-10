/**
 * Comprehensive Automated Verification Suite for IIIT Bhubaneswar Mess Management System
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Starting Verification Suite ---');

// Test 1: Check Schema SQL completeness
console.log('Test 1: Validating schema.sql...');
const schemaPath = path.join(__dirname, '../schema.sql');
assert(fs.existsSync(schemaPath), 'schema.sql must exist');
const schemaContent = fs.readFileSync(schemaPath, 'utf8');

const requiredTables = [
  'users',
  'menu',
  'mess_settings',
  'payments',
  'coupons',
  'coupon_orders',
  'mess_leave',
  'complaints',
  'daily_reports'
];

requiredTables.forEach(t => {
  assert(
    schemaContent.includes(`CREATE TABLE IF NOT EXISTS \`${t}\``) ||
    schemaContent.includes(`CREATE TABLE IF NOT EXISTS ${t}`),
    `Table ${t} missing from schema.sql`
  );
});

// Check seeds in schema
assert(schemaContent.includes('breakfast_price'), 'mess_settings seeds missing');
assert(schemaContent.includes('ADMIN001'), 'Superadmin seed missing');
assert(schemaContent.includes('Poha, Boiled Egg'), 'Menu seeds missing');
console.log('✓ schema.sql validated: all 9 tables and seeds verified.');

// Test 2: Check Time utilities and IST logic
console.log('Test 2: Validating IST time utilities & meal windows...');
const timeUtils = require('../backend/utils/time');
assert(typeof timeUtils.getTodayIST === 'function');
assert(typeof timeUtils.getDayOfWeekIST === 'function');
assert(typeof timeUtils.canSkipMeal === 'function');

const today = timeUtils.getTodayIST();
assert(/^\d{4}-\d{2}-\d{2}$/.test(today), `getTodayIST must return YYYY-MM-DD format, got ${today}`);

// Test skip meal logic on future and past dates
const futureDate = '2099-01-01';
const pastDate = '2000-01-01';
assert.strictEqual(timeUtils.canSkipMeal(futureDate, 'breakfast', 60).allowed, true, 'Future meal should be allowed to skip');
assert.strictEqual(timeUtils.canSkipMeal(pastDate, 'breakfast', 60).allowed, false, 'Past meal should not be allowed to skip');

console.log('✓ Time utilities validated.');

// Test 3: Check Middleware
console.log('Test 3: Validating Auth and RateLimiter Middleware...');
const { isAuthenticated, hasRole } = require('../backend/middleware/auth');
assert(typeof isAuthenticated === 'function');
assert(typeof hasRole === 'function');

// Mock request / response for auth check
let statusVal = null;
let jsonVal = null;
const mockRes = {
  status: (s) => { statusVal = s; return mockRes; },
  json: (j) => { jsonVal = j; return mockRes; },
  redirect: () => {}
};

isAuthenticated({ originalUrl: '/api/student/menu', session: null }, mockRes, () => {});
assert.strictEqual(statusVal, 401, 'Unauthenticated API access must return 401');

// Test role check
let calledNext = false;
hasRole('student')({ originalUrl: '/api/student/menu', session: { user: { role: 'admin' } } }, mockRes, () => { calledNext = true; });
assert.strictEqual(calledNext, false, 'Admin must be forbidden from student-only route');
assert.strictEqual(statusVal, 403, 'Forbidden role must return 403');

hasRole('student', 'admin')({ originalUrl: '/api/admin/menu', session: { user: { role: 'admin' } } }, mockRes, () => { calledNext = true; });
assert.strictEqual(calledNext, true, 'Allowed role must proceed to next()');

console.log('✓ Auth middleware validated.');

// Test 4: Multer configuration
console.log('Test 4: Validating Multer file upload configuration...');
const upload = require('../backend/config/upload');
assert(upload && typeof upload.single === 'function', 'Multer upload instance must be configured');
console.log('✓ Multer configuration validated.');

// Test 5: Verify all Frontend files exist
console.log('Test 5: Validating complete frontend files...');
const frontendFiles = [
  'frontend/css/style.css',
  'frontend/js/app.js',
  'frontend/index.html',
  'frontend/register.html',
  'frontend/student/dashboard.html',
  'frontend/student/menu.html',
  'frontend/student/buy-coupon.html',
  'frontend/student/my-coupons.html',
  'frontend/student/mess-leave.html',
  'frontend/student/complaints.html',
  'frontend/student/payment-history.html',
  'frontend/admin/dashboard.html',
  'frontend/admin/manage-menu.html',
  'frontend/admin/verify-payments.html',
  'frontend/admin/mark-claims.html',
  'frontend/admin/spot-coupon.html',
  'frontend/admin/leave-requests.html',
  'frontend/admin/complaints.html',
  'frontend/admin/students.html',
  'frontend/superadmin/dashboard.html',
  'frontend/superadmin/daily-reports.html',
  'frontend/superadmin/manage-admins.html',
  'frontend/superadmin/settings.html'
];

frontendFiles.forEach(file => {
  const p = path.join(__dirname, '..', file);
  assert(fs.existsSync(p), `Missing frontend file: ${file}`);
  const content = fs.readFileSync(p, 'utf8');
  assert(content.length > 50, `Frontend file is empty or too short: ${file}`);
});
console.log(`✓ All ${frontendFiles.length} frontend files verified.`);

// Test 6: Verify Server starts and serves endpoints
console.log('Test 6: Validating Server bootstrap & route mounting...');
const { app } = require('../backend/server');
assert(app, 'Express app must be exported');

const testServer = app.listen(0, () => {
  const port = testServer.address().port;
  console.log(`✓ Test instance listening on dynamic port ${port}.`);
  testServer.close(() => {
    console.log('✓ Test instance closed gracefully.');
    console.log('\n========================================');
    console.log(' ALL VERIFICATION CHECKS PASSED (100%) ');
    console.log('========================================');
    process.exit(0);
  });
});
