// الخطة الشهرية لكل مركز: إعداد → إرسال للاعتماد → اعتماد أو إعادة للتعديل
const router = require("express").Router();
const config = require("../config");
const { query, tx } = require("../db/pool");
const { norm, isDate, todayCairo, HttpError, ah } = require("../lib/util");
const { requireAdmin } = require("../middleware/auth");

const isMonth = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ""));
const isTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
const addMonths = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const maxPlanMonth = () => addMonths(todayCairo().slice(0, 7), config.planMonthsAhead);
const toInt = v => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : NaN; };

const PLAN_COLS = `p.id, p.center_id AS center, p.institution_id AS inst, p.plan_month AS month, p.status,
  p.admin_note AS note, p.updated_at AS "updatedAt", p.submitted_at AS "submittedAt", p.reviewed_at AS "reviewedAt",
  ub.name AS "updatedByName", rb.name AS "reviewedByName"`;
const ITEM_COLS = `id, title, type_name AS type, target_group AS target, expected_count AS expected, item_date AS date,
  to_char(start_time,'HH24:MI') AS start, to_char(end_time,'HH24:MI') AS "end", partner, responsible`;

async function loadCenter(req, centerId) {
  const { rows } = await query("SELECT id, institution_id FROM centers WHERE id=$1 AND active", [String(centerId)]);
  if (!rows[0]) throw new HttpError(404, "المركز غير موجود");
  if (req.user.role !== "admin" && rows[0].institution_id !== req.user.institution_id)
    throw new HttpError(403, "هذا المركز تابع لمؤسسة أخرى");
  return rows[0];
}
async function loadPlan(db, centerId, month) {
  const { rows } = await db.query(
    `SELECT ${PLAN_COLS} FROM monthly_plans p
     LEFT JOIN users ub ON ub.id = p.updated_by LEFT JOIN users rb ON rb.id = p.reviewed_by
     WHERE p.center_id=$1 AND p.plan_month=$2`, [centerId, month]);
  if (!rows[0]) return null;
  const items = await db.query(`SELECT ${ITEM_COLS} FROM plan_items WHERE plan_id=$1 ORDER BY item_date, start_time, sort_order`, [rows[0].id]);
  return { ...rows[0], items: items.rows };
}

// GET /api/plans?from=YYYY-MM&to=YYYY-MM  → ملخص الخطط (عدد البنود والمستفيدين المتوقعين) لكل مركز وشهر
router.get("/", ah(async (req, res) => {
  const where = [], p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace("?", "$" + p.length)); };
  if (req.user.role !== "admin") add("p.institution_id = ?", req.user.institution_id);
  if (isMonth(req.query.from)) add("p.plan_month >= ?", req.query.from);
  if (isMonth(req.query.to)) add("p.plan_month <= ?", req.query.to);
  const { rows } = await query(
    `SELECT p.id, p.center_id AS center, p.institution_id AS inst, p.plan_month AS month, p.status, p.updated_at AS "updatedAt",
            count(i.id)::int AS items, COALESCE(sum(i.expected_count),0)::int AS expected
     FROM monthly_plans p LEFT JOIN plan_items i ON i.plan_id = p.id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     GROUP BY p.id ORDER BY p.plan_month DESC, p.center_id`, p);
  res.json({ plans: rows });
}));

// GET /api/plans/:center/:month → الخطة كاملة ببنودها (أو خطة فارغة إن لم تُنشأ بعد)
router.get("/:center/:month", ah(async (req, res) => {
  if (!isMonth(req.params.month)) throw new HttpError(422, "الشهر غير صحيح");
  const c = await loadCenter(req, req.params.center);
  const plan = await loadPlan({ query }, c.id, req.params.month);
  res.json({ plan: plan || { id: null, center: c.id, inst: c.institution_id, month: req.params.month, status: "none", note: "", items: [] } });
}));

function validateItems(items, month, types) {
  const errs = {};
  const clean = items.map(r => ({
    title: String(r.title || "").trim(), type: String(r.type || ""), target: String(r.target || "").trim(),
    expected: toInt(r.expected || 0), date: String(r.date || ""), start: String(r.start || ""), end: String(r.end || ""),
    partner: String(r.partner || "").trim(), responsible: String(r.responsible || "").trim(),
  }));
  clean.forEach((r, i) => {
    r.norm = norm(r.title);
    if (r.title.length < 4 || r.title.length > 140) return errs[i] = "اكتب اسم النشاط (٤ أحرف على الأقل).";
    if (!types.includes(r.type)) return errs[i] = "اختر المحور.";
    if (r.target.length < 2 || r.target.length > 100) return errs[i] = "حدد الفئة المستهدفة.";
    if (Number.isNaN(r.expected)) return errs[i] = "العدد المتوقع يجب أن يكون رقمًا صحيحًا موجبًا.";
    if (!isDate(r.date) || !r.date.startsWith(month)) return errs[i] = "تاريخ التنفيذ يجب أن يكون داخل شهر الخطة.";
    if (!isTime(r.start) || !isTime(r.end)) return errs[i] = "حدد توقيت البداية والنهاية.";
    if (r.start < config.dayStart || r.end > config.dayEnd)
      return errs[i] = `التوقيت يجب أن يكون داخل الفترة التشغيلية من ${config.dayStart} حتى ${config.dayEnd}.`;
    if (r.start >= r.end) return errs[i] = "توقيت النهاية يجب أن يكون بعد توقيت البداية.";
    if (r.partner.length > 150) return errs[i] = "اسم الجهة المنفذة أو الشريكة طويل جدًا.";
    if (r.responsible.length < 2 || r.responsible.length > 100) return errs[i] = "اكتب اسم المسؤول عن التنفيذ.";
    const j = clean.findIndex((o, x) => x < i && o.norm === r.norm && o.date === r.date);
    if (j > -1) return errs[i] = `مكرر: نفس اسم وتاريخ النشاط ${j + 1} في الخطة.`;
  });
  return { clean, errs };
}

