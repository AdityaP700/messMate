# IIIT Bhubaneswar Mess Management System

> A secure, scalable, and responsive full-stack Mess Management System built for the International Institute of Information Technology (IIIT) Bhubaneswar to automate dining operations, coupon purchases, real-time complaints, leave applications, payment reconciliations, and daily audits.

---

## 🚀 Tech Stack

- **Backend:** Node.js, Express.js (v4)
- **Database:** MySQL (v8.0+) via `mysql2/promise` with connection pooling & prepared statements
- **Session & Security:** `express-session` (HTTP-only cookies, strict SameSite), `bcryptjs` (salt rounds: 10), `express-rate-limit`
- **File Uploads:** `multer` with strict MIME-type (`image/jpeg`, `image/png`) and file-size validation (5MB max)
- **Frontend:** Vanilla HTML5, modern CSS3 (Custom Properties, Flexbox, CSS Grid, mobile-first design), and modular Vanilla JavaScript (no external libraries/frameworks)
- **Timezone:** Standard Indian Standard Time (`Asia/Kolkata`, IST, UTC+05:30) for meal windows and cutoff policies

---

## 📂 Project Structure

```
clg-project/
├── backend/
│   ├── config/
│   │   ├── db.js                 # MySQL2 connection pool
│   │   └── upload.js             # Multer config (MIME & size guards)
│   ├── middleware/
│   │   ├── auth.js               # isAuthenticated & hasRole guards
│   │   └── rateLimiter.js        # express-rate-limit (10 req / 15 min)
│   ├── routes/
│   │   ├── auth.js               # Registration, Login, Logout, /me
│   │   ├── student.js            # Menu, Buy Coupons, Skip, Leave, Complaints, Payments
│   │   ├── admin.js              # Students, Menu Edit, Verify Payments, Spot Coupons, Leave
│   │   └── superadmin.js         # Settings, Admin Staff, Reports, Analytics Overview
│   ├── utils/
│   │   └── time.js               # IST time, meal windows, and skip cutoff validation
│   └── server.js                 # Express server & hourly coupon expiration worker
├── frontend/
│   ├── css/
│   │   └── style.css             # Theme, responsive layout, cards, tables, badges, modal, toast
│   ├── js/
│   │   └── app.js                # Universal api() fetch wrapper, toast, auth guard, formatters
│   ├── index.html                # Landing & Sign In portal
│   ├── register.html             # Student self-registration portal
│   ├── student/
│   │   ├── dashboard.html        # Today's meals, active status, quick actions
│   │   ├── menu.html             # Weekly timetable with today highlighted
│   │   ├── buy-coupon.html       # Dynamic order builder, meal toggles, screenshot upload
│   │   ├── my-coupons.html       # Date-filtered coupon cards with skip action
│   │   ├── mess-leave.html       # Leave application & status tracking
│   │   ├── complaints.html       # Real-time meal window grievance submission
│   │   └── payment-history.html  # Receipts and transaction logs
│   ├── admin/
│   │   ├── dashboard.html        # Daily statistics & CSS bar chart
│   │   ├── manage-menu.html      # Inline menu timetable editor
│   │   ├── verify-payments.html  # Pending receipt approval queue
│   │   ├── mark-claims.html      # Dining hall counter with roll lookup
│   │   ├── spot-coupon.html      # Walk-in spot coupon issuing
│   │   ├── leave-requests.html   # Leave approval / coupon pause queue
│   │   ├── complaints.html       # Grievance redressal console
│   │   └── students.html         # Searchable student directory
│   └── superadmin/
│       ├── dashboard.html        # Institute-wide executive KPIs
│       ├── daily-reports.html    # Daily meal counts & revenue auditor
│       ├── manage-admins.html    # Staff provisioning & deactivation
│       └── settings.html         # Meal tariff, skip cutoffs & Sunday opt-in
├── uploads/                      # Secure storage for payment receipt images
├── tests/
│   └── verify.js                 # Automated end-to-end verification suite
├── schema.sql                    # Complete database schema, constraints, indices & seeds
├── .env.example                  # Environment configuration template
├── .gitignore                    # Ignored artifacts & node_modules
└── package.json                  # NPM manifest and scripts
```

---

## 🛠️ Setup Instructions

