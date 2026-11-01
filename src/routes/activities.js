const router = require("express").Router();
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const config = require("../config");
const { query, tx } = require("../db/pool");
const { norm, todayCairo, isDate, HttpError, ah } = require("../lib/util");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1.5 * 1024 * 1024, files: 2 * config.maxPhotos * 30, fields: 5 },
  fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});

const SELECT_ACTS = `
  SELECT a.id, a.activity_date AS date, a.type_name AS type, a.title, a.kids, a.women, a.men,
         a.partner, a.media_link AS link, a.notes, a.institution_id AS inst, a.center_id AS center,
         a.governorate AS gov, a.batch_id AS batch, a.created_at AS "createdAt", a.created_by AS by,
         u.name AS "byName",
         COALESCE(array_agg(p.id ORDER BY p.sort_order) FILTER (WHERE p.id IS NOT NULL), '{}') AS "mediaIds"
  FROM activities a
  LEFT JOIN users u  ON u.id = a.created_by
  LEFT JOIN photos p ON p.activity_id = a.id`;

const total = a => (a.kids || 0) + (a.women || 0) + (a.men || 0);
const toInt = v => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : NaN; };

// GET /api/activities?from=YYYY-MM-DD&to=YYYY-MM-DD&inst=&center=
// Institution accounts only ever see their own institution's activities.
router.get("/", ah(async (req, res) => {
  const where = [], p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace("?", "$" + p.length)); };
  if (req.user.role !== "admin") add("a.institution_id = ?", req.user.institution_id);
  else if (req.query.inst) add("a.institution_id = ?", String(req.query.inst));
  if (req.query.center) add("a.center_id = ?", String(req.query.center));
  if (isDate(req.query.from)) add("a.activity_date >= ?", req.query.from);
  if (isDate(req.query.to)) add("a.activity_date <= ?", req.query.to);
  const limit = Math.min(Number(req.query.limit) || 5000, 20000);
  const { rows } = await query(
    `${SELECT_ACTS} ${where.length ? "WHERE " + where.join(" AND ") : ""}
     GROUP BY a.id, u.name ORDER BY a.activity_date DESC, a.created_at DESC LIMIT ${limit}`, p);
  res.json({ activities: rows.map(r => ({ ...r, _id: String(r.id), photos: r.mediaIds.length })) });
}));

// Validates a batch the same way the form does, plus checks against what is already stored.
async function validateBatch(center, items, types) {
  const errs = {};
  const today = todayCairo();
  const clean = items.map(r => ({
    date: String(r.date || ""), type: String(r.type || ""), title: String(r.title || "").trim(),
    kids: toInt(r.kids || 0), women: toInt(r.women || 0), men: toInt(r.men || 0),
    partner: String(r.partner || "").trim().slice(0, 100), link: String(r.link || "").trim(),
    notes: String(r.notes || "").trim().slice(0, 600),
  }));
  clean.forEach((r, i) => {
    r.norm = norm(r.title);
    if (!isDate(r.date) || !types.includes(r.type) || r.title.length < 4 || r.title.length > 140)
      return errs[i] = "أكمل التاريخ والمحور والعنوان (٤ أحرف على الأقل).";
    if (r.date > today) return errs[i] = "التاريخ لا يمكن أن يكون في المستقبل.";
    if (r.date < config.startMonth + "-01") return errs[i] = "التاريخ قبل بداية المشروع.";
    if ([r.kids, r.women, r.men].some(Number.isNaN)) return errs[i] = "أعداد الحضور يجب أن تكون أرقامًا صحيحة موجبة.";
    if (r.link && (!/^https?:\/\/\S+\.\S+$/.test(r.link) || r.link.length > 400)) return errs[i] = "رابط النشر غير صحيح. يجب أن يبدأ بـ https://";
    const j = clean.findIndex((o, x) => x < i && o.norm === r.norm);
    if (j > -1) return errs[i] = `مكرر: نفس عنوان النشاط ${j + 1} في هذا التسجيل.`;
    const k = clean.findIndex((o, x) => x < i && o.date === r.date && o.type === r.type && total(o) === total(r) && total(r) > 0);
    if (k > -1) return errs[i] = `مكرر: نفس تاريخ ونوع وعدد حضور النشاط ${k + 1}.`;
  });
  // Compare with stored activities of the same center
  const months = [...new Set(clean.filter((_, i) => !errs[i]).map(r => r.date.slice(0, 7)))];
  if (months.length) {
    const { rows } = await query(
      `SELECT activity_date AS date, activity_month AS m, type_name AS type, title, title_norm, kids+women+men AS tot
       FROM activities WHERE center_id=$1 AND activity_month = ANY($2)`, [center.id, months]);
    clean.forEach((r, i) => {
      if (errs[i]) return;
      const ex = rows.find(a => a.m === r.date.slice(0, 7) && a.title_norm === r.norm);
      if (ex) return errs[i] = `مكرر: سبق تسجيل نشاط بنفس العنوان في هذا المركز بتاريخ ${ex.date}.`;
      const ex2 = rows.find(a => a.date === r.date && a.type === r.type && a.tot === total(r) && total(r) > 0);
      if (ex2) errs[i] = `مكرر: سبق تسجيل «${ex2.title}» بنفس التاريخ والنوع وعدد الحضور.`;
    });
  }
  return { clean, errs };
}

