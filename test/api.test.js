// اختبارات تكامل لواجهة البرمجة. تحتاج قاعدة بيانات مهيأة (npm run db:init) وبيانات المدير في .env
// تشغيل: npm test
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const config = require("../src/config");
const app = require("../src/app");
const { pool } = require("../src/db/pool");

let server, base;
const stamp = Date.now().toString(36);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

function client() {
  let cookie = "";
  return async (method, url, body) => {
    const headers = { "X-Requested-With": "fetch" };
    if (cookie) headers.Cookie = cookie;
    if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    const r = await fetch(base + url, { method, headers, body });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, body: ct.includes("json") ? await r.json() : await r.arrayBuffer() };
  };
}
const batch = (center, acts, photos = {}) => {
  const fd = new FormData();
  fd.append("data", JSON.stringify({ center, activities: acts }));
  for (const [k, n] of Object.entries(photos)) for (let j = 0; j < n; j++) {
    fd.append(`p${k}_${j}_full`, new Blob([JPEG], { type: "image/jpeg" }), "f.jpg");
    fd.append(`p${k}_${j}_thumb`, new Blob([JPEG], { type: "image/jpeg" }), "t.jpg");
  }
  return fd;
};
const planMonth = "2025-02"; // شهر اختبار خارج الاستخدام الفعلي
const act = (title, extra = {}) => ({ date: today, type: "دعم الأسرة والتنشئة الإيجابية", title, kids: 5, women: 3, men: 0, ...extra });

const admin = client(), inst = client();
let instUserId, createdIds = [];

before(async () => {
  server = app.listen(0); await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await pool.query("DELETE FROM activities WHERE title LIKE $1", [`%${stamp}%`]);
  await pool.query("DELETE FROM monthly_plans WHERE plan_month = ANY($1)", [[planMonth, "2025-03"]]);
  await pool.query("DELETE FROM reports WHERE title LIKE $1", [`%${stamp}%`]);
  await pool.query("DELETE FROM notifications WHERE title LIKE $1 OR body LIKE $1", [`%${stamp}%`]);
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`%${stamp}%`]);
  server.close(); await pool.end();
});

test("rejects unauthenticated and header-less requests", async () => {
  assert.equal((await fetch(base + "/api/activities")).status, 401);
  const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(r.status, 403);
});

test("admin logs in and creates an institution account", async () => {
  assert.equal((await admin("POST", "/api/auth/login", { email: config.adminEmail, password: "wrong" })).status, 401);
  assert.equal((await admin("POST", "/api/auth/login", { email: config.adminEmail, password: config.adminPassword })).status, 200);
  const r = await admin("POST", "/api/users", { name: "منسق حياة كريمة", email: `hk-${stamp}@test.local`, password: "password123", role: "institution", institution_id: "hk" });
  assert.equal(r.status, 201); instUserId = r.body.user.id;
  assert.equal((await inst("POST", "/api/auth/login", { email: `hk-${stamp}@test.local`, password: "password123" })).status, 200);
  assert.equal((await inst("GET", "/api/users")).status, 403);
});

test("meta returns institutions, centers and types", async () => {
  const r = await inst("GET", "/api/meta");
  assert.equal(r.body.institutions.length, 10);
  assert.equal(r.body.institutions.reduce((s, i) => s + i.centers.length, 0), 47);
  assert.equal(r.body.types.length, 10);
});

test("batch needs at least 3 activities", async () => {
  const r = await inst("POST", "/api/activities/batch", batch("hk-01", [act(`ندوة أ ${stamp}`), act(`ندوة ب ${stamp}`)]));
  assert.equal(r.status, 422);
});

test("institution cannot register for another institution's center", async () => {
  const r = await inst("POST", "/api/activities/batch", batch("mk-01", [act(`أ ${stamp} 1`), act(`ب ${stamp} 2`), act(`ج ${stamp} 3`)]));
  assert.equal(r.status, 403);
});

test("valid batch with photos is saved; duplicates are rejected", async () => {
  const acts = [act(`ندوة التغذية ${stamp}`), act(`يوم رياضي ${stamp}`, { type: "الأنشطة الرياضية والبدنية", kids: 40 }), act(`قافلة طبية ${stamp}`, { type: "الرعاية الصحية والتوعية", men: 9 })];
  const r = await inst("POST", "/api/activities/batch", batch("hk-01", acts, { 0: 2 }));
  assert.equal(r.status, 201, JSON.stringify(r.body)); createdIds = r.body.ids;

  // in-batch duplicate (title differs only by hamza/ta marbuta → same normalized title)
  const d1 = await inst("POST", "/api/activities/batch", batch("hk-01", [act(`أمسية ثقافية ${stamp}`), act(`امسيه ثقافيه ${stamp}`), act(`ورشة ${stamp} x`)]));
  assert.equal(d1.status, 422); assert.ok(d1.body.errors["1"]);
  // duplicate of something already stored this month
  const d2 = await inst("POST", "/api/activities/batch", batch("hk-01", [act(`ندوه التغذيه ${stamp}`), act(`جديد ${stamp} 1`), act(`جديد ${stamp} 2`)]));
  assert.equal(d2.status, 422); assert.match(d2.body.errors["0"], /سبق تسجيل/);
  // future date
  const d3 = await inst("POST", "/api/activities/batch", batch("hk-02", [act(`مستقبل ${stamp}`, { date: "2999-01-01" }), act(`ق ${stamp} 1`), act(`ق ${stamp} 2`)]));
  assert.equal(d3.status, 422);
});

