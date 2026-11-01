const router = require("express").Router();
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const config = require("../config");
const { query, tx } = require("../db/pool");
const { norm, todayCairo, isDate, HttpError, ah } = require("../lib/util");
const { logEvent, notify, centerInfo, ar } = require("../lib/workflow");
const { requireAdmin } = require("../middleware/auth");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1.5 * 1024 * 1024, files: 2 * config.maxPhotos * 30, fields: 5 },
  fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});

const SELECT_ACTS = `
  SELECT a.id, a.activity_date AS date, a.type_name AS type, a.title, a.kids, a.women, a.men,
         a.partner, a.media_link AS link, a.notes, a.institution_id AS inst, a.center_id AS center,
         a.governorate AS gov, a.batch_id AS batch, a.created_at AS "createdAt", a.created_by AS by,
         a.status, a.review_note AS "reviewNote", a.reviewed_at AS "reviewedAt",
         u.name AS "byName",
         COALESCE(array_agg(p.id ORDER BY p.sort_order) FILTER (WHERE p.id IS NOT NULL), '{}') AS "mediaIds"
  FROM activities a
  LEFT JOIN users u  ON u.id = a.created_by
  LEFT JOIN photos p ON p.activity_id = a.id`;
const shape = r => ({ ...r, _id: String(r.id), photos: r.mediaIds.length });

const total = a => (a.kids || 0) + (a.women || 0) + (a.men || 0);
const toInt = v => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : NaN; };

// GET /api/activities?from=YYYY-MM-DD&to=YYYY-MM-DD&inst=&center=&status=
// Institution accounts only ever see their own institution's activities.
router.get("/", ah(async (req, res) => {
  const where = [], p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace("?", "$" + p.length)); };
  if (req.user.role !== "admin") add("a.institution_id = ?", req.user.institution_id);
  else if (req.query.inst) add("a.institution_id = ?", String(req.query.inst));
  if (req.query.center) add("a.center_id = ?", String(req.query.center));
  if (req.query.status) add("a.status = ?", String(req.query.status));
  if (isDate(req.query.from)) add("a.activity_date >= ?", req.query.from);
  if (isDate(req.query.to)) add("a.activity_date <= ?", req.query.to);
  const limit = Math.min(Number(req.query.limit) || 5000, 20000);
  const { rows } = await query(
    `${SELECT_ACTS} ${where.length ? "WHERE " + where.join(" AND ") : ""}
     GROUP BY a.id, u.name ORDER BY a.activity_date DESC, a.created_at DESC LIMIT ${limit}`, p);
  res.json({ activities: rows.map(shape) });
}));

function cleanItem(r) {
  return {
    date: String(r.date || ""), type: String(r.type || ""), title: String(r.title || "").trim(),
    kids: toInt(r.kids || 0), women: toInt(r.women || 0), men: toInt(r.men || 0),
    partner: String(r.partner || "").trim().slice(0, 100), link: String(r.link || "").trim(),
    notes: String(r.notes || "").trim().slice(0, 600),
  };
}
function checkItem(r, today) {
  if (!isDate(r.date) || r.title.length < 4 || r.title.length > 140) return "أكمل التاريخ والمحور والعنوان (٤ أحرف على الأقل).";
  if (r.date > today) return "التاريخ لا يمكن أن يكون في المستقبل.";
  if (r.date < config.startMonth + "-01") return "التاريخ قبل بداية المشروع.";
  if ([r.kids, r.women, r.men].some(Number.isNaN)) return "أعداد الحضور يجب أن تكون أرقامًا صحيحة موجبة.";
  if (r.link && (!/^https?:\/\/\S+\.\S+$/.test(r.link) || r.link.length > 400)) return "رابط النشر غير صحيح. يجب أن يبدأ بـ https://";
  return "";
}

