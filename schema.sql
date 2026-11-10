-- IIIT Bhubaneswar Mess Management System Database Schema
CREATE DATABASE IF NOT EXISTS `iiit_mess` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `iiit_mess`;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `roll_no` VARCHAR(20) UNIQUE NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(100) UNIQUE NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `hostel` VARCHAR(50) NOT NULL,
  `room_no` VARCHAR(10),
  `role` ENUM('student', 'admin', 'superadmin') DEFAULT 'student',
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Menu Table
CREATE TABLE IF NOT EXISTS `menu` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `day_of_week` ENUM('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') NOT NULL,
  `meal_type` ENUM('breakfast','lunch','snacks','dinner') NOT NULL,
  `items` TEXT NOT NULL,
  `updated_by` INT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_day_meal` (`day_of_week`, `meal_type`),
  CONSTRAINT `fk_menu_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 3. Mess Settings Table
CREATE TABLE IF NOT EXISTS `mess_settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `setting_key` VARCHAR(50) UNIQUE NOT NULL,
  `setting_value` TEXT NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 4. Payments Table (referenced by coupon_orders)
CREATE TABLE IF NOT EXISTS `payments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `method` ENUM('cash','online') NOT NULL,
  `screenshot_path` VARCHAR(255) NULL,
  `status` ENUM('pending','verified','rejected') DEFAULT 'pending',
  `verified_by` INT NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_payments_student` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payments_verified_by` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 5. Coupons Table
CREATE TABLE IF NOT EXISTS `coupons` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `meal_type` ENUM('breakfast','lunch','snacks','dinner') NOT NULL,
  `meal_date` DATE NOT NULL,
  `source` ENUM('prepaid','spot','sunday') DEFAULT 'prepaid',
  `status` ENUM('active','used','skipped','on_leave','expired') DEFAULT 'active',
  `claimed_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_student_meal_date` (`student_id`, `meal_type`, `meal_date`),
  INDEX `idx_meal_date_status` (`meal_date`, `status`),
  CONSTRAINT `fk_coupons_student` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 6. Coupon Orders Table
CREATE TABLE IF NOT EXISTS `coupon_orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `payment_id` INT NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `meals_selected` JSON NOT NULL,
  `includes_sunday` BOOLEAN DEFAULT FALSE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_orders_student` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_orders_payment` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7. Mess Leave Table
CREATE TABLE IF NOT EXISTS `mess_leave` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `reason` TEXT,
  `status` ENUM('pending','approved','rejected') DEFAULT 'pending',
  `approved_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `chk_leave_dates` CHECK (`end_date` >= `start_date`),
  CONSTRAINT `fk_leave_student` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_leave_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 8. Complaints Table
CREATE TABLE IF NOT EXISTS `complaints` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `meal_date` DATE NOT NULL,
  `meal_type` ENUM('breakfast','lunch','snacks','dinner') NOT NULL,
  `category` ENUM('food_quality','hygiene','quantity','staff_behavior','other') NOT NULL,
  `description` TEXT NOT NULL,
  `is_anonymous` BOOLEAN DEFAULT FALSE,
  `status` ENUM('open','in_progress','resolved') DEFAULT 'open',
  `response` TEXT NULL,
  `responded_by` INT NULL,
  `resolved_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_complaints_meal_date_status` (`meal_date`, `status`),
  CONSTRAINT `fk_complaints_student` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_complaints_responded_by` FOREIGN KEY (`responded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 9. Daily Reports Table
