// وضع التطوير: أي تعديل في الملفات يظهر فورًا
//  - تعديل في public/ (الواجهة)  → المتصفح يعيد تحميل الصفحة تلقائيًا
//  - تعديل في src/ (الخادم)      → الخادم يعيد التشغيل تلقائيًا ثم يتحدث المتصفح
//  - تعديل في src/db/            → تُطبَّق تغييرات قاعدة البيانات أولًا (npm run db:init)
// يعتمد على فحص دوري للملفات (polling) لأنه الطريقة الوحيدة الموثوقة مع Docker على Windows.
const { fork, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WATCH = ["src", "public"];
const INTERVAL = Number(process.env.DEV_POLL_MS || 700);

function snapshot() {
  const out = new Map();
  const walk = dir => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else { try { const s = fs.statSync(p); out.set(p, s.mtimeMs + ":" + s.size); } catch { /* removed meanwhile */ } }
    }
  };
  WATCH.forEach(d => walk(path.join(ROOT, d)));
  return out;
}
function diff(a, b) {
  const changed = [];
  for (const [f, v] of b) if (a.get(f) !== v) changed.push(f);
  for (const f of a.keys()) if (!b.has(f)) changed.push(f);
  return changed;
}

let child = null, restarting = false;
function start() {
  const c = fork(path.join(ROOT, "src", "server.js"), [], { env: { ...process.env, DEV_RELOAD: "1" }, stdio: "inherit" });
  c.on("exit", code => {
    if (!restarting && code) console.log(`\n✗ الخادم توقف (كود ${code}). صحّح الخطأ واحفظ الملف وسيعيد التشغيل تلقائيًا.`);
    if (child === c) child = null;
  });
  child = c;
}
function restart(dbChanged) {
  restarting = true;
  const go = () => {
    restarting = false;
    if (dbChanged) {
      console.log("↻ تحديث قاعدة البيانات…");
      spawnSync(process.execPath, [path.join(ROOT, "src", "db", "init.js")], { stdio: "inherit", env: process.env });
    }
    start();
  };
  const old = child;
  if (old) {
    old.once("exit", go);
    old.kill("SIGTERM");
    // only ever force-kill the OLD server, never the freshly started one
    setTimeout(() => { if (old.exitCode === null && old.signalCode === null) old.kill("SIGKILL"); }, 4000);
  } else go();
}

let last = snapshot();
start();
console.log(`👀 وضع التطوير: أي تعديل في ${WATCH.join(" و ")} يظهر فورًا (فحص كل ${INTERVAL}ms)`);
setInterval(() => {
  const now = snapshot(), changed = diff(last, now);
  last = now;
  if (!changed.length) return;
  const rel = changed.map(f => path.relative(ROOT, f).replace(/\\/g, "/"));
  if (rel.some(f => f.startsWith("src/"))) {
    console.log("↻ تعديل في الخادم:", rel.join("، "));
    restart(rel.some(f => f.startsWith("src/db/")));
  } else {
    console.log("↻ تعديل في الواجهة:", rel.join("، "));
    if (child && child.connected) child.send("reload");
  }
}, INTERVAL);

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restarting = true; if (child) child.kill(sig); process.exit(0); });
