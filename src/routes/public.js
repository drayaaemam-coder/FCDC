// التحقق العام من أكواد الاعتماد (بدون تسجيل دخول) — يُفتح من رمز QR المطبوع على التقرير
const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const { query } = require("../db/pool");
const { ah } = require("../lib/util");
const { monthLabel } = require("../lib/workflow");
const { KIND_NAMES } = require("./reports");

router.use(rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));

router.get("/verify/:code", ah(async (req, res) => {
  const code = String(req.params.code || "").toUpperCase().trim();
  if (!/^FCDC-[A-Z0-9-]{6,30}$/.test(code)) return res.json({ valid: false });
  const r = await query(
    `SELECT r.kind, r.period, r.title, r.summary, r.reviewed_at AS at, i.name AS inst, u.name AS approver
     FROM reports r LEFT JOIN institutions i ON i.id = r.institution_id LEFT JOIN users u ON u.id = r.reviewed_by
     WHERE r.code=$1 AND r.status='approved'`, [code]);
  if (r.rows[0]) {
    const x = r.rows[0];
    return res.json({ valid: true, type: "report", code, docType: KIND_NAMES[x.kind], title: x.title,
      scope: x.inst || "كل المؤسسات المشغلة (المستوى القومي)", period: x.period, approvedAt: x.at, approver: x.approver, summary: x.summary });
  }
  const p = await query(
    `SELECT p.plan_month, p.reviewed_at AS at, c.village, c.markaz, c.association, c.governorate, i.name AS inst, u.name AS approver,
            (SELECT count(*) FROM plan_items WHERE plan_id=p.id)::int AS items,
            (SELECT COALESCE(sum(expected_count),0) FROM plan_items WHERE plan_id=p.id)::int AS expected
     FROM monthly_plans p JOIN centers c ON c.id = p.center_id JOIN institutions i ON i.id = p.institution_id
     LEFT JOIN users u ON u.id = p.reviewed_by WHERE p.approval_code=$1 AND p.status='approved'`, [code]);
  if (p.rows[0]) {
    const x = p.rows[0];
    return res.json({ valid: true, type: "plan", code, docType: "الخطة الشهرية للأنشطة والفعاليات",
      title: `خطة ${monthLabel(x.plan_month)} – ${x.village}`, scope: `${x.inst}${x.association ? " · " + x.association : ""} · مركز ${x.markaz}، ${x.governorate}`,
      period: x.plan_month, approvedAt: x.at, approver: x.approver, summary: { "عدد الأنشطة المخططة": x.items, "المستفيدون المتوقعون": x.expected } });
  }
  res.json({ valid: false });
}));

// أرقام عامة عن هيكل المشروع للصفحة الرئيسية (بدون أي بيانات أنشطة أو مستفيدين)
router.get("/overview", ah(async (_req, res) => {
  const [n, axes] = await Promise.all([
    query(`SELECT (SELECT count(*) FROM institutions)::int AS institutions,
                  (SELECT count(*) FROM centers WHERE active)::int AS centers,
                  (SELECT count(DISTINCT governorate) FROM centers WHERE active)::int AS governorates`),
    query("SELECT name, description FROM activity_types WHERE active ORDER BY sort_order, name"),
  ]);
  res.set("Cache-Control", "public, max-age=300");
  res.json({ ...n.rows[0], axes: axes.rows });
}));

module.exports = router;
