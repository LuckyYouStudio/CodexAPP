// Account store backed by SQLite (Node's built-in node:sqlite, no native deps).
// Replaces the old accounts.json. Requires Node >= 22.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "codexapp.db");

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    verify_token TEXT,
    verify_expires INTEGER,
    reset_token TEXT,
    reset_expires INTEGER,
    membership_until INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_accounts_verify_token ON accounts(verify_token);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS codes (
    code TEXT PRIMARY KEY,
    days INTEGER NOT NULL DEFAULT 0,
    lifetime INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    redeemed_by TEXT,
    redeemed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_codes_redeemed ON codes(redeemed_by);
`);

// Migrate older `codes` tables (pre code-expiry) by adding the column.
const _codeCols = db.prepare("PRAGMA table_info(codes)").all().map((c) => c.name);
if (!_codeCols.includes("expires_at")) db.exec("ALTER TABLE codes ADD COLUMN expires_at INTEGER");

// Migrate older DBs (created before later features) by adding the columns.
const _cols = db.prepare("PRAGMA table_info(accounts)").all().map((c) => c.name);
if (!_cols.includes("reset_token")) db.exec("ALTER TABLE accounts ADD COLUMN reset_token TEXT");
if (!_cols.includes("reset_expires")) db.exec("ALTER TABLE accounts ADD COLUMN reset_expires INTEGER");
if (!_cols.includes("membership_until")) db.exec("ALTER TABLE accounts ADD COLUMN membership_until INTEGER NOT NULL DEFAULT 0");
db.exec("CREATE INDEX IF NOT EXISTS idx_accounts_reset_token ON accounts(reset_token);");

// ---- key/value settings (e.g. SMTP config editable from the admin UI) ----
export function getSetting(key) {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return r ? r.value : null;
}
export function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, value == null ? null : String(value));
}

// ---- admin helpers ----
export function getById(id) { return db.prepare("SELECT * FROM accounts WHERE id = ?").get(id); }
export function listAccounts(limit = 200) {
  return db.prepare("SELECT id,email,email_verified,membership_until,created_at FROM accounts ORDER BY created_at DESC LIMIT ?").all(limit);
}
export function counts() {
  const total = db.prepare("SELECT COUNT(*) n FROM accounts").get().n;
  const verified = db.prepare("SELECT COUNT(*) n FROM accounts WHERE email_verified = 1").get().n;
  const members = db.prepare("SELECT COUNT(*) n FROM accounts WHERE membership_until > ?").get(Date.now()).n;
  return { total, verified, members };
}
export function deleteAccount(id) { db.prepare("DELETE FROM accounts WHERE id = ?").run(id); }

// ---- membership ----
export function setMembership(id, until) {
  db.prepare("UPDATE accounts SET membership_until = ? WHERE id = ?").run(until, id);
}

// ---- redemption codes ----
export function createCode(c) {
  db.prepare("INSERT INTO codes (code,days,lifetime,note,created_at,expires_at) VALUES (?,?,?,?,?,?)")
    .run(c.code, c.days | 0, c.lifetime ? 1 : 0, c.note ?? null, c.created_at, c.expires_at ?? null);
}
export function getCode(code) { return db.prepare("SELECT * FROM codes WHERE code = ?").get(code); }
// Atomically claim an unused code; returns true if this call won the claim.
export function redeemCode(code, accountId, at) {
  const r = db.prepare("UPDATE codes SET redeemed_by = ?, redeemed_at = ? WHERE code = ? AND redeemed_by IS NULL").run(accountId, at, code);
  return r.changes > 0;
}
export function listCodes(limit = 200) {
  return db.prepare("SELECT * FROM codes ORDER BY created_at DESC LIMIT ?").all(limit);
}
export function codeStats() {
  const total = db.prepare("SELECT COUNT(*) n FROM codes").get().n;
  const used = db.prepare("SELECT COUNT(*) n FROM codes WHERE redeemed_by IS NOT NULL").get().n;
  return { total, used };
}

export function getByEmail(email) {
  return db.prepare("SELECT * FROM accounts WHERE email = ?").get(email);
}
export function getByVerifyToken(token) {
  return db.prepare("SELECT * FROM accounts WHERE verify_token = ?").get(token);
}
export function createAccount(a) {
  db.prepare(
    "INSERT INTO accounts (id,email,salt,hash,email_verified,verify_token,verify_expires,created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(a.id, a.email, a.salt, a.hash, a.email_verified ? 1 : 0, a.verify_token ?? null, a.verify_expires ?? null, a.created_at);
}
export function setVerified(id) {
  db.prepare("UPDATE accounts SET email_verified = 1, verify_token = NULL, verify_expires = NULL WHERE id = ?").run(id);
}
export function setVerifyToken(id, token, expires) {
  db.prepare("UPDATE accounts SET verify_token = ?, verify_expires = ? WHERE id = ?").run(token, expires, id);
}

// ---- password reset ----
export function getByResetToken(token) {
  return db.prepare("SELECT * FROM accounts WHERE reset_token = ?").get(token);
}
export function setResetToken(id, token, expires) {
  db.prepare("UPDATE accounts SET reset_token = ?, reset_expires = ? WHERE id = ?").run(token, expires, id);
}
export function updatePassword(id, salt, hash) {
  // Completing a reset link proves the user controls the inbox, so also mark the
  // email verified and clear the pending reset token.
  db.prepare("UPDATE accounts SET salt = ?, hash = ?, email_verified = 1, reset_token = NULL, reset_expires = NULL WHERE id = ?").run(salt, hash, id);
}

// One-time migration from the legacy accounts.json (marked verified so existing
// users aren't locked out by the new email-verification requirement).
export function migrateFromJson(jsonPath) {
  if (!fs.existsSync(jsonPath)) return 0;
  let data;
  try { data = JSON.parse(fs.readFileSync(jsonPath, "utf8")); } catch { return 0; }
  let n = 0;
  for (const [email, acc] of Object.entries(data)) {
    if (!acc || getByEmail(email)) continue;
    try {
      createAccount({ id: acc.accountId, email, salt: acc.salt, hash: acc.hash, email_verified: 1, verify_token: null, verify_expires: null, created_at: acc.createdAt || Date.now() });
      n++;
    } catch {}
  }
  return n;
}
