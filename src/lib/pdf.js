// توليد PDF من HTML عبر متصفح Chrome/Chromium بدون واجهة.
// الأمان: JavaScript معطل داخل الصفحة، وكل طلبات الشبكة محجوبة ما عدا data: (الصور والخطوط مضمّنة).
const fs = require("fs");
const path = require("path");
const config = require("../config");

let puppeteer = null;
try { puppeteer = require("puppeteer-core"); } catch (_) { /* optional */ }

function findChrome() {
  const pf = process.env.PROGRAMFILES || "C:\\Program Files", pf86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA || "";
  const candidates = [
    config.chromePath,
    "/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    path.join(pf, "Google/Chrome/Application/chrome.exe"), path.join(pf86, "Google/Chrome/Application/chrome.exe"),
    local && path.join(local, "Google/Chrome/Application/chrome.exe"),
    path.join(pf86, "Microsoft/Edge/Application/msedge.exe"), path.join(pf, "Microsoft/Edge/Application/msedge.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter(Boolean);
  return candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

let browserPromise = null;
async function browser() {
  if (!puppeteer) throw Object.assign(new Error("puppeteer-core غير مثبت"), { code: "NO_CHROME" });
  const exe = findChrome();
  if (!exe) throw Object.assign(new Error("لم يتم العثور على متصفح Chrome"), { code: "NO_CHROME" });
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: exe, headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none"],
    });
    browserPromise.then(b => b.on("disconnected", () => { browserPromise = null; })).catch(() => { browserPromise = null; });
  }
  return browserPromise;
}

// Site fonts embedded as data: URIs so the PDF looks the same everywhere (and works offline)
let fontCss = null;
function fontsCss() {
  if (fontCss) return fontCss;
  const dir = path.join(__dirname, "..", "..", "public", "fonts");
  const faces = [
    ["Cairo", 600, "cairo-arabic-600"], ["Cairo", 700, "cairo-arabic-700"], ["Cairo", 800, "cairo-arabic-800"],
    ["Cairo", 600, "cairo-latin-600"], ["Cairo", 700, "cairo-latin-700"], ["Cairo", 800, "cairo-latin-800"],
    ["IBM Plex Sans Arabic", 400, "plex-arabic-400"], ["IBM Plex Sans Arabic", 500, "plex-arabic-500"], ["IBM Plex Sans Arabic", 600, "plex-arabic-600"],
    ["IBM Plex Sans Arabic", 400, "plex-latin-400"], ["IBM Plex Sans Arabic", 500, "plex-latin-500"], ["IBM Plex Sans Arabic", 600, "plex-latin-600"],
  ];
  fontCss = faces.map(([fam, w, f]) => {
    const file = path.join(dir, f + ".woff2");
    if (!fs.existsSync(file)) return "";
    const range = f.includes("arabic") ? "U+0600-06FF,U+0750-077F,U+0870-08FF,U+FB50-FDFF,U+FE70-FEFF,U+200C-200E,U+2010-2011,U+204F,U+2E41" : "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
    return `@font-face{font-family:"${fam}";font-weight:${w};font-style:normal;font-display:block;unicode-range:${range};src:url(data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}) format("woff2")}`;
  }).join("\n");
  return fontCss;
}

async function htmlToPdf(html) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", r => (r.url().startsWith("data:") || r.url() === "about:blank") ? r.continue() : r.abort());
    // Replace remote font links with the embedded fonts
    const doc = html.replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/gi, "")
      .replace(/<head>/i, `<head><style>${fontsCss()}</style>`);
    await page.setContent(doc, { waitUntil: "load", timeout: 60000 });
    await page.emulateMediaType("print");
    return await page.pdf({ printBackground: true, preferCSSPageSize: true, timeout: 120000 });
  } finally {
    await page.close().catch(() => {});
  }
}

async function closeBrowser() {
  if (!browserPromise) return;
  try { (await browserPromise).close(); } catch (_) { /* already gone */ }
  browserPromise = null;
}
process.once("SIGTERM", () => closeBrowser().finally(() => process.exit(0)));

module.exports = { htmlToPdf, findChrome, closeBrowser };