CREATE TABLE IF NOT EXISTS `daily_reports` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `report_date` DATE UNIQUE NOT NULL,
  `total_breakfast` INT DEFAULT 0,
  `total_lunch` INT DEFAULT 0,
  `total_snacks` INT DEFAULT 0,
  `total_dinner` INT DEFAULT 0,
  `total_skips` INT DEFAULT 0,
  `total_spot` INT DEFAULT 0,
  `total_complaints` INT DEFAULT 0,
  `complaints_resolved` INT DEFAULT 0,
  `revenue` DECIMAL(10,2) DEFAULT 0.00,
  `generated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 10. Announcements Table
CREATE TABLE IF NOT EXISTS `announcements` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(120) NOT NULL,
  `message` TEXT NOT NULL,
  `priority` ENUM('info','important') DEFAULT 'info',
  `created_by` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_announcements_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 11. Meal Ratings Table
CREATE TABLE IF NOT EXISTS `meal_ratings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `student_id` INT NOT NULL,
  `meal_date` DATE NOT NULL,
  `meal_type` ENUM('breakfast','lunch','snacks','dinner') NOT NULL,
  `rating` TINYINT NOT NULL,
  `comment` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_student_meal_rating` (`student_id`, `meal_date`, `meal_type`),
  CONSTRAINT `chk_rating_range` CHECK (`rating` BETWEEN 1 AND 5),
  CONSTRAINT `fk_ratings_student` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ==========================================================
-- SEED DATA
-- ==========================================================

-- Seed mess_settings
INSERT INTO `mess_settings` (`setting_key`, `setting_value`) VALUES
('breakfast_price', '30'),
('lunch_price', '50'),
('snacks_price', '15'),
('dinner_price', '50'),
('sunday_opt_in', 'true'),
('skip_cutoff_minutes', '60')
ON DUPLICATE KEY UPDATE `setting_value` = VALUES(`setting_value`);

-- Seed Super Admin (password: admin123)
INSERT INTO `users` (`roll_no`, `name`, `email`, `password_hash`, `hostel`, `room_no`, `role`, `is_active`)
VALUES (
  'ADMIN001',
  'Dean Student Affairs',
  'dean@iiitbbsr.ac.in',
  '$2a$10$iJesobNs5qXjHyuoVtX9B.M2lJZCVVyVcHYx1iTsc6Si.mxTEQi56',
  'Faculty Block',
  'A-101',
  'superadmin',
  TRUE
)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `role` = VALUES(`role`),
  `password_hash` = VALUES(`password_hash`);

-- Seed Menu
INSERT INTO `menu` (`day_of_week`, `meal_type`, `items`) VALUES
('Monday', 'breakfast', 'Poha, Boiled Egg, Bread-Butter, Tea/Milk'),
('Monday', 'lunch', 'Rice, Dal Tadka, Aloo Gobi, Roti, Salad'),
('Monday', 'snacks', 'Samosa, Tea'),
('Monday', 'dinner', 'Rice, Paneer Butter Masala, Roti, Dal'),

('Tuesday', 'breakfast', 'Idli-Sambhar, Banana, Tea/Milk'),
('Tuesday', 'lunch', 'Rice, Rajma, Bhindi Fry, Roti, Salad'),
('Tuesday', 'snacks', 'Bread Pakora, Tea'),
('Tuesday', 'dinner', 'Rice, Egg Curry, Roti, Dal Fry'),

('Wednesday', 'breakfast', 'Paratha (Aloo), Curd, Tea/Milk'),
('Wednesday', 'lunch', 'Rice, Chole, Cabbage Sabzi, Roti, Salad'),
('Wednesday', 'snacks', 'Biscuit, Tea'),
('Wednesday', 'dinner', 'Rice, Chicken Curry / Soya Chunk, Roti, Dal'),

('Thursday', 'breakfast', 'Puri-Sabzi, Boiled Egg, Tea/Milk'),
('Thursday', 'lunch', 'Rice, Dal Palak, Aloo Matar, Roti, Salad'),
('Thursday', 'snacks', 'Veg Cutlet, Tea'),
('Thursday', 'dinner', 'Rice, Fish Curry / Paneer Curry, Roti, Dal'),

('Friday', 'breakfast', 'Upma, Banana, Tea/Milk'),
('Friday', 'lunch', 'Rice, Sambar, Baingan Bharta, Roti, Salad'),
('Friday', 'snacks', 'Pakora, Tea'),
('Friday', 'dinner', 'Biryani (Veg/Non-Veg), Raita, Dal'),

('Saturday', 'breakfast', 'Chhole Bhature, Tea/Milk'),
('Saturday', 'lunch', 'Rice, Yellow Dal, Mix Veg, Roti, Salad'),
('Saturday', 'snacks', 'Cake/Pastry, Tea'),
('Saturday', 'dinner', 'Rice, Mutton / Mushroom Curry, Roti, Dal'),

('Sunday', 'breakfast', 'Aloo Paratha, Curd, Tea/Milk'),
('Sunday', 'lunch', 'Rice, Chicken/Paneer Kofta, Roti, Salad'),
('Sunday', 'snacks', 'Maggi, Tea'),
('Sunday', 'dinner', 'Khichdi, Papad, Pickle, Curd')
ON DUPLICATE KEY UPDATE `items` = VALUES(`items`);