// POST /api/activities/batch  (multipart/form-data)
//   data:  JSON {center:"hk-01", activities:[{date,type,title,kids,women,men,partner,link,notes,photos:n}]}
//   files: p{i}_{j}_full / p{i}_{j}_thumb   (i = activity index, j = photo index; resized in the browser)
router.post("/batch", upload.any(), ah(async (req, res) => {
  let data;
  try { data = JSON.parse(req.body.data || "{}"); } catch { throw new HttpError(400, "بيانات غير صالحة"); }
  const items = Array.isArray(data.activities) ? data.activities.slice(0, 30) : [];
  const { rows: cs } = await query("SELECT id, institution_id, governorate FROM centers WHERE id=$1 AND active", [String(data.center || "")]);
  const center = cs[0];
  if (!center) throw new HttpError(422, "اختر المركز");
  if (req.user.role !== "admin" && center.institution_id !== req.user.institution_id)
    throw new HttpError(403, "لا يمكنك التسجيل لمركز تابع لمؤسسة أخرى");
  if (items.length < config.minPerBatch) throw new HttpError(422, `الحد الأدنى ${config.minPerBatch} أنشطة في كل تسجيل.`);

  const types = (await query("SELECT name FROM activity_types WHERE active")).rows.map(r => r.name);
  const { clean, errs } = await validateBatch(center, items, types);
  if (Object.keys(errs).length) throw new HttpError(422, "بعض الأنشطة تحتاج تصحيح", { errors: errs });

  const files = Object.fromEntries((req.files || []).map(f => [f.fieldname, f]));
  const batch = Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
  const written = [];
  try {
    const ids = await tx(async c => {
      const out = [];
      for (const [i, r] of clean.entries()) {
        const { rows } = await c.query(
          `INSERT INTO activities (center_id, institution_id, governorate, activity_date, activity_month, type_name,
             title, title_norm, kids, women, men, partner, media_link, notes, batch_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
          [center.id, center.institution_id, center.governorate, r.date, r.date.slice(0, 7), r.type, r.title, r.norm,
           r.kids, r.women, r.men, r.partner, r.link, r.notes, batch, req.user.id]);
        const actId = rows[0].id;
        out.push(actId);
        for (let j = 0; j < config.maxPhotos; j++) {
          const full = files[`p${i}_${j}_full`], thumb = files[`p${i}_${j}_thumb`];
          if (!full || !thumb) continue;
          const base = `${center.id}/${actId}-${j}-${crypto.randomBytes(4).toString("hex")}`;
          for (const [suffix, f] of [["", full], ["-t", thumb]]) {
            const rel = `${base}${suffix}.jpg`, abs = path.join(config.uploadDir, rel);
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, f.buffer);
            written.push(abs);
          }
          await c.query("INSERT INTO photos (activity_id, full_file, thumb_file, sort_order) VALUES ($1,$2,$3,$4)",
            [actId, `${base}.jpg`, `${base}-t.jpg`, j]);
        }
      }
      return out;
    });
    res.status(201).json({ ok: true, batch, ids });
  } catch (e) {
    await Promise.all(written.map(f => fs.unlink(f).catch(() => {})));
    if (e.code === "23505") throw new HttpError(409, "مكرر: أحد الأنشطة سبق تسجيله بنفس العنوان في هذا المركز خلال الشهر.");
    throw e;
  }
}));

// DELETE /api/activities/:id — admin, or the account that registered it
router.delete("/:id", ah(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query("SELECT id, created_by FROM activities WHERE id=$1", [id]);
  if (!rows[0]) throw new HttpError(404, "النشاط غير موجود");
  if (req.user.role !== "admin" && rows[0].created_by !== req.user.id) throw new HttpError(403, "لا يمكنك حذف هذا النشاط");
  const { rows: ph } = await query("DELETE FROM photos WHERE activity_id=$1 RETURNING full_file, thumb_file", [id]);
  await query("DELETE FROM activities WHERE id=$1", [id]);
  await Promise.all(ph.flatMap(p => [p.full_file, p.thumb_file]).map(f => fs.unlink(path.join(config.uploadDir, f)).catch(() => {})));
  res.json({ ok: true });
}));

module.exports = router;
