// دورة الاعتماد الكاملة بين حسابات المؤسسات وإدارة المشروع
// تشغيل: npm test   (تحتاج قاعدة بيانات مهيأة وبيانات المدير في .env، و Chrome لاختبار PDF)
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const config = require("../src/config");
const app = require("../src/app");
const { pool } = require("../src/db/pool");

let server, base;
const stamp = "wf" + Date.now().toString(36);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const PM = "2025-04"; // plan month used only by this test

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
const batch = (center, acts) => { const fd = new FormData(); fd.append("data", JSON.stringify({ center, activities: acts })); return fd; };
const act = (title, extra = {}) => ({ date: today, type: "دعم الأسرة والتنشئة الإيجابية", title, kids: 5, women: 3, men: 0, ...extra });
const admin = client(), hk = client(), mk = client();

before(async () => {
  server = app.listen(0); await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await admin("POST", "/api/auth/login", { email: config.adminEmail, password: config.adminPassword })).status, 200);
  for (const [c, inst] of [[hk, "hk"], [mk, "mk"]]) {
    const email = `${inst}-${stamp}@test.local`;
    assert.equal((await admin("POST", "/api/users", { name: `منسق ${inst} ${stamp}`, email, password: "password123", role: "institution", institution_id: inst })).status, 201);
    assert.equal((await c("POST", "/api/auth/login", { email, password: "password123" })).status, 200);
  }
});
after(async () => {
  await pool.query("DELETE FROM activities WHERE title LIKE $1", [`%${stamp}%`]);
  await pool.query("DELETE FROM monthly_plans WHERE plan_month=$1", [PM]);
  await pool.query("DELETE FROM reports WHERE title LIKE $1", [`%${stamp}%`]);
  await pool.query("DELETE FROM notifications WHERE title LIKE $1 OR body LIKE $1", [`%${stamp}%`]);
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`%${stamp}%`]);
  await require("../src/lib/pdf").closeBrowser();
  server.close(); await pool.end();
});

test("activities: submit → return → edit → approve, with notifications and timeline", async () => {
  const unread0 = (await admin("GET", "/api/notifications")).body.unread;
  const r = await hk("POST", "/api/activities/batch", batch("hk-03", [act(`دورة ${stamp} أ`), act(`دورة ${stamp} ب`, { type: "التعليم وتنمية المهارات" }), act(`دورة ${stamp} ج`, { type: "الأنشطة الثقافية والفنية" })]));
  assert.equal(r.status, 201); assert.equal(r.body.status, "pending");
  const [a1, a2, a3] = r.body.ids;
  let n = (await admin("GET", "/api/notifications")).body;
  assert.equal(n.unread, unread0 + 1); assert.equal(n.items[0].kind, "batch_submitted"); assert.ok(n.counts.pending >= 1);
  assert.ok((await admin("GET", "/api/approvals")).body.items.some(i => i.type === "batch" && i.id === r.body.batch && i.activities.length === 3));
  assert.ok(!(await mk("GET", "/api/approvals")).body.items.some(i => i.id === r.body.batch), "other institution must not see it");

  assert.equal((await admin("POST", "/api/activities/review", { ids: [a2], action: "return" })).status, 422, "return needs a note");
  assert.equal((await hk("POST", "/api/activities/review", { ids: [a2], action: "approve" })).status, 403);
  assert.equal((await admin("POST", "/api/activities/review", { ids: [a2], action: "return", note: `أضيفوا عدد الحضور ${stamp}` })).status, 200);
  n = (await hk("GET", "/api/notifications")).body;
  assert.equal(n.items[0].kind, "batch_returned"); assert.equal(n.counts.action, 1);

  assert.equal((await mk("PATCH", `/api/activities/${a2}`, act(`دورة ${stamp} ب`))).status, 404);
  const e = await hk("PATCH", `/api/activities/${a2}`, act(`دورة ${stamp} ب معدلة`, { type: "التعليم وتنمية المهارات", kids: 12 }));
  assert.equal(e.status, 200, JSON.stringify(e.body)); assert.equal(e.body.activity.status, "pending"); assert.equal(e.body.activity.kids, 12);
  assert.equal((await admin("GET", "/api/notifications")).body.items[0].kind, "activity_resubmitted");

  assert.equal((await admin("POST", "/api/activities/review", { ids: [a1, a2, a3], action: "approve" })).status, 200);
  assert.equal((await hk("GET", "/api/notifications")).body.items[0].kind, "batch_approved");
  assert.equal((await hk("PATCH", `/api/activities/${a1}`, act(`تغيير ${stamp}`))).status, 409);
  assert.equal((await hk("DELETE", `/api/activities/${a1}`)).status, 409);
  assert.deepEqual((await hk("GET", `/api/approvals/timeline/batch/${r.body.batch}`)).body.events.map(x => x.action), ["submitted", "returned", "resubmitted", "approved"]);
  assert.equal((await mk("GET", `/api/approvals/timeline/batch/${r.body.batch}`)).status, 404);
});

