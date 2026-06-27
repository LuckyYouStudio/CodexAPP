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
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_accounts_verify_token ON accounts(verify_token);
`);

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
