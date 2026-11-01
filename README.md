# منظومة متابعة أنشطة مراكز تنمية الأسرة والطفولة

نسخة كاملة (Full-stack) من النموذج الأولي: **Node.js + Express** للخادم، و**PostgreSQL** لقاعدة البيانات، وواجهة HTML/JS بنفس تصميم النموذج.

## ما الذي تغيّر عن النموذج الأولي

| النموذج الأولي | النسخة الكاملة |
|---|---|
| الدخول بحساب Claude | حسابات خاصة بالمنظومة (بريد + كلمة مرور) ودوران: **إدارة المشروع** و**مؤسسة مشغلة** |
| المدير = من يملك صلاحية تعديل الصفحة | تبويب **الحسابات** لإنشاء حسابات المؤسسات وإيقافها وتغيير كلمات المرور |
| البيانات في قاعدة Claude | جداول SQL في PostgreSQL (انظر `src/db/schema.sql`) |
| الصور كنصوص base64 داخل القاعدة | ملفات JPEG في مجلد `uploads/`، والقاعدة تحفظ مساراتها فقط |
| فحص التكرار في المتصفح فقط | الفحص في المتصفح **و** في الخادم، مع قيد `UNIQUE` في القاعدة |
| الحفظ نشاطًا نشاطًا | الدفعة كلها تُحفظ في معاملة واحدة (كلها أو لا شيء) |
| كل مستخدم يحمّل كل البيانات | حساب المؤسسة لا يرى إلا أنشطة وصور مؤسسته |

قواعد العمل كما هي: ٣ أنشطة على الأقل في كل تسجيل، لا نشاط مكرر (نفس العنوان في نفس المركز خلال الشهر، أو نفس التاريخ والنوع وعدد الحضور)، حتى ٤ صور لكل نشاط، لا تواريخ مستقبلية.

## التشغيل

### الطريقة الأسهل: Docker
```bash
docker compose up -d
```
افتح http://localhost:3000 وادخل بـ `admin@example.com` / `change-me-now` ثم غيّر كلمة المرور فورًا.

#### لو Docker مش شغال
| العَرَض | الحل |
|---|---|
| `docker: command not found` أو `Cannot connect to the Docker daemon` | ثبّت Docker Desktop وافتحه واستنّى لحد ما يقول Running، ثم أعد الأمر |
| `docker-compose: command not found` | الإصدارات الحديثة: `docker compose` (بمسافة). القديمة: ثبّت `docker-compose` |
| `port is already allocated` / `address already in use` | المنفذ 3000 مستخدم: غيّر `"3000:3000"` في `docker-compose.yml` إلى `"8080:3000"` وافتح http://localhost:8080 |
| فشل `npm ci` أثناء البناء | تأكد من الاتصال بالإنترنت، ثم `docker compose build --no-cache` |
| بيرجعك لصفحة الدخول بعد الدخول | تأكد إنك على آخر نسخة (تم إصلاحه) ثم `docker compose up -d --build` |
| غيّرت بيانات المدير ومش بتشتغل | حساب المدير يُنشأ أول مرة فقط. للبدء من الصفر: `docker compose down -v` ثم `docker compose up -d --build` (يمسح كل البيانات) |

لمعرفة سبب أي مشكلة: `docker compose logs app`

### بدون Docker
المتطلبات: Node.js 18+ و PostgreSQL 13+.
```bash
npm install
cp .env.example .env        # عدّل DATABASE_URL و JWT_SECRET وبيانات المدير
createdb fcdc               # أو أنشئ القاعدة من pgAdmin
npm run db:init             # ينشئ الجداول ويضيف المؤسسات والمراكز وحساب المدير
npm start
```
`npm run db:init` آمن للتكرار: يحدّث بيانات المؤسسات والمراكز من `src/db/seed-data.js` دون حذف أي أنشطة.

### الاختبارات
```bash
npm test
```
تختبر تسجيل الدخول، الصلاحيات، قاعدة الحد الأدنى، كشف التكرار، رفع الصور، والحذف (تحتاج قاعدة بيانات مهيأة).

## هيكل المشروع
```
src/
  server.js            نقطة التشغيل
  app.js               إعداد Express والمسارات
  config.js            الإعدادات من .env
  db/schema.sql        الجداول
  db/seed-data.js      المؤسسات (10) والمراكز (47) وأنواع الأنشطة
  db/init.js           تهيئة القاعدة
  middleware/auth.js   الجلسات (JWT في كوكي httpOnly) والصلاحيات
  routes/              auth · meta · activities · photos · users
public/
  index.html, login.html, css/app.css, js/app.js, img/ (الشعارات)
uploads/               صور التوثيق (يجب أخذ نسخة احتياطية منه مع القاعدة)
```

## واجهة البرمجة (API)
| الطريقة | المسار | الوصف |
|---|---|---|
| POST | `/api/auth/login` · `/logout` · `/password` | الدخول والخروج وتغيير كلمة المرور |
| GET | `/api/auth/me` | المستخدم الحالي |
| GET | `/api/meta` | المؤسسات والمراكز والأنواع والقواعد |
| GET | `/api/activities?from&to&inst&center` | الأنشطة (مقيّدة بمؤسسة المستخدم) |
| POST | `/api/activities/batch` | حفظ دفعة أنشطة مع الصور (multipart) |
| DELETE | `/api/activities/:id` | حذف (المدير أو من سجّله) |
| GET | `/api/photos/:id/thumb` · `/full` | الصور |
| GET/POST/PATCH | `/api/users` | إدارة الحسابات (للمدير) |

كل طلب يغيّر بيانات يجب أن يحمل الترويسة `X-Requested-With: fetch` (حماية من CSRF).

## النشر على الإنترنت
- يصلح لأي استضافة Node (Render, Railway, VPS…) مع PostgreSQL مُدار (Neon, Supabase…) — اضبط `DATABASE_SSL=true` عند الحاجة.
- اضبط `NODE_ENV=production` و `JWT_SECRET` طويل وعشوائي، وشغّل خلف HTTPS.
- مجلد `uploads/` يجب أن يكون على قرص دائم (Volume). على الاستضافات التي تمسح القرص عند كل نشر، انقل الصور لخدمة تخزين مثل S3/Cloudflare R2.
- خذ نسخة احتياطية دورية: `pg_dump` للقاعدة + نسخ مجلد `uploads/`.