// PUT /api/plans/:center/:month  {items:[...], submit:boolean}
router.put("/:center/:month", ah(async (req, res) => {
  const month = req.params.month;
  if (!isMonth(month) || month < config.startMonth || month > maxPlanMonth())
    throw new HttpError(422, "لا يمكن إعداد خطة لهذا الشهر");
  const c = await loadCenter(req, req.params.center);
  const isAdmin = req.user.role === "admin";
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length > 120) throw new HttpError(422, "عدد بنود الخطة كبير جدًا");
  const submit = !!req.body.submit;

  const existing = await loadPlan({ query }, c.id, month);
  if (existing && !isAdmin && ["submitted", "approved"].includes(existing.status))
    throw new HttpError(409, existing.status === "approved"
      ? "الخطة معتمدة ولا يمكن تعديلها. تواصل مع إدارة المشروع إذا احتجت تعديلها."
      : "الخطة مرسلة للاعتماد ولا يمكن تعديلها الآن. تواصل مع إدارة المشروع لإعادتها للتعديل.");

  const types = (await query("SELECT name FROM activity_types WHERE active")).rows.map(r => r.name);
  const { clean, errs } = validateItems(items, month, types);
  if (Object.keys(errs).length) throw new HttpError(422, "بعض بنود الخطة تحتاج تصحيح", { errors: errs });
  if (submit && clean.length < config.minPerMonth)
    throw new HttpError(422, `الخطة يجب أن تتضمن ${config.minPerMonth} أنشطة على الأقل قبل إرسالها.`);

  const status = submit ? "submitted" : existing ? (existing.status === "approved" && !isAdmin ? "draft" : existing.status) : "draft";
  const plan = await tx(async db => {
    const { rows } = await db.query(
      `INSERT INTO monthly_plans (center_id, institution_id, plan_month, status, created_by, updated_by, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$5, CASE WHEN $6 THEN now() END)
       ON CONFLICT (center_id, plan_month) DO UPDATE SET status=EXCLUDED.status, updated_by=EXCLUDED.updated_by, updated_at=now(),
         submitted_at = CASE WHEN $6 THEN now() ELSE monthly_plans.submitted_at END
       RETURNING id`, [c.id, c.institution_id, month, status, req.user.id, submit]);
    const planId = rows[0].id;
    await db.query("DELETE FROM plan_items WHERE plan_id=$1", [planId]);
    for (const [i, r] of clean.entries())
      await db.query(
        `INSERT INTO plan_items (plan_id, title, type_name, target_group, expected_count, item_date, start_time, end_time, partner, responsible, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [planId, r.title, r.type, r.target, r.expected, r.date, r.start, r.end, r.partner, r.responsible, i]);
    return loadPlan(db, c.id, month);
  });
  res.json({ plan });
}));

// POST /api/plans/:id/review  {action:"approve"|"return", note}  — إدارة المشروع فقط
router.post("/:id/review", requireAdmin, ah(async (req, res) => {
  const action = req.body.action, note = String(req.body.note || "").trim().slice(0, 600);
  if (!["approve", "return"].includes(action)) throw new HttpError(422, "إجراء غير معروف");
  if (action === "return" && note.length < 3) throw new HttpError(422, "اكتب سبب الإعادة أو التعديلات المطلوبة");
  const { rows } = await query("SELECT id, center_id, plan_month, status FROM monthly_plans WHERE id=$1", [Number(req.params.id)]);
  const p = rows[0];
  if (!p) throw new HttpError(404, "الخطة غير موجودة");
  if (action === "approve" && p.status !== "submitted") throw new HttpError(409, "يمكن اعتماد الخطط المرسلة فقط");
  if (action === "return" && !["submitted", "approved"].includes(p.status)) throw new HttpError(409, "الخطة ليست مرسلة");
  await query(
    `UPDATE monthly_plans SET status=$1, admin_note=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$4`,
    [action === "approve" ? "approved" : "returned", action === "approve" ? "" : note, req.user.id, p.id]);
  res.json({ plan: await loadPlan({ query }, p.center_id, p.plan_month) });
}));

module.exports = router;
