const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const { loadUser, requireAuth, requireAdmin, requireAjaxHeader } = require("./middleware/auth");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => /^\/api\/(reports|exports)/.test(req.path) ? next() : express.json({ limit: "200kb" })(req, res, next));
app.use(cookieParser());
app.use((_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "SAMEORIGIN" });
  next();
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---- وضع التطوير: تحديث المتصفح تلقائيًا عند تعديل الملفات (npm run dev) ----
const devClients = new Set();
if (process.env.DEV_RELOAD) {
  app.get("/__dev/events", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders(); res.write("retry: 1000\n\n");
    devClients.add(res); req.on("close", () => devClients.delete(res));
  });
  process.on("message", m => { if (m === "reload") for (const c of devClients) c.write("event: reload\ndata: 1\n\n"); });
}
app.get("/__dev/reload.js", (_req, res) => {
  res.type("application/javascript").set("Cache-Control", "no-store");
  if (!process.env.DEV_RELOAD) return res.send("/* live reload is off (production) */");
  // يعيد تحميل الصفحة عند تعديل الواجهة، أو عند عودة الخادم بعد إعادة تشغيله
  res.send(`(()=>{let seen=false;const go=()=>{const es=new EventSource("/__dev/events");
    es.onopen=()=>{if(seen)location.reload();seen=true};
    es.addEventListener("reload",()=>location.reload());
    es.onerror=()=>{es.close();setTimeout(go,800)}};go();console.info("وضع التطوير: الصفحة تتحدث تلقائيًا عند تعديل الملفات")})();`);
});

const api = express.Router();
api.use(loadUser, requireAjaxHeader);
api.use("/auth", require("./routes/auth"));
api.use("/public", require("./routes/public"));
api.use("/meta", requireAuth, require("./routes/meta"));
api.use("/activities", requireAuth, require("./routes/activities"));
api.use("/photos", requireAuth, require("./routes/photos"));
api.use("/plans", requireAuth, require("./routes/plans"));
api.use("/approvals", requireAuth, require("./routes/approvals"));
api.use("/notifications", requireAuth, require("./routes/notifications"));
api.use("/reports", requireAuth, require("./routes/reports").router);
api.use("/exports", requireAuth, require("./routes/exports"));
api.use("/users", requireAdmin, require("./routes/users"));
api.use((_req, _res, next) => { const e = new Error("غير موجود"); e.status = 404; next(e); });
app.use("/api", api);

const PUB = path.join(__dirname, "..", "public");
// الصفحة الرئيسية: الزائر يرى الواجهة العامة للمشروع، والمستخدم المسجّل يدخل المنظومة مباشرة
app.get("/", loadUser, (req, res) => {
  res.set({ "Cache-Control": "no-cache", Vary: "Cookie" });
  res.sendFile(path.join(PUB, req.user ? "index.html" : "home.html"));
});
app.get("/login", loadUser, (req, res, next) => req.user ? res.redirect("/") : next());
// صفحة التحقق العامة من كود الاعتماد (رابط رمز QR)
app.get("/verify/:code", (_req, res) => res.sendFile(path.join(PUB, "verify.html")));
app.use(express.static(PUB, { extensions: ["html"], index: false }));

// JSON error handler for the API
app.use((err, _req, res, _next) => {
  if (err.code === "LIMIT_FILE_SIZE") err = Object.assign(new Error("حجم إحدى الصور كبير جدًا"), { status: 413 });
  const status = err.status || 500;
  if (status >= 500 && !err.expose) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.expose ? "حدث خطأ في الخادم. حاول مرة أخرى." : err.message, ...(err.extra || {}) });
});

module.exports = app;
