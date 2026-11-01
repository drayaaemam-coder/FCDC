const router = require("express").Router();
const path = require("path");
const config = require("../config");
const { query } = require("../db/pool");
const { HttpError, ah } = require("../lib/util");

// GET /api/photos/:id/thumb  |  /api/photos/:id/full
router.get("/:id/:size", ah(async (req, res) => {
  if (!["thumb", "full"].includes(req.params.size)) throw new HttpError(404, "غير موجود");
  const { rows } = await query(
    `SELECT p.full_file, p.thumb_file, a.institution_id FROM photos p JOIN activities a ON a.id = p.activity_id WHERE p.id=$1`,
    [Number(req.params.id)]);
  const p = rows[0];
  if (!p || (req.user.role !== "admin" && p.institution_id !== req.user.institution_id)) throw new HttpError(404, "الصورة غير موجودة");
  const file = path.join(config.uploadDir, req.params.size === "thumb" ? p.thumb_file : p.full_file);
  if (!file.startsWith(config.uploadDir + path.sep)) throw new HttpError(404, "الصورة غير موجودة");
  res.set("Cache-Control", "private, max-age=86400");
  res.sendFile(file, err => { if (err && !res.headersSent) res.status(404).end(); });
}));

module.exports = router;
