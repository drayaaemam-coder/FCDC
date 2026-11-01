// ينشئ الجداول ويضيف البيانات الأساسية وحساب المدير الأول.
// تشغيل: npm run db:init
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { pool, tx } = require("./pool");
const config = require("../config");
const { INSTITUTIONS, ACTIVITY_TYPES } = require("./seed-data");

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("✓ schema ready");

  await tx(async c => {
    for (const [i, inst] of INSTITUTIONS.entries()) {
      await c.query(
        `INSERT INTO institutions (id, name, sort_order) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order`,
        [inst.id, inst.name, i]);
      for (const [k, [gov, mk, vil]] of inst.c.entries()) {
        const id = inst.id + "-" + String(k + 1).padStart(2, "0");
        await c.query(
          `INSERT INTO centers (id, institution_id, governorate, markaz, village) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id) DO UPDATE SET institution_id=EXCLUDED.institution_id, governorate=EXCLUDED.governorate,
             markaz=EXCLUDED.markaz, village=EXCLUDED.village`,
          [id, inst.id, gov, mk, vil]);
      }
    }
    for (const [i, t] of ACTIVITY_TYPES.entries()) {
      await c.query(
        `INSERT INTO activity_types (name, sort_order) VALUES ($1,$2)
         ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order`, [t, i]);
    }
  });
  console.log(`✓ seeded ${INSTITUTIONS.length} institutions, ${INSTITUTIONS.reduce((s, i) => s + i.c.length, 0)} centers, ${ACTIVITY_TYPES.length} activity types`);

  const { rows } = await pool.query("SELECT count(*)::int AS n FROM users WHERE role='admin'");
  if (!rows[0].n) {
    if (!config.adminEmail || !config.adminPassword) {
      console.warn("! no admin user yet: set ADMIN_EMAIL and ADMIN_PASSWORD in .env and run again");
    } else {
      await pool.query(
        "INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'admin')",
        [config.adminName, config.adminEmail.toLowerCase(), await bcrypt.hash(config.adminPassword, 12)]);
      console.log(`✓ admin user created: ${config.adminEmail}`);
    }
  }
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
