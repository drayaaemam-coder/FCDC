// الدورة المستندية: أكواد الاعتماد، السجل الزمني، والتنبيهات
const crypto = require("crypto");
const QRCode = require("qrcode");
const config = require("../config");
const { todayCairo } = require("./util");

const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // بدون حروف/أرقام ملتبسة (O/0, I/1)
const rand = n => Array.from(crypto.randomBytes(n), b => ALPH[b % ALPH.length]).join("");

// FCDC-R2611-7KQ4-9XZT  (R = تقرير، P = خطة، 2611 = سنة/شهر الاعتماد)
function newCode(prefix) {
  const d = todayCairo();
  return `FCDC-${prefix}${d.slice(2, 4)}${d.slice(5, 7)}-${rand(4)}-${rand(4)}`;
}

function verifyUrl(req, code) {
  const base = (config.publicUrl || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  return `${base}/verify/${encodeURIComponent(code)}`;
}
async function approvalInfo(req, code) {
  if (!code) return null;
  const url = verifyUrl(req, code);
  return { code, verifyUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 260, errorCorrectionLevel: "M" }) };
}

async function logEvent(db, type, id, action, actorId, note = "") {
  await db.query(
    "INSERT INTO doc_events (entity_type, entity_id, action, actor_id, note) VALUES ($1,$2,$3,$4,$5)",
    [type, String(id), action, actorId || null, String(note || "").slice(0, 600)]);
}

// target: { admins: true } | { institution: "hk" }. The actor never notifies themself.
async function notify(db, target, n, exceptUserId) {
  const p = [], where = ["active"];
  if (target.admins) where.push("role = 'admin'");
  else if (target.institution) { p.push(target.institution); where.push(`role = 'institution' AND institution_id = $${p.length}`); }
  else return;
  p.push(n.kind, String(n.title).slice(0, 200), String(n.body || "").slice(0, 600), JSON.stringify(n.link || {}), exceptUserId || 0);
  const k = p.length;
  await db.query(
    `INSERT INTO notifications (user_id, kind, title, body, link)
     SELECT id, $${k - 4}, $${k - 3}, $${k - 2}, $${k - 1}::jsonb FROM users WHERE ${where.join(" AND ")} AND id <> $${k}`, p);
}

async function centerInfo(db, centerId) {
  const { rows } = await db.query(
    `SELECT c.id, c.village, c.markaz, c.governorate, c.institution_id, i.name AS inst_name
     FROM centers c JOIN institutions i ON i.id = c.institution_id WHERE c.id = $1`, [centerId]);
  return rows[0];
}

const MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const ar = n => Number(n).toLocaleString("ar-EG", { useGrouping: false }); // أرقام عربية في نصوص التنبيهات والسجل
const monthLabel = ym => `${MONTHS[+ym.slice(5, 7) - 1]} ${ar(ym.slice(0, 4))}`;

module.exports = { newCode, verifyUrl, approvalInfo, logEvent, notify, centerInfo, monthLabel, ar };