### 1. Prerequisites
- **Node.js** (v18.x, v20.x, or v22.x recommended)
- **MySQL Server** (v8.0+ or MariaDB 10.5+)

### 2. Clone and Install Dependencies
```bash
git clone <repo-url> iiit-bbsr-mess
cd iiit-bbsr-mess
npm install
```

### 3. Database Setup
Log into your MySQL CLI or workbench and execute `schema.sql`:
```bash
mysql -u root -p < schema.sql
```
This initializes the `iiit_mess` database, creates all 9 tables with foreign keys and cascade rules, seeds default tariff settings, populates the complete 7-day weekly menu timetable, and seeds the super administrator account.

### 4. Configure Environment
Copy `.env.example` to `.env` and fill in your MySQL credentials:
```bash
cp .env.example .env
```
Edit `.env`:
```env
PORT=3000
SESSION_SECRET=iiit_mess_secret_key_change_in_production_2026
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=your_mysql_password
DB_NAME=iiit_mess
```

### 5. Start the Server
```bash
# Production mode
npm start

# Development mode (with live watch)
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🔐 Default Credentials

| Portal / Role | Roll Number / Email | Password | Access Capabilities |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `dean@iiitbbsr.ac.in` (Roll: `ADMIN001`) | `admin123` | Global settings, daily audits, revenue metrics, admin provisioning |
| **Mess Admin** | Created via Super Admin Portal | Set at creation | Payment verifications, dining hall claims, spot coupons, menu edits |
| **Student** | Self-registered via `/register.html` | Min 6 characters | Meal purchases, daily skip, leave applications, real-time complaints |

---

## ✨ Features & Guardrails

### 1. Security & Data Integrity
- **Parameterized SQL Queries:** Every database interaction strictly uses prepared statements (`mysql2` `?` placeholders) to eliminate SQL injection vectors.
- **XSS Prevention:** Sanitized rendering via textContent and HTML entity escaping prevents script injection.
- **Brute Force Rate Limiting:** `express-rate-limit` enforces a maximum of 10 login/registration attempts per 15 minutes per IP.
- **Robust File Upload Guard:** Multer disk storage checks both filename extensions (`.jpg`, `.jpeg`, `.png`) and verified MIME headers (`image/jpeg`, `image/png`) up to 5MB.
- **Role-Based Access Control:** Middleware layer blocks privilege escalation (e.g., students cannot access `/api/admin` or `/api/superadmin`).

### 2. Smart Business Logic & Edge Case Protection
- **IST Time & Serving Windows:** All meal actions strictly adhere to Indian Standard Time:
  - **Breakfast:** 07:30 – 09:00
  - **Lunch:** 12:00 – 14:00
  - **Snacks:** 16:00 – 17:00
  - **Dinner:** 19:30 – 21:00
- **Meal Skip Cutoff Enforcement:** Students can only skip a meal if the request is submitted at least `skip_cutoff_minutes` (default 60 mins) prior to serving start. Past or already started meals cannot be skipped.
- **Grievance Window Restriction:** Complaints can only be lodged during the actual serving window of that meal.
- **Order Overlap Detection:** Students cannot submit duplicate or overlapping coupon purchase orders for the same date span.
- **Leave Overlap & Coupon Pausing:** Mess leave applications reject overlapping dates; upon admin approval, all active coupons in that date interval automatically transition to `on_leave`.
- **Idempotent Payment Verification:** Payments cannot be re-verified or re-rejected once settled.
- **Automated Coupon Expiration:** Background maintenance service periodically transitions past unconsumed active coupons to `expired`.

---

## 📸 Screenshots

| Portal | Preview |
| :--- | :--- |
| **Student Dashboard** | *[Today's meals, active coupons checklist, quick actions]* |
| **Coupon Purchase Order** | *[Interactive date range selector, per-day meal toggles, total calculator]* |
| **Admin Claims Counter** | *[Live meal window display, instant roll search, one-click claim verification]* |
| **Super Admin Audit & Reports** | *[Daily meal counts, revenue breakdowns, tariff settings]* |

---

## 👥 Contributors & Maintainers

- **Dean Student Affairs & Mess Committee**, IIIT Bhubaneswar
- **Department of Computer Science & Engineering**, IIIT Bhubaneswar
- Built for institutional dining management, student welfare, and operational transparency.