test("plan: submit → return → resubmit → approve with a verifiable code", async () => {
  const item = (title, d) => ({ title, type: "تنمية ورعاية الطفل", target: "أطفال", expected: 20, date: `${PM}-${d}`, start: "09:00", end: "11:00", responsible: "أ. منى" });
  const items = [item(`أ ${stamp}`, "06"), item(`ب ${stamp}`, "13"), item(`ج ${stamp}`, "20")];
  const ps = await hk("PUT", `/api/plans/hk-03/${PM}`, { items, submit: true });
  assert.equal(ps.status, 200, JSON.stringify(ps.body));
  assert.equal((await admin("GET", "/api/notifications")).body.items[0].kind, "plan_submitted");
  assert.ok((await admin("GET", "/api/approvals")).body.items.some(i => i.type === "plan" && i.id === ps.body.plan.id));
  await admin("POST", `/api/plans/${ps.body.plan.id}/review`, { action: "return", note: `أضيفوا نشاطًا صحيًا ${stamp}` });
  assert.equal((await hk("GET", "/api/notifications")).body.items[0].kind, "plan_returned");
  assert.equal((await hk("PUT", `/api/plans/hk-03/${PM}`, { items, submit: true })).status, 200);
  const pa = await admin("POST", `/api/plans/${ps.body.plan.id}/review`, { action: "approve" });
  assert.match(pa.body.plan.code, /^FCDC-P\d{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.match(pa.body.plan.approval.qr, /^data:image\/png;base64,/);
  assert.equal((await hk("GET", "/api/notifications")).body.items[0].kind, "plan_approved");
  const v = await fetch(`${base}/api/public/verify/${pa.body.plan.code}`).then(x => x.json());
  assert.equal(v.valid, true); assert.equal(v.type, "plan"); assert.equal(v.summary["عدد الأنشطة المخططة"], 3);
  assert.deepEqual((await hk("GET", `/api/approvals/timeline/plan/${ps.body.plan.id}`)).body.events.map(x => x.action),
    ["created", "submitted", "returned", "resubmitted", "approved"]);
});

test("reports: institution request → return → resubmit → approve; admin issues directly; verify", async () => {
  const body = `<div class="r-cover"><h1>تقرير ${stamp}</h1></div>`.padEnd(200, " ");
  assert.equal((await hk("POST", "/api/reports", { kind: "m", period: PM, inst: null, title: `تقرير ${stamp}`, body })).status, 403);
  assert.equal((await hk("POST", "/api/reports", { kind: "m", period: PM, inst: "mk", title: `تقرير ${stamp}`, body })).status, 403);
  const rs = await hk("POST", "/api/reports", { kind: "m", period: PM, inst: "hk", title: `تقرير أبريل ${stamp}`, body, summary: { "الأنشطة": 3 } });
  assert.equal(rs.status, 201); assert.equal(rs.body.report.status, "submitted"); assert.equal(rs.body.report.code, null);
  assert.equal((await hk("POST", "/api/reports", { kind: "m", period: PM, inst: "hk", title: `تقرير أبريل ${stamp}`, body })).status, 409);
  assert.equal((await admin("GET", "/api/notifications")).body.items[0].kind, "report_submitted");
  await admin("POST", `/api/reports/${rs.body.report.id}/review`, { action: "return", note: `حدّثوا الأرقام ${stamp}` });
  assert.equal((await hk("GET", "/api/notifications")).body.items[0].kind, "report_returned");
  assert.equal((await hk("PUT", `/api/reports/${rs.body.report.id}`, { title: `تقرير أبريل ${stamp}`, body, summary: { "الأنشطة": 3 } })).body.report.status, "submitted");
  const ra = await admin("POST", `/api/reports/${rs.body.report.id}/review`, { action: "approve" });
  assert.match(ra.body.report.code, /^FCDC-R/);
  const full = await hk("GET", `/api/reports/${rs.body.report.id}`);
  assert.ok(full.body.report.body.includes(stamp)); assert.match(full.body.report.approval.verifyUrl, /\/verify\/FCDC-R/);
  const vr = await fetch(`${base}/api/public/verify/${ra.body.report.code}`).then(x => x.json());
  assert.equal(vr.valid, true); assert.equal(vr.summary["الأنشطة"], 3);
  assert.equal((await fetch(`${base}/api/public/verify/FCDC-R0000-AAAA-BBBB`).then(x => x.json())).valid, false);
  assert.equal((await mk("GET", `/api/reports/${rs.body.report.id}`)).status, 404);
  assert.deepEqual((await hk("GET", `/api/approvals/timeline/report/${rs.body.report.id}`)).body.events.map(x => x.action), ["submitted", "returned", "resubmitted", "approved"]);
  const nr = await admin("POST", "/api/reports", { kind: "q", period: "2025-Q2", inst: null, title: `التقرير القومي ${stamp}`, body });
  assert.equal(nr.body.report.status, "approved"); assert.ok(nr.body.report.code);
  const verifyPage = await fetch(`${base}/verify/${nr.body.report.code}`); assert.equal(verifyPage.status, 200);
});

test("PDF export and notifications read", async () => {
  const pdf = await hk("POST", "/api/exports/pdf", { html: `<!doctype html><html lang="ar"><head><meta charset="utf-8"></head><body><h1>اختبار ${stamp}</h1></body></html>` });
  assert.equal(pdf.status, 200); assert.equal(Buffer.from(pdf.body).subarray(0, 4).toString(), "%PDF");
  await hk("POST", "/api/notifications/read", { all: true });
  assert.equal((await hk("GET", "/api/notifications")).body.unread, 0);
});