// Validates items the same way the form does, plus checks against what is already stored
// for the same center (excludeId = the activity being edited).
async function validateItems(centerId, items, excludeId = 0) {
  const errs = {};
  const today = todayCairo();
  const types = (await query("SELECT name FROM activity_types WHERE active")).rows.map(r => r.name);
  const clean = items.map(cleanItem);
  clean.forEach((r, i) => {
    r.norm = norm(r.title);
    const e = checkItem(r, today) || (!types.includes(r.type) ? "اختر المحور." : "");
    if (e) return errs[i] = e;
    const j = clean.findIndex((o, x) => x < i && o.norm === r.norm);
    if (j > -1) return errs[i] = `مكرر: نفس عنوان النشاط ${j + 1} في هذا التسجيل.`;
    const k = clean.findIndex((o, x) => x < i && o.date === r.date && o.type === r.type && total(o) === total(r) && total(r) > 0);
    if (k > -1) return errs[i] = `مكرر: نفس تاريخ ونوع وعدد حضور النشاط ${k + 1}.`;
  });
  const months = [...new Set(clean.filter((_, i) => !errs[i]).map(r => r.date.slice(0, 7)))];
  if (months.length) {
    const { rows } = await query(
      `SELECT activity_date AS date, activity_month AS m, type_name AS type, title, title_norm, kids+women+men AS tot
       FROM activities WHERE center_id=$1 AND activity_month = ANY($2) AND id <> $3`, [centerId, months, excludeId]);
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
//   data:  JSON {center:"hk-01", activities:[{date,type,title,kids,women,men,partner,link,notes}]}
//   files: p{i}_{j}_full / p{i}_{j}_thumb   (i = activity index, j = photo index; resized in the browser)
// Institution submissions start as "pending" and go to the project admins for approval.
router.post("/batch", upload.any(), ah(async (req, res) => {
  let data;
  try { data = JSON.parse(req.body.data || "{}"); } catch { throw new HttpError(400, "بيانات غير صالحة"); }
  const items = Array.isArray(data.activities) ? data.activities.slice(0, 30) : [];
  const { rows: cs } = await query("SELECT id, institution_id, governorate FROM centers WHERE id=$1 AND active", [String(data.center || "")]);
  const center = cs[0];
  if (!center) throw new HttpError(422, "اختر المركز");
  const isAdmin = req.user.role === "admin";
  if (!isAdmin && center.institution_id !== req.user.institution_id)
    throw new HttpError(403, "لا يمكنك التسجيل لمركز تابع لمؤسسة أخرى");
  if (items.length < config.minPerBatch) throw new HttpError(422, `الحد الأدنى ${config.minPerBatch} أنشطة في كل تسجيل.`);

  const { clean, errs } = await validateItems(center.id, items);
  if (Object.keys(errs).length) throw new HttpError(422, "بعض الأنشطة تحتاج تصحيح", { errors: errs });

  const files = Object.fromEntries((req.files || []).map(f => [f.fieldname, f]));
  const batch = Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
  const status = isAdmin ? "approved" : "pending";
  const written = [];
  try {
    const ids = await tx(async c => {
      const out = [];
      for (const [i, r] of clean.entries()) {
        const { rows } = await c.query(
          `INSERT INTO activities (center_id, institution_id, governorate, activity_date, activity_month, type_name,
             title, title_norm, kids, women, men, partner, media_link, notes, batch_id, created_by, status, reviewed_by, reviewed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
          [center.id, center.institution_id, center.governorate, r.date, r.date.slice(0, 7), r.type, r.title, r.norm,
           r.kids, r.women, r.men, r.partner, r.link, r.notes, batch, req.user.id, status,
           isAdmin ? req.user.id : null, isAdmin ? new Date() : null]);
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
      await logEvent(c, "batch", batch, "submitted", req.user.id, `${ar(clean.length)} أنشطة`);
      if (isAdmin) await logEvent(c, "batch", batch, "approved", req.user.id, "سجّلتها إدارة المشروع فاعتُمدت مباشرة");
      else {
        const ci = await centerInfo(c, center.id);
        await notify(c, { admins: true }, {
          kind: "batch_submitted", title: "أنشطة جديدة بانتظار اعتمادك",
          body: `${ci.inst_name} · ${ci.village}: ${ar(clean.length)} أنشطة`, link: { view: "tasks", type: "batch", id: batch },
        }, req.user.id);
      }
      return out;
    });
    res.status(201).json({ ok: true, batch, ids, status });
  } catch (e) {
    await Promise.all(written.map(f => fs.unlink(f).catch(() => {})));
    if (e.code === "23505") throw new HttpError(409, "مكرر: أحد الأنشطة سبق تسجيله بنفس العنوان في هذا المركز خلال الشهر.");
    throw e;
  }
}));

// POST /api/activities/review {ids:[...], action:"approve"|"return", note}  — إدارة المشروع فقط
router.post("/review", requireAdmin, ah(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
  const action = req.body.action, note = String(req.body.note || "").trim().slice(0, 600);
  if (!ids.length) throw new HttpError(422, "اختر الأنشطة");
  if (!["approve", "return"].includes(action)) throw new HttpError(422, "إجراء غير معروف");
  if (action === "return" && note.length < 3) throw new HttpError(422, "اكتب سبب الإعادة أو التعديل المطلوب");
  const status = action === "approve" ? "approved" : "returned";
  const done = await tx(async c => {
    const { rows } = await c.query(
      `UPDATE activities SET status=$1, review_note=$2, reviewed_by=$3, reviewed_at=now()
       WHERE id = ANY($4) AND status <> $1 RETURNING id, title, batch_id, institution_id, center_id`,
      [status, action === "approve" ? "" : note, req.user.id, ids]);
    const byBatch = {};
    rows.forEach(r => (byBatch[r.batch_id] = byBatch[r.batch_id] || []).push(r));
    for (const [batch, list] of Object.entries(byBatch)) {
      const titles = list.map(r => `«${r.title}»`).join("، ");
      await logEvent(c, "batch", batch, status, req.user.id, action === "approve" ? `${ar(list.length)} نشاط: ${titles}` : `${titles} — ${note}`);
      const ci = await centerInfo(c, list[0].center_id);
      await notify(c, { institution: list[0].institution_id }, action === "approve"
        ? { kind: "batch_approved", title: `تم اعتماد ${ar(list.length)} نشاط`, body: `${ci.village}: ${titles}`, link: { view: "tasks", type: "batch", id: batch } }
        : { kind: "batch_returned", title: `أُعيد ${ar(list.length)} نشاط للتعديل`, body: `${ci.village}: ${titles} — ${note}`, link: { view: "tasks", type: "batch", id: batch } },
      req.user.id);
    }
    return rows.length;
  });
  res.json({ ok: true, updated: done });
}));

// PATCH /api/activities/:id — تعديل نشاط (قبل اعتماده) ثم يعود للمراجعة
router.patch("/:id", ah(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query("SELECT * FROM activities WHERE id=$1", [id]);
  const a = rows[0];
  const isAdmin = req.user.role === "admin";
  if (!a || (!isAdmin && a.institution_id !== req.user.institution_id)) throw new HttpError(404, "النشاط غير موجود");
  if (!isAdmin && a.status === "approved") throw new HttpError(409, "النشاط معتمد ولا يمكن تعديله");
  const { clean, errs } = await validateItems(a.center_id, [req.body || {}], id);
  if (errs[0]) throw new HttpError(422, errs[0], { errors: errs });
  const r = clean[0];
  const status = isAdmin ? a.status : "pending";
  try {
    await tx(async c => {
      await c.query(
        `UPDATE activities SET activity_date=$1, activity_month=$2, type_name=$3, title=$4, title_norm=$5, kids=$6, women=$7, men=$8,
           partner=$9, media_link=$10, notes=$11, status=$12, updated_at=now() WHERE id=$13`,
        [r.date, r.date.slice(0, 7), r.type, r.title, r.norm, r.kids, r.women, r.men, r.partner, r.link, r.notes, status, id]);
      const wasReturned = a.status === "returned";
      await logEvent(c, "batch", a.batch_id, wasReturned && !isAdmin ? "resubmitted" : "edited", req.user.id, `«${r.title}»`);
      if (!isAdmin) {
        const ci = await centerInfo(c, a.center_id);
        await notify(c, { admins: true }, {
          kind: "activity_resubmitted", title: wasReturned ? "نشاط معدّل بانتظار الاعتماد" : "تم تعديل نشاط قيد المراجعة",
          body: `${ci.inst_name} · ${ci.village}: «${r.title}»`, link: { view: "tasks", type: "batch", id: a.batch_id },
        }, req.user.id);
      }
    });
  } catch (e) {
    if (e.code === "23505") throw new HttpError(409, "مكرر: يوجد نشاط بنفس العنوان في هذا المركز خلال الشهر.");
    throw e;
  }
  const { rows: out } = await query(`${SELECT_ACTS} WHERE a.id=$1 GROUP BY a.id, u.name`, [id]);
  res.json({ activity: shape(out[0]) });
}));

// DELETE /api/activities/:id — admin, or the account that registered it (only while not approved)
router.delete("/:id", ah(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query("SELECT id, created_by, status, batch_id, title FROM activities WHERE id=$1", [id]);
  const a = rows[0];
  if (!a) throw new HttpError(404, "النشاط غير موجود");
  const isAdmin = req.user.role === "admin";
  if (!isAdmin && a.created_by !== req.user.id) throw new HttpError(403, "لا يمكنك حذف هذا النشاط");
  if (!isAdmin && a.status === "approved") throw new HttpError(409, "النشاط معتمد ولا يمكن حذفه إلا من إدارة المشروع");
  const { rows: ph } = await query("DELETE FROM photos WHERE activity_id=$1 RETURNING full_file, thumb_file", [id]);
  await query("DELETE FROM activities WHERE id=$1", [id]);
  await logEvent({ query }, "batch", a.batch_id, "deleted", req.user.id, `«${a.title}»`);
  await Promise.all(ph.flatMap(p => [p.full_file, p.thumb_file]).map(f => fs.unlink(path.join(config.uploadDir, f)).catch(() => {})));
  res.json({ ok: true });
}));

module.exports = router;
