const router = require("express").Router();
const { query } = require("../db/pool");
const config = require("../config");
const { ah, todayCairo } = require("../lib/util");
const { OCCASIONS, MOVABLE_OCCASIONS } = require("../db/seed-data");

// Reference data the front end needs: institutions → centers, activity types, business rules
router.get("/", ah(async (_req, res) => {
  const [inst, centers, types] = await Promise.all([
    query("SELECT id, name FROM institutions ORDER BY sort_order, name"),
    query("SELECT id, institution_id AS inst, governorate AS gov, markaz AS mk, village AS vil, association AS assoc FROM centers WHERE active ORDER BY id"),
    query("SELECT name, description FROM activity_types WHERE active ORDER BY sort_order, name"),
  ]);
  res.json({
    institutions: inst.rows.map(i => ({ ...i, centers: centers.rows.filter(c => c.inst === i.id) })),
    types: types.rows.map(t => t.name),
    axes: types.rows.map(t => ({ name: t.name, desc: t.description })),
    occasions: OCCASIONS.map(([month, day, name]) => ({ month, day, name })),
    movableOccasions: MOVABLE_OCCASIONS,
    rules: { minPerBatch: config.minPerBatch, minPerMonth: config.minPerMonth, maxPhotos: config.maxPhotos, startMonth: config.startMonth,
      dayStart: config.dayStart, dayEnd: config.dayEnd, weekendDays: config.weekendDays, planMonthsAhead: config.planMonthsAhead },
    today: todayCairo(),
  });
}));

module.exports = router;
