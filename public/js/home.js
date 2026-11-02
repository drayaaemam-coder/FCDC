// الصفحة الرئيسية العامة: حركة الشعار، الأرقام، محاور الخطة (مع صور المراكز)، والتحقق من الأكواد
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const ar = n => Number(n).toLocaleString("ar-EG");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- إعادة تشغيل حركة الشعار ----
  const mark = $("#mark");
  const replay = () => { mark.classList.remove("play"); void mark.offsetWidth; mark.classList.add("play"); };
  $("#replay").addEventListener("click", replay);
  mark.addEventListener("click", replay);

  // ---- ظهور تدريجي عند التمرير ----
  const io = !reduce && "IntersectionObserver" in window
    ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" })
    : null;
  const reveal = el => io ? io.observe(el) : el.classList.add("in");
  document.querySelectorAll(".rv").forEach(reveal);

  // ---- صور من المراكز: تُربط بالمحور الأقرب لموضوعها (تظهر فقط إن وُجد ملف الصورة) ----
  const AXIS_PHOTOS = {
    "تنمية ورعاية الطفل": { src: "/img/photos/child-care.jpg", alt: "طفلة مبتسمة بزي المركز داخل فصل الحضانة" },
    "الرعاية الصحية والتوعية": { src: "/img/photos/health.jpg", alt: "كشف نظر لأحد المستفيدين ضمن قافلة طبية بالمركز" },
    "الأنشطة الترفيهية والمناسبات": { src: "/img/photos/occasions.jpg", alt: "أطفال المركز يلتفون حول علم مصر في احتفال وطني" },
    "التعليم وتنمية المهارات": { src: "/img/photos/learning.jpg", alt: "طفلة أمام لوحة «Welcome Back» في بداية العام الدراسي" },
  };
  const fp = $("#feature-photo");
  if (fp) { const im = fp.querySelector("img"); im.addEventListener("load", () => { fp.hidden = false; }); im.addEventListener("error", () => fp.remove()); if (im.complete && im.naturalWidth) fp.hidden = false; }

  // ---- الأرقام ومحاور الخطة من قاعدة البيانات ----
  const countUp = (el, to) => {
    if (reduce || to < 2) { el.textContent = ar(to); return; }
    const t0 = performance.now(), dur = 1100;
    const step = t => { const p = Math.min(1, (t - t0) / dur); el.textContent = ar(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  fetch("/api/public/overview").then(r => r.ok ? r.json() : Promise.reject(r.status)).then(d => {
    const vals = { ...d, axesCount: (d.axes || []).length };
    const st = $("#stats"); st.hidden = false;
    st.querySelectorAll("dd[data-k]").forEach(el => countUp(el, vals[el.dataset.k] || 0));
    if (!d.axes || !d.axes.length) return;
    const list = $("#axes-list");
    list.innerHTML = d.axes.map(a => {
      const ph = AXIS_PHOTOS[a.name];
      return ph
        ? `<li class="ax-ph rv"><img src="${ph.src}" alt="${esc(ph.alt)}" loading="lazy" decoding="async"><div class="cap"><b>${esc(a.name)}</b><p>${esc(a.description)}</p></div></li>`
        : `<li class="rv"><b>${esc(a.name)}</b><p>${esc(a.description)}</p></li>`;
    }).join("");
    // إن لم يوجد ملف الصورة يعود الكارت لشكله العادي
    list.querySelectorAll("li.ax-ph img").forEach(im => im.addEventListener("error", () => {
      const li = im.closest("li"); const cap = li.querySelector(".cap");
      li.classList.remove("ax-ph"); im.remove(); li.append(...cap.childNodes); cap.remove();
    }));
    $("#axes").hidden = false;
    list.querySelectorAll(".rv").forEach(reveal);
  }).catch(() => { /* الصفحة تعمل بدون الأرقام */ });

  // ---- التحقق من كود اعتماد ----
  $("#vform").addEventListener("submit", e => {
    e.preventDefault();
    const code = $("#vcode").value.trim().toUpperCase();
    if (code) location.href = "/verify/" + encodeURIComponent(code);
  });

  $("#yr").textContent = ar(new Date().getFullYear()).replace(/٬/g, "");
})();
