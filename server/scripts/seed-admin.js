/**
 * Seeds (or updates) a single admin account from environment variables.
 *
 *   ADMIN_NAME      - admin login name      (default: "admin")
 *   ADMIN_PASSWORD  - admin login password  (REQUIRED, no default)
 *
 * Usage:  node scripts/seed-admin.js
 *
 * Credentials are never hardcoded — the password is read from the environment,
 * hashed with scrypt, and only the hash is stored.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const { hashPassword } = require('../services/passwordService');

async function run() {
  const name = (process.env.ADMIN_NAME || 'admin').trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!password || !password.trim()) {
    console.error('ERROR: ADMIN_PASSWORD env var is required to seed an admin. Aborting.');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-classroom';
  await mongoose.connect(mongoUri);

  const passwordHash = await hashPassword(password);

  const result = await Admin.findOneAndUpdate(
    { name },
    { name, passwordHash },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`Admin "${result.name}" seeded/updated successfully (id: ${result._id}).`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('Failed to seed admin:', err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
