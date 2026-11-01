const { Pool, types } = require("pg");
const config = require("../config");

// Return DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting)
types.setTypeParser(1082, v => v);

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query: (t, p) => pool.query(t, p), tx };
