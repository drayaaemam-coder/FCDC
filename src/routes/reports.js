// التقارير الرسمية: تُرسل المؤسسة تقريرها للاعتماد، أو تُصدره إدارة المشروع مباشرة بكود اعتماد
const router = require("express").Router();
const express = require("express");
const { query, tx } = require("../db/pool");
const { HttpError, ah } = require("../lib/util");
const { requireAdmin } = require("../middleware/auth");
const { newCode, approvalInfo, logEvent, notify } = require("../lib/workflow");

const big = express.json({ limit: "40mb" });
const KIND_NAMES = { m: "التقرير الشهري", q: "التقرير الربع سنوي", y: "التقرير السنوي", media: "ملف التوثيق الإعلامي" };
const PERIOD_RE = { m: /^\d{4}-(0[1-9]|1[0-2])$/, q: /^\d{4}-Q[1-4]$/, y: /^\d{4}$/, media: /^\d{4}-(0[1-9]|1[0-2])$/ };

const LIST_COLS = `r.id, r.kind, r.period, r.institution_id AS inst, r.title, r.status, r.code, r.review_note AS note,
  r.created_at AS "createdAt", r.updated_at AS "updatedAt", r.reviewed_at AS "reviewedAt", r.summary,
  cu.name AS "byName", ru.name AS "reviewerName"`;
const FROM = "FROM reports r LEFT JOIN users cu ON cu.id = r.created_by LEFT JOIN users ru ON ru.id = r.reviewed_by";

async function getReport(req, id, withBody) {
  const { rows } = await query(`SELECT ${LIST_COLS}${withBody ? ", r.body" : ""} ${FROM} WHERE r.id=$1`, [Number(id)]);
  const r = rows[0];
  if (!r || (req.user.role !== "admin" && r.inst !== req.user.institution_id)) throw new HttpError(404, "التقرير غير موجود");
  return r;
}

function validate(req, b) {
  const kind = String(b.kind || ""), period = String(b.period || "");
  if (!KIND_NAMES[kind] || !PERIOD_RE[kind].test(period)) throw new HttpError(422, "نوع التقرير أو الفترة غير صحيح");
  const inst = b.inst ? String(b.inst) : null;
  if (req.user.role !== "admin") {
    if (kind === "media") throw new HttpError(403, "ملف التوثيق الإعلامي تصدره إدارة المشروع");
    if (inst !== req.user.institution_id) throw new HttpError(403, "يمكنك طلب اعتماد تقارير مؤسستك فقط");
  }
  const title = String(b.title || "").trim().slice(0, 300), body = String(b.body || "");
  if (title.length < 5 || body.length < 50) throw new HttpError(422, "محتوى التقرير غير مكتمل");
  if (body.length > 35 * 1024 * 1024) throw new HttpError(413, "حجم التقرير كبير جدًا");
  const summary = b.summary && typeof b.summary === "object" ? b.summary : {};
  return { kind, period, inst, title, body, summary: JSON.stringify(summary).length < 4000 ? summary : {} };
}

// GET /api/reports
router.get("/", ah(async (req, res) => {
  const own = req.user.role !== "admin";
  const { rows } = await query(`SELECT ${LIST_COLS} ${FROM} ${own ? "WHERE r.institution_id=$1" : ""} ORDER BY r.updated_at DESC LIMIT 300`,
    own ? [req.user.institution_id] : []);
  res.json({ reports: rows });
}));

// GET /api/reports/:id → المحتوى + بيانات الاعتماد (الكود ورمز QR)
router.get("/:id", ah(async (req, res) => {
  const r = await getReport(req, req.params.id, true);
  r.approval = await approvalInfo(req, r.code);
  res.json({ report: r });
}));

