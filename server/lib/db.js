const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

let pool = null;

function getPool() {
  if (!pool) {
    const url = new URL(process.env.DATABASE_URL);
    pool = mysql.createPool({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ""),
      waitForConnections: true,
      connectionLimit: 10,
      // migration files contain multiple statements
      multipleStatements: true,
    });
  }
  return pool;
}

async function query(sql, params) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

// Applies unapplied migrations in file-name order. Idempotent: tracked in schema_migrations.
async function runMigrations(dir = path.join(__dirname, "..", "migrations")) {
  const p = getPool();
  await p.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
  );
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const done = await query("SELECT version FROM schema_migrations WHERE version = ?", [file]);
    if (done.length > 0) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const conn = await p.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(sql);
      await conn.query("INSERT INTO schema_migrations(version) VALUES (?)", [file]);
      await conn.commit();
      console.log(`[db] applied migration ${file}`);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = { getPool, query, runMigrations };
