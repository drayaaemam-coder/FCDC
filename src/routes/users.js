// إدارة الحسابات (للمدير فقط)
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { query } = require("../db/pool");
const { HttpError, ah } = require("../lib/util");

const PUBLIC = "id, name, email, role, institution_id, active, created_at";

router.get("/", ah(async (_req, res) => {
  const { rows } = await query(`SELECT ${PUBLIC} FROM users ORDER BY role, institution_id NULLS FIRST, name`);
  res.json({ users: rows });
}));

function check(b, creating) {
  const out = {};
  if (creating || b.name !== undefined) { out.name = String(b.name || "").trim(); if (out.name.length < 2) throw new HttpError(422, "اكتب الاسم"); }
  if (creating || b.email !== undefined) {
    out.email = String(b.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new HttpError(422, "البريد الإلكتروني غير صحيح");
  }
  if (creating || b.role !== undefined) {
    out.role = b.role === "admin" ? "admin" : "institution";
    out.institution_id = out.role === "admin" ? null : String(b.institution_id || "") || null;
    if (out.role === "institution" && !out.institution_id) throw new HttpError(422, "اختر المؤسسة لحساب المؤسسة");
  }
  if (creating || b.password) {
    if (!b.password || String(b.password).length < 8) throw new HttpError(422, "كلمة المرور يجب ألا تقل عن ٨ أحرف");
    out.password = String(b.password);
  }
  if (b.active !== undefined) out.active = !!b.active;
  return out;
}

router.post("/", ah(async (req, res) => {
  const u = check(req.body || {}, true);
  try {
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, role, institution_id) VALUES ($1,$2,$3,$4,$5) RETURNING ${PUBLIC}`,
      [u.name, u.email, await bcrypt.hash(u.password, 12), u.role, u.institution_id]);
    res.status(201).json({ user: rows[0] });
  } catch (e) {
    if (e.code === "23505") throw new HttpError(409, "يوجد حساب بهذا البريد الإلكتروني");
    if (e.code === "23503") throw new HttpError(422, "المؤسسة غير موجودة");
    throw e;
  }
}));

router.patch("/:id", ah(async (req, res) => {
  const id = Number(req.params.id);
  const u = check(req.body || {}, false);
  if (id === req.user.id && (u.active === false || u.role === "institution"))
    throw new HttpError(422, "لا يمكنك إيقاف حسابك أو إزالة صلاحية المدير عن نفسك");
  const sets = [], p = [];
  const set = (col, v) => { p.push(v); sets.push(`${col}=$${p.length}`); };
  for (const k of ["name", "email", "role", "active"]) if (u[k] !== undefined) set(k, u[k]);
  if (u.role !== undefined) set("institution_id", u.institution_id);
  if (u.password) set("password_hash", await bcrypt.hash(u.password, 12));
  if (!sets.length) throw new HttpError(422, "لا توجد تغييرات");
  p.push(id);
  try {
    const { rows } = await query(`UPDATE users SET ${sets.join(", ")} WHERE id=$${p.length} RETURNING ${PUBLIC}`, p);
    if (!rows[0]) throw new HttpError(404, "الحساب غير موجود");
    res.json({ user: rows[0] });
  } catch (e) {
    if (e.code === "23505") throw new HttpError(409, "يوجد حساب بهذا البريد الإلكتروني");
    throw e;
  }
}));

module.exports = router;
