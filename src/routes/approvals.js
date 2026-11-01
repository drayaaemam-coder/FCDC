// صندوق الاعتمادات والمهام + السجل الزمني لكل مستند
const router = require("express").Router();
const { query } = require("../db/pool");
const { HttpError, ah } = require("../lib/util");

// GET /api/approvals → كل ما يحتاج اعتمادًا (للمدير) أو ما يخص المؤسسة (مرسل/معاد/معتمد حديثًا)
router.get("/", ah(async (req, res) => {
  const isAdmin = req.user.role === "admin", inst = req.user.institution_id;
  const scope = (col, p) => isAdmin ? "" : ` AND ${col} = $${p}`;
  const params = isAdmin ? [] : [inst];
  const recent = isAdmin ? "7 days" : "30 days";

  const plans = await query(
    `SELECT p.id, p.center_id AS center, p.institution_id AS inst, p.plan_month AS month, p.status, p.admin_note AS note,
            p.approval_code AS code, COALESCE(p.reviewed_at, p.submitted_at, p.updated_at) AS date, u.name AS "byName",
            count(i.id)::int AS items, COALESCE(sum(i.expected_count),0)::int AS expected
     FROM monthly_plans p LEFT JOIN plan_items i ON i.plan_id = p.id LEFT JOIN users u ON u.id = p.updated_by
     WHERE (p.status IN ('submitted','returned') OR (p.status = 'approved' AND p.reviewed_at > now() - interval '${recent}'))
       ${isAdmin ? "AND p.status <> 'returned'" : ""} ${scope("p.institution_id", 1)}
     GROUP BY p.id, u.name ORDER BY date DESC`, params);

  const acts = await query(
    `SELECT a.id, a.batch_id AS batch, a.center_id AS center, a.institution_id AS inst, a.activity_date AS date, a.type_name AS type,
            a.title, a.kids, a.women, a.men, a.partner, a.media_link AS link, a.notes, a.status, a.review_note AS "reviewNote",
            a.created_at AS "createdAt", a.reviewed_at AS "reviewedAt", a.created_by AS by, u.name AS "byName",
            COALESCE(array_agg(ph.id ORDER BY ph.sort_order) FILTER (WHERE ph.id IS NOT NULL), '{}') AS "mediaIds"
     FROM activities a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN photos ph ON ph.activity_id = a.id
     WHERE a.batch_id IN (
       SELECT batch_id FROM activities WHERE (status IN ('pending','returned') OR (status = 'approved' AND reviewed_at > now() - interval '${recent}'))
         ${isAdmin ? "AND status <> 'returned'" : ""} ${scope("institution_id", 1)})
     GROUP BY a.id, u.name ORDER BY a.created_at, a.id`, params);
  const batches = {};
  for (const a of acts.rows) {
    const b = batches[a.batch] = batches[a.batch] || { type: "batch", id: a.batch, center: a.center, inst: a.inst, byName: a.byName, date: a.createdAt, activities: [] };
    b.activities.push({ ...a, _id: String(a.id), photos: a.mediaIds.length });
  }
  for (const b of Object.values(batches)) {
    const st = b.activities.map(a => a.status);
    // للمدير: الدفعة تنتظره ما دام فيها نشاط قيد المراجعة. للمؤسسة: أي نشاط معاد يعني أن عليها إجراء.
    b.status = isAdmin
      ? (st.includes("pending") ? "submitted" : st.includes("returned") ? "returned" : "approved")
      : (st.includes("returned") ? "returned" : st.includes("pending") ? "submitted" : "approved");
    b.pending = st.filter(s => s === "pending").length;
    if (b.status === "approved") b.date = b.activities.reduce((m, a) => a.reviewedAt > m ? a.reviewedAt : m, b.date);
  }

  const reports = await query(
    `SELECT r.id, r.kind, r.period, r.institution_id AS inst, r.title, r.status, r.code, r.review_note AS note,
            r.updated_at AS date, u.name AS "byName"
     FROM reports r LEFT JOIN users u ON u.id = r.created_by
     WHERE (r.status IN ('submitted','returned') OR (r.status = 'approved' AND r.reviewed_at > now() - interval '${recent}'))
       ${isAdmin ? "AND r.status <> 'returned'" : ""} ${scope("r.institution_id", 1)}
     ORDER BY r.updated_at DESC`, params);

  const items = [
    ...plans.rows.map(p => ({ type: "plan", ...p })),
    ...Object.values(batches),
    ...reports.rows.map(r => ({ type: "report", ...r })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  res.json({ items });
}));

// GET /api/approvals/timeline/:type/:id
const OWNER_SQL = {
  plan: "SELECT institution_id FROM monthly_plans WHERE id = $1::int",
  batch: "SELECT institution_id FROM activities WHERE batch_id = $1 LIMIT 1",
  report: "SELECT institution_id FROM reports WHERE id = $1::int",
};
router.get("/timeline/:type/:id", ah(async (req, res) => {
  const { type, id } = req.params;
  if (!OWNER_SQL[type] || (type !== "batch" && !/^\d+$/.test(id))) throw new HttpError(404, "غير موجود");
  if (req.user.role !== "admin") {
    const { rows } = await query(OWNER_SQL[type], [id]);
    if (!rows[0] || rows[0].institution_id !== req.user.institution_id) throw new HttpError(404, "غير موجود");
  }
  const { rows } = await query(
    `SELECT e.id, e.action, e.note, e.created_at AS at, u.name AS "actorName", u.role AS "actorRole"
     FROM doc_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.entity_type = $1 AND e.entity_id = $2 ORDER BY e.created_at, e.id`, [type, id]);
  res.json({ events: rows });
}));

module.exports = router;
