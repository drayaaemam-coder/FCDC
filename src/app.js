const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const { loadUser, requireAuth, requireAdmin, requireAjaxHeader } = require("./middleware/auth");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());
app.use((_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "SAMEORIGIN" });
  next();
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

const api = express.Router();
api.use(loadUser, requireAjaxHeader);
api.use("/auth", require("./routes/auth"));
api.use("/meta", requireAuth, require("./routes/meta"));
api.use("/activities", requireAuth, require("./routes/activities"));
api.use("/photos", requireAuth, require("./routes/photos"));
api.use("/plans", requireAuth, require("./routes/plans"));
api.use("/users", requireAdmin, require("./routes/users"));
api.use((_req, _res, next) => { const e = new Error("غير موجود"); e.status = 404; next(e); });
app.use("/api", api);

app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"] }));

// JSON error handler for the API
app.use((err, _req, res, _next) => {
  if (err.code === "LIMIT_FILE_SIZE") err = Object.assign(new Error("حجم إحدى الصور كبير جدًا"), { status: 413 });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "حدث خطأ في الخادم. حاول مرة أخرى." : err.message, ...(err.extra || {}) });
});

module.exports = app;
