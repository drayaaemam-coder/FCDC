require("dotenv").config({ quiet: true });
const path = require("path");

const env = process.env;
const config = {
  port: Number(env.PORT || 3000),
  isProd: env.NODE_ENV === "production",
  databaseUrl: env.DATABASE_URL || "postgres://fcdc:fcdc@localhost:5432/fcdc",
  databaseSsl: env.DATABASE_SSL === "true",
  jwtSecret: env.JWT_SECRET,
  uploadDir: path.resolve(env.UPLOAD_DIR || path.join(__dirname, "..", "uploads")),
  // مكان حفظ صور الأنشطة: disk = مجلد uploads (الافتراضي)، db = داخل قاعدة البيانات
  // (للاستضافات التي تمسح القرص عند كل إعادة تشغيل مثل الخطة المجانية في Render)
  photoStorage: env.PHOTO_STORAGE === "db" ? "db" : "disk",
  adminName: env.ADMIN_NAME || "مدير المنظومة",
  adminEmail: env.ADMIN_EMAIL,
  adminPassword: env.ADMIN_PASSWORD,
  // قواعد العمل
  minPerBatch: 3,
  minPerMonth: 3,
  maxPhotos: 4,
  startMonth: env.START_MONTH || "2024-09",
  // الرابط العام للموقع (يُطبع في رمز QR للتحقق من التقارير). مثال: https://fcdc.example.org
  publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || "",
  // مسار متصفح Chrome/Chromium لتوليد ملفات PDF (يُكتشف تلقائيًا إن تُرك فارغًا)
  chromePath: env.CHROME_PATH || "",
  // ضوابط الخطة الشهرية: الفترة التشغيلية للمراكز، وعدد الشهور المسموح بالتخطيط لها مقدمًا
  dayStart: "07:30",
  dayEnd: "17:00",
  weekendDays: [5, 6], // الجمعة والسبت (0 = الأحد) — لا تُقبل أنشطة في الخطة في هذين اليومين
  planMonthsAhead: 3,
};

if (!config.jwtSecret) {
  if (config.isProd) throw new Error("JWT_SECRET is required in production");
  config.jwtSecret = "dev-only-secret-change-me";
}

module.exports = config;
