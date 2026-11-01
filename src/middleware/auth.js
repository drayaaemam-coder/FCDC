const jwt = require("jsonwebtoken");
const config = require("../config");
const { query } = require("../db/pool");
const { HttpError } = require("../lib/util");

const COOKIE = "fcdc_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function setSession(req, res, user) {
  const token = jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: Math.floor(MAX_AGE_MS / 1000) });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure /* HTTPS-only cookie when the site is served over HTTPS */, maxAge: MAX_AGE_MS, path: "/" });
}
function clearSession(res) { res.clearCookie(COOKIE, { path: "/" }); }

// Loads req.user from the session cookie (re-reads the DB so deactivation takes effect immediately)
async function loadUser(req, _res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return next();
  try {
    const { uid } = jwt.verify(token, config.jwtSecret);
    const { rows } = await query(
      "SELECT id, name, email, role, institution_id FROM users WHERE id=$1 AND active", [uid]);
    if (rows[0]) req.user = rows[0];
  } catch (_) { /* invalid/expired token → anonymous */ }
  next();
}

const requireAuth = (req, _res, next) => next(req.user ? undefined : new HttpError(401, "يجب تسجيل الدخول"));
const requireAdmin = (req, _res, next) =>
  next(!req.user ? new HttpError(401, "يجب تسجيل الدخول") : req.user.role !== "admin" ? new HttpError(403, "هذه الصفحة لإدارة المشروع فقط") : undefined);

// Basic CSRF defence on top of SameSite cookies: state-changing API calls must carry this header,
// which a cross-site HTML form cannot set.
function requireAjaxHeader(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("X-Requested-With") !== "fetch") return next(new HttpError(403, "طلب غير مسموح"));
  next();
}

module.exports = { setSession, clearSession, loadUser, requireAuth, requireAdmin, requireAjaxHeader };
