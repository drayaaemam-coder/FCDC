// التنبيهات + عدادات المهام (تُستدعى دوريًا من الواجهة)
const router = require("express").Router();
const { query } = require("../db/pool");
const { ah } = require("../lib/util");

async function counts(user) {
  if (user.role === "admin") {
    const { rows } = await query(`SELECT
      (SELECT count(*) FROM monthly_plans WHERE status='submitted')::int AS plans,
      (SELECT count(DISTINCT batch_id) FROM activities WHERE status='pending')::int AS batches,
      (SELECT count(*) FROM activities WHERE status='pending')::int AS activities,
      (SELECT count(*) FROM reports WHERE status='submitted')::int AS reports`);
    const c = rows[0];
    return { ...c, pending: c.plans + c.batches + c.reports };
  }
  const { rows } = await query(`SELECT
    (SELECT count(*) FROM monthly_plans WHERE status='returned' AND institution_id=$1)::int AS plans,
    (SELECT count(*) FROM activities WHERE status='returned' AND institution_id=$1)::int AS activities,
    (SELECT count(*) FROM reports WHERE status='returned' AND institution_id=$1)::int AS reports,
    (SELECT count(*) FROM monthly_plans WHERE status='submitted' AND institution_id=$1)::int
      + (SELECT count(DISTINCT batch_id) FROM activities WHERE status='pending' AND institution_id=$1)::int
      + (SELECT count(*) FROM reports WHERE status='submitted' AND institution_id=$1)::int AS review`, [user.institution_id]);
  const c = rows[0];
  return { ...c, action: c.plans + c.activities + c.reports };
}

router.get("/", ah(async (req, res) => {
  const [list, unread, c] = await Promise.all([
    query(`SELECT id, kind, title, body, link, created_at AS at, read_at IS NOT NULL AS read
           FROM notifications WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 40`, [req.user.id]),
    query("SELECT count(*)::int AS n, COALESCE(max(id),0) AS last FROM notifications WHERE user_id=$1 AND read_at IS NULL", [req.user.id]),
    counts(req.user),
  ]);
  res.json({ items: list.rows, unread: unread.rows[0].n, lastUnread: unread.rows[0].last, counts: c });
}));

// POST /api/notifications/read {ids:[..]} or {all:true}
router.post("/read", ah(async (req, res) => {
  if (req.body.all) await query("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL", [req.user.id]);
  else {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger);
    if (ids.length) await query("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id = ANY($2) AND read_at IS NULL", [req.user.id, ids]);
  }
  res.json({ ok: true });
}));

module.exports = router;
