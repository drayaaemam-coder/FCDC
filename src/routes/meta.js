const router = require("express").Router();
const { query } = require("../db/pool");
const config = require("../config");
const { ah, todayCairo } = require("../lib/util");

// Reference data the front end needs: institutions → centers, activity types, business rules
router.get("/", ah(async (_req, res) => {
  const [inst, centers, types] = await Promise.all([
    query("SELECT id, name FROM institutions ORDER BY sort_order, name"),
    query("SELECT id, institution_id AS inst, governorate AS gov, markaz AS mk, village AS vil FROM centers WHERE active ORDER BY id"),
    query("SELECT name FROM activity_types ORDER BY sort_order, name"),
  ]);
  res.json({
    institutions: inst.rows.map(i => ({ ...i, centers: centers.rows.filter(c => c.inst === i.id) })),
    types: types.rows.map(t => t.name),
    rules: { minPerBatch: config.minPerBatch, minPerMonth: config.minPerMonth, maxPhotos: config.maxPhotos, startMonth: config.startMonth },
    today: todayCairo(),
  });
}));

module.exports = router;
