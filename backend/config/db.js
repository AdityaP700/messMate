const mysql = require('mysql2/promise');
require('dotenv').config();

const sslConfig = process.env.DB_SSL === 'true'
  ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
  : undefined;

const rawHost = process.env.DB_HOST || process.env.MYSQLHOST || 'localhost';
const cleanHost = String(rawHost).trim().replace(/^https?:\/\//i, '').replace(/:\d+$/, '').trim();
const rawUser = process.env.DB_USER || process.env.MYSQLUSER || 'root';
const rawPass = process.env.DB_PASS ?? process.env.MYSQLPASSWORD ?? 'root';
const rawDb = process.env.DB_NAME || process.env.MYSQLDATABASE || 'iiit_mess';

const pool = process.env.MYSQL_URL
  ? mysql.createPool({
      uri: process.env.MYSQL_URL.trim(),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true,
      ssl: sslConfig
    })
  : mysql.createPool({
      host: cleanHost,
      port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || '3306', 10),
      user: String(rawUser).trim(),
      password: String(rawPass),
      database: String(rawDb).trim(),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: true,
      ssl: sslConfig
    });

module.exports = pool;
