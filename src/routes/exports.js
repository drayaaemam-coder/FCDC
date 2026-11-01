// POST /api/exports/pdf {html, filename} → ملف PDF
const router = require("express").Router();
const express = require("express");
const { HttpError, ah } = require("../lib/util");
const { htmlToPdf } = require("../lib/pdf");

router.post("/pdf", express.json({ limit: "45mb" }), ah(async (req, res) => {
  const html = String(req.body.html || "");
  if (html.length < 50 || !/^<!doctype html>/i.test(html.trim())) throw new HttpError(422, "محتوى غير صالح");
  let pdf;
  try { pdf = await htmlToPdf(html); }
  catch (e) {
    if (e.code === "NO_CHROME") throw new HttpError(503, "تصدير PDF غير متاح على هذا الخادم (لم يُعثر على متصفح Chrome). استخدم التنزيل بصيغة HTML ثم الطباعة إلى PDF.");
    throw e;
  }
  const name = String(req.body.filename || "report.pdf").replace(/[\\/:*?"<>|\r\n]+/g, "-").slice(0, 150);
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(name)}` });
  res.end(Buffer.from(pdf));
}));

module.exports = router;