test("listing is scoped, photos are served", async () => {
  const mine = (await inst("GET", "/api/activities")).body.activities;
  assert.ok(mine.every(a => a.inst === "hk"));
  const a = mine.find(x => x.title === `ندوة التغذية ${stamp}`);
  assert.equal(a.photos, 2); assert.equal(a.byName, "منسق حياة كريمة");
  const ph = await inst("GET", `/api/photos/${a.mediaIds[0]}/thumb`);
  assert.equal(ph.status, 200); assert.ok(ph.body.byteLength > 0);
  const all = (await admin("GET", "/api/activities")).body.activities;
  assert.ok(all.length >= mine.length);
});

test("monthly plan: validation, submit, lock, review", async () => {
  await pool.query("DELETE FROM monthly_plans WHERE plan_month=$1", [planMonth]);
  const item = (title, extra = {}) => ({ title, type: "تنمية ورعاية الطفل", target: "أطفال الحضانة", expected: 25,
    date: planMonth + "-10", start: "09:00", end: "11:00", partner: "الوحدة الصحية", responsible: "أ. منى", ...extra });
  const empty = await inst("GET", `/api/plans/hk-01/${planMonth}`);
  assert.equal(empty.body.plan.status, "none");
  // other institution's center
  assert.equal((await inst("PUT", `/api/plans/mk-01/${planMonth}`, { items: [] })).status, 403);
  // time outside 07:30–17:00, date outside month, missing responsible
  const bad = await inst("PUT", `/api/plans/hk-01/${planMonth}`, { items: [
    item(`نشاط مبكر ${stamp}`, { start: "07:00" }), item(`نشاط متأخر ${stamp}`, { end: "17:30" }),
    item(`شهر آخر ${stamp}`, { date: "2025-03-01" }), item(`بلا مسؤول ${stamp}`, { responsible: "" }),
    item(`يوم جمعة ${stamp}`, { date: planMonth + "-14" }), item(`يوم سبت ${stamp}`, { date: planMonth + "-15" })] });
  assert.equal(bad.status, 422); assert.deepEqual(Object.keys(bad.body.errors), ["0", "1", "2", "3", "4", "5"]);
  assert.match(bad.body.errors["4"], /الجمعة/); assert.match(bad.body.errors["5"], /السبت/);
  // draft save, then submit needs >= 3 items
  const d = await inst("PUT", `/api/plans/hk-01/${planMonth}`, { items: [item(`ندوة ${stamp}`)] });
  assert.equal(d.status, 200); assert.equal(d.body.plan.status, "draft");
  assert.equal((await inst("PUT", `/api/plans/hk-01/${planMonth}`, { items: [item(`ندوة ${stamp}`)], submit: true })).status, 422);
  const items = [item(`ندوة ${stamp}`), item(`يوم رياضي ${stamp}`, { type: "الأنشطة الرياضية والبدنية", date: planMonth + "-17", start: "13:00", end: "16:00" }),
    item(`احتفال ${stamp}`, { type: "الأنشطة الترفيهية والمناسبات", date: planMonth + "-24", end: "16:00" })];
  const s = await inst("PUT", `/api/plans/hk-01/${planMonth}`, { items, submit: true });
  assert.equal(s.status, 200); assert.equal(s.body.plan.status, "submitted"); assert.equal(s.body.plan.items.length, 3);
  assert.equal(s.body.plan.items[1].start, "13:00");
  // locked for the institution while submitted
  assert.equal((await inst("PUT", `/api/plans/hk-01/${planMonth}`, { items })).status, 409);
  // review is admin-only; return needs a note; then institution can edit again
  assert.equal((await inst("POST", `/api/plans/${s.body.plan.id}/review`, { action: "approve" })).status, 403);
  assert.equal((await admin("POST", `/api/plans/${s.body.plan.id}/review`, { action: "return" })).status, 422);
  const r = await admin("POST", `/api/plans/${s.body.plan.id}/review`, { action: "return", note: "أضيفوا نشاطًا صحيًا" });
  assert.equal(r.body.plan.status, "returned");
  assert.equal((await inst("PUT", `/api/plans/hk-01/${planMonth}`, { items, submit: true })).status, 200);
  const a = await admin("POST", `/api/plans/${s.body.plan.id}/review`, { action: "approve" });
  assert.equal(a.body.plan.status, "approved");
  const sum = await inst("GET", `/api/plans?from=${planMonth}&to=${planMonth}`);
  assert.deepEqual(sum.body.plans.map(p => [p.center, p.items, p.expected]), [["hk-01", 3, 75]]);
});

test("deleting: owner and admin only; deactivated user is logged out", async () => {
  const other = client();
  const cu = await admin("POST", "/api/users", { name: "مستخدم آخر", email: `x-${stamp}@test.local`, password: "password123", role: "institution", institution_id: "hk" });
  const lo = await other("POST", "/api/auth/login", { email: `x-${stamp}@test.local`, password: "password123" });
  assert.equal(lo.status, 200, JSON.stringify(lo.body));
  assert.equal((await other("DELETE", `/api/activities/${createdIds[0]}`)).status, 403);
  assert.equal((await inst("DELETE", `/api/activities/${createdIds[0]}`)).status, 200);
  assert.equal((await admin("DELETE", `/api/activities/${createdIds[1]}`)).status, 200);
  assert.equal((await admin("PATCH", `/api/users/${instUserId}`, { active: false })).status, 200);
  assert.equal((await inst("GET", "/api/activities")).status, 401);
});