// POST /api/reports — المدير: إصدار معتمد فورًا بكود. المؤسسة: طلب اعتماد.
router.post("/", big, ah(async (req, res) => {
  const v = validate(req, req.body || {});
  const isAdmin = req.user.role === "admin";
  const { rows: ex } = await query(
    "SELECT id, status FROM reports WHERE kind=$1 AND period=$2 AND institution_id IS NOT DISTINCT FROM $3 AND status <> 'returned'",
    [v.kind, v.period, v.inst]);
  if (ex[0]) throw new HttpError(409, ex[0].status === "approved" ? "هذا التقرير صادر ومعتمد بالفعل" : "هذا التقرير مرسل للاعتماد بالفعل");
  const id = await tx(async db => {
    const code = isAdmin ? newCode("R") : null;
    const { rows } = await db.query(
      `INSERT INTO reports (kind, period, institution_id, title, body, summary, status, code, created_by, reviewed_by, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [v.kind, v.period, v.inst, v.title, v.body, v.summary, isAdmin ? "approved" : "submitted", code, req.user.id,
       isAdmin ? req.user.id : null, isAdmin ? new Date() : null]);
    const rid = rows[0].id;
    if (isAdmin) {
      await logEvent(db, "report", rid, "issued", req.user.id, `كود الاعتماد ${code}`);
      if (v.inst) await notify(db, { institution: v.inst }, { kind: "report_issued", title: `صدر ${v.title}`, body: `كود الاعتماد ${code}`, link: { view: "reports", id: rid } }, req.user.id);
    } else {
      await logEvent(db, "report", rid, "submitted", req.user.id);
      await notify(db, { admins: true }, { kind: "report_submitted", title: "تقرير بانتظار اعتمادك", body: v.title, link: { view: "tasks", type: "report", id: rid } }, req.user.id);
    }
    return rid;
  });
  const r = await getReport(req, id, false);
  r.approval = await approvalInfo(req, r.code);
  res.status(201).json({ report: r });
}));

// PUT /api/reports/:id — إعادة إرسال تقرير معاد للتعديل (بمحتوى محدّث)
router.put("/:id", big, ah(async (req, res) => {
  const cur = await getReport(req, req.params.id, false);
  if (cur.status === "approved") throw new HttpError(409, "التقرير معتمد ولا يمكن تعديله");
  const v = validate(req, { ...req.body, kind: cur.kind, period: cur.period, inst: cur.inst });
  await tx(async db => {
    await db.query("UPDATE reports SET title=$1, body=$2, summary=$3, status='submitted', updated_at=now() WHERE id=$4", [v.title, v.body, v.summary, cur.id]);
    await logEvent(db, "report", cur.id, "resubmitted", req.user.id);
    await notify(db, { admins: true }, { kind: "report_submitted", title: "تقرير معدّل بانتظار اعتمادك", body: v.title, link: { view: "tasks", type: "report", id: cur.id } }, req.user.id);
  });
  res.json({ report: await getReport(req, cur.id, false) });
}));

// POST /api/reports/:id/review {action:"approve"|"return", note}
router.post("/:id/review", requireAdmin, express.json({ limit: "50kb" }), ah(async (req, res) => {
  const cur = await getReport(req, req.params.id, false);
  const action = req.body.action, note = String(req.body.note || "").trim().slice(0, 600);
  if (!["approve", "return"].includes(action)) throw new HttpError(422, "إجراء غير معروف");
  if (cur.status !== "submitted") throw new HttpError(409, "يمكن مراجعة التقارير المرسلة فقط");
  if (action === "return" && note.length < 3) throw new HttpError(422, "اكتب سبب الإعادة أو التعديلات المطلوبة");
  await tx(async db => {
    const code = action === "approve" ? newCode("R") : null;
    await db.query(
      `UPDATE reports SET status=$1, review_note=$2, code=COALESCE($3, code), reviewed_by=$4, reviewed_at=now(), updated_at=now() WHERE id=$5`,
      [action === "approve" ? "approved" : "returned", action === "approve" ? "" : note, code, req.user.id, cur.id]);
    await logEvent(db, "report", cur.id, action === "approve" ? "approved" : "returned", req.user.id, action === "approve" ? `كود الاعتماد ${code}` : note);
    if (cur.inst) await notify(db, { institution: cur.inst }, action === "approve"
      ? { kind: "report_approved", title: `اعتُمد ${cur.title}`, body: `كود الاعتماد ${code}`, link: { view: "reports", id: cur.id } }
      : { kind: "report_returned", title: `أُعيد ${cur.title} للتعديل`, body: note, link: { view: "tasks", type: "report", id: cur.id } },
    req.user.id);
  });
  const r = await getReport(req, cur.id, false);
  r.approval = await approvalInfo(req, r.code);
  res.json({ report: r });
}));

module.exports = { router, KIND_NAMES };
