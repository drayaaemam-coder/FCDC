const router = require("express").Router();
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { query } = require("../db/pool");
const { setSession, clearSession, requireAuth } = require("../middleware/auth");
const { HttpError, ah } = require("../lib/util");

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: "محاولات كثيرة. حاول مرة أخرى بعد ربع ساعة." } });

router.post("/login", loginLimiter, ah(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const { rows } = await query("SELECT * FROM users WHERE email=$1 AND active", [email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash)))
    throw new HttpError(401, "البريد الإلكتروني أو كلمة المرور غير صحيحة");
  setSession(req, res, u);
  res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role, institution_id: u.institution_id } });
}));

router.post("/logout", (req, res) => { clearSession(res); res.json({ ok: true }); });

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

router.post("/password", requireAuth, ah(async (req, res) => {
  const { current, next: nw } = req.body || {};
  if (!nw || String(nw).length < 8) throw new HttpError(422, "كلمة المرور الجديدة يجب ألا تقل عن ٨ أحرف");
  const { rows } = await query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
  if (!(await bcrypt.compare(String(current || ""), rows[0].password_hash)))
    throw new HttpError(422, "كلمة المرور الحالية غير صحيحة");
  await query("UPDATE users SET password_hash=$1 WHERE id=$2", [await bcrypt.hash(String(nw), 12), req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;
