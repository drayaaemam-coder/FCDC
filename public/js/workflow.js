/* ================= الدورة المستندية: التنبيهات، المهام والاعتمادات، السجل الزمني =================
   Uses globals from app.js / export.js / plan.js. */

/* ---------- السجل الزمني ---------- */
const TL_ACTION={created:["إنشاء","c"],submitted:["إرسال للاعتماد","s"],resubmitted:["إعادة إرسال بعد التعديل","s"],approved:["اعتماد","a"],
  returned:["إعادة للتعديل","r"],edited:["تعديل","c"],deleted:["حذف نشاط","r"],issued:["إصدار بكود اعتماد","a"]};
const fmtDT=s=>new Date(s).toLocaleString("ar-EG",{day:"numeric",month:"long",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"Africa/Cairo"});
function timelineHTML(events){
  if(!events.length)return'<p class="hint">لا توجد أحداث مسجلة بعد.</p>';
  return `<ol class="tl">${events.map(e=>{const a=TL_ACTION[e.action]||[e.action,"c"];
    return `<li class="tl-${a[1]}"><div class="tl-h"><b>${a[0]}</b><span>${esc(e.actorName||"—")}${e.actorRole==="admin"?" · إدارة المشروع":""}</span><time>${fmtDT(e.at)}</time></div>${e.note?`<p>${esc(e.note)}</p>`:""}</li>`}).join("")}</ol>`;
}
async function loadTimeline(type,id,el){
  el.innerHTML='<p class="hint">جارٍ التحميل…</p>';
  try{el.innerHTML=timelineHTML((await api(`/api/approvals/timeline/${type}/${encodeURIComponent(id)}`)).events)}catch(x){el.innerHTML=`<p class="hint">${esc(x.message)}</p>`}
}
document.addEventListener("toggle",e=>{const d=e.target;if(d.matches?.("details[data-tl]")&&d.open)loadTimeline(...d.dataset.tl.split(/:(.*)/s).slice(0,2),d.querySelector(".tl-box"))},true);
document.addEventListener("click",e=>{const b=e.target.closest("button[data-tl]");if(!b)return;
  const row=document.querySelector(`[data-tlrow="${b.dataset.tl}"]`);if(!row)return;row.hidden=!row.hidden;
  if(!row.hidden)loadTimeline(...b.dataset.tl.split(/:(.*)/s).slice(0,2),row.querySelector("td"))});

/* ---------- التنبيهات ---------- */
const notifState={items:[],unread:0,lastUnread:null,counts:{}};
async function pollNotifications(){
  let d;try{d=await api("/api/notifications")}catch(e){return}
  const fresh=notifState.lastUnread!==null&&d.lastUnread>notifState.lastUnread;
  Object.assign(notifState,{items:d.items,unread:d.unread,lastUnread:d.lastUnread,counts:d.counts});
  const bn=$("#bell-n");bn.hidden=!d.unread;bn.textContent=d.unread>99?"99+":fmt(d.unread);
  const tn=$("#tasks-n"),c=isAdmin?d.counts.pending:d.counts.action;tn.hidden=!c;tn.textContent=fmt(c);
  if(!$("#bell-panel").hidden)renderBell();
  if(fresh){const n=d.items.find(x=>!x.read);if(n)toast("🔔 "+n.title);
    await loadActs();await loadReports();if(typeof refreshPlanSums==="function")await refreshPlanSums();
    if(!$("#view-tasks").hidden)loadTasks();}
}
function reminders(){
  const out=[],day=+todayStr().slice(8),cur=todayStr().slice(0,7),next=addMonth(cur,1);
  if(isAdmin){const c=notifState.counts||{};
    if(c.pending)out.push({t:`${fmt(c.pending)} عنصر بانتظار اعتمادك`,s:[c.plans?`${fmt(c.plans)} خطة`:"",c.batches?`${fmt(c.activities)} نشاط`:"",c.reports?`${fmt(c.reports)} تقرير`:""].filter(Boolean).join(" · "),link:{view:"tasks"}});
    return out}
  const mine=Object.values(CENTERS).filter(c=>c.inst===me.institution_id);
  const noPlan=mine.filter(c=>!planOK(planSums.find(x=>x.center===c.id&&x.month===next)));
  if(noPlan.length&&day>=15)out.push({t:`خطة ${monthLabel(next)} لم تُرسل بعد لـ ${fmt(noPlan.length)} مركز`,s:"تُرسل الخطة للاعتماد قبل بداية الشهر",link:{view:"plan",center:noPlan[0].id,month:next}});
  const low=mine.filter(c=>acts.filter(a=>a.center===c.id&&a.date.startsWith(cur)).length<MIN_PER_MONTH);
  if(low.length&&day>=15)out.push({t:`${fmt(low.length)} مركز سجّل أقل من ${fmt(MIN_PER_MONTH)} أنشطة هذا الشهر`,s:low.slice(0,3).map(c=>c.vil).join("، ")+(low.length>3?"…":""),link:{view:"log"}});
  const c=notifState.counts||{};
  if(c.action)out.push({t:`${fmt(c.action)} عنصر أعادته الإدارة للتعديل`,s:"افتح المهام لتعديله وإعادة إرساله",link:{view:"tasks"}});
  return out;
}
function renderBell(){
  const rem=reminders();
  $("#bell-rem").innerHTML=rem.length?`<div class="bp-sec">يحتاج متابعة</div>`+rem.map((r,i)=>`<button type="button" class="bp-i rem" data-rem="${i}"><b>${esc(r.t)}</b>${r.s?`<span>${esc(r.s)}</span>`:""}</button>`).join(""):"";
  $("#bell-list").innerHTML=`<div class="bp-sec">آخر التنبيهات</div>`+(notifState.items.length?notifState.items.map(n=>`<button type="button" class="bp-i${n.read?"":" unread"}" data-nid="${n.id}">
    <b>${esc(n.title)}</b>${n.body?`<span>${esc(n.body)}</span>`:""}<time>${fmtDT(n.at)}</time></button>`).join(""):'<p class="hint" style="padding:10px 14px">لا توجد تنبيهات بعد.</p>');
  $("#bell-panel")._rem=rem;
}
function toggleBell(open){const p=$("#bell-panel");p.hidden=open===undefined?!p.hidden:!open;$("#bell").setAttribute("aria-expanded",String(!p.hidden));if(!p.hidden)renderBell()}
$("#bell").onclick=e=>{e.stopPropagation();toggleBell()};
document.addEventListener("click",e=>{if(!$("#bell-panel").hidden&&!e.target.closest(".bell-wrap"))toggleBell(false)});
document.addEventListener("keydown",e=>{if(e.key==="Escape")toggleBell(false)});
$("#bell-all").onclick=async()=>{await api("/api/notifications/read",{method:"POST",body:{all:true}}).catch(()=>{});await pollNotifications();renderBell()};
$("#bell-panel").addEventListener("click",async e=>{
  const r=e.target.closest("[data-rem]");if(r){toggleBell(false);goTo($("#bell-panel")._rem[+r.dataset.rem].link);return}
  const b=e.target.closest("[data-nid]");if(!b)return;const n=notifState.items.find(x=>x.id==b.dataset.nid);
  toggleBell(false);if(n&&!n.read){api("/api/notifications/read",{method:"POST",body:{ids:[n.id]}}).then(pollNotifications).catch(()=>{})}
  if(n)goTo(n.link||{});
});

/* ---------- التنقل من تنبيه أو مهمة ---------- */
async function goTo(link){
  navigated=true;
  if(link.view==="plan"){
    if(isAdmin){$("#p-inst").value="";fillPlanCenters()}
    if(link.month){if(![...$("#p-month").options].some(o=>o.value===link.month))$("#p-month").insertAdjacentHTML("beforeend",`<option value="${link.month}">${monthLabel(link.month)}</option>`);$("#p-month").value=link.month}
    if(link.center)$("#p-center").value=link.center;
    show("plan");setTimeout(()=>$("#p-editor").scrollIntoView({behavior:"smooth",block:"start"}),400);return;
  }
  if(link.view==="reports"){
    if(link.kind){$("#r-kind").value=link.kind;fillPeriods();if(link.period)$("#r-period").value=link.period}
    show("reports");if(link.id){await loadReports();flash(`[data-rrow="${link.id}"]`)}return;
  }
  if(link.view==="tasks"){show("tasks");await tasksLoading;if(link.type)flash(`[data-card="${link.type}:${link.id}"]`);return}
  if(VIEWS.includes(link.view))show(link.view);
}
function flash(sel){const el=document.querySelector(sel);if(!el)return;el.scrollIntoView({behavior:"smooth",block:"center"});el.classList.add("flash");setTimeout(()=>el.classList.remove("flash"),2400)}
document.addEventListener("click",e=>{const b=e.target.closest("[data-goto-task]");if(!b)return;const[type,id]=b.dataset.gotoTask.split(":");goTo({view:"tasks",type,id})});

/* ---------- المهام والاعتمادات ---------- */
let tasks=[],tasksLoading=Promise.resolve(),taskFilter="";
const TYPE_NAME={plan:"خطة شهرية",batch:"أنشطة منفذة",report:"تقرير"};
const STATUS_PILL={submitted:["بانتظار الاعتماد","sub"],approved:["معتمد","ok"],returned:["معاد للتعديل","no"]};
function loadTasks(){
  tasksLoading=(async()=>{try{tasks=(await api("/api/approvals")).items}catch(x){$("#t-body").innerHTML=`<div class="notice bad">${esc(x.message)}</div>`;return}renderTasks()})();
  return tasksLoading;
}
const centerName=id=>{const c=CENTERS[id];return c?`${c.vil} – مركز ${c.mk}، ${c.gov}${c.assoc?" · "+c.assoc:""}`:id};
function cardTitle(t){
  if(t.type==="plan")return`خطة ${monthLabel(t.month)} – ${CENTERS[t.center]?.vil||t.center}${CENTERS[t.center]?.assoc?" ("+CENTERS[t.center].assoc+")":""}`;
  if(t.type==="batch")return`${fmt(t.activities.length)} أنشطة – ${CENTERS[t.center]?.vil||t.center}${CENTERS[t.center]?.assoc?" ("+CENTERS[t.center].assoc+")":""}`;
  return t.title;
}
function cardHTML(t){
  const st=STATUS_PILL[t.status],key=`${t.type}:${t.id}`;
  const meta=[t.inst?esc(INST_BY[t.inst]?.name||t.inst):"قومي",t.center?esc(centerName(t.center)):"",t.byName?"بواسطة "+esc(t.byName):"",t.date?fmtDT(t.date):""].filter(Boolean);
  let body="",acts_="";
  if(t.type==="plan"){meta.push(`${fmt(t.items)} نشاط مخطط`,`${fmt(t.expected)} مستفيد متوقع`);if(t.code)meta.push(`كود <bdi dir="ltr" class="code">${esc(t.code)}</bdi>`);
    acts_+=`<button type="button" class="btn ghost" data-open-plan="${t.center}|${t.month}">فتح الخطة</button>`;
    if(isAdmin&&t.status==="submitted")acts_+=`<button type="button" class="btn" data-review="plan:${t.id}:approve">اعتماد الخطة</button><button type="button" class="btn ghost" data-ret="${key}">إعادة للتعديل</button>`;
    if(!isAdmin&&t.status==="returned")acts_+=`<button type="button" class="btn" data-open-plan="${t.center}|${t.month}">تعديل الخطة وإعادة إرسالها</button>`;}
  if(t.type==="batch"){
    const sel=isAdmin&&t.status==="submitted";
    body=`<div class="arows">${t.activities.map(a=>{const s=ACT_STATUS[a.status];const ppl=(a.kids||0)+(a.women||0)+(a.men||0);
      return `<div class="arow${a.status==="returned"?" ret":""}">${sel&&a.status==="pending"?`<input type="checkbox" class="pick-a" value="${a.id}" checked aria-label="تحديد">`:""}
        <div style="min-width:0"><b>${esc(a.title)}</b><div class="meta"><span>${shortDate(a.date)}</span><span class="tag">${esc(a.type)}</span>${ppl?`<span class="num">${fmt(ppl)} مشارك</span>`:""}${a.partner?`<span>مع ${esc(a.partner)}</span>`:""}</div>
        ${a.reviewNote&&a.status==="returned"?`<div class="note-ret">ملاحظات الإدارة: ${esc(a.reviewNote)}</div>`:""}
        ${a.mediaIds.length?`<div class="mini-th">${a.mediaIds.slice(0,4).map(id=>`<img src="/api/photos/${id}/thumb" alt="" loading="lazy">`).join("")}</div>`:""}</div>
        <span class="pill ${s[1]}">${s[0]}</span>${!isAdmin&&a.status!=="approved"?`<button type="button" class="link" data-edit="${a.id}">تعديل</button>`:""}</div>`}).join("")}</div>`;
    if(sel)acts_+=`<button type="button" class="btn" data-review-batch="${t.id}:approve">اعتماد المحدد</button><button type="button" class="btn ghost" data-ret="${key}">إعادة المحدد للتعديل</button>`;
  }
  if(t.type==="report"){meta.unshift(KIND_NAMES[t.kind]);if(t.code)meta.push(`كود <bdi dir="ltr" class="code">${esc(t.code)}</bdi>`);
    acts_+=`<button type="button" class="btn ghost" data-rpv="${t.id}">معاينة التقرير</button>`;
    if(isAdmin&&t.status==="submitted")acts_+=`<button type="button" class="btn" data-review="report:${t.id}:approve">اعتماد وإصدار الكود</button><button type="button" class="btn ghost" data-ret="${key}">إعادة للتعديل</button>`;
    if(!isAdmin&&t.status==="returned")acts_+=`<button type="button" class="btn" data-open-report="${t.kind}|${t.period}">تحديث التقرير وإعادة إرساله</button>`;
    if(t.status==="approved")acts_+=`<button type="button" class="btn ghost" data-rdl="${t.id}" data-fmt="pdf">PDF</button><button type="button" class="btn ghost" data-rdl="${t.id}" data-fmt="docx">Word</button>`;}
  return `<article class="card st-${t.status}" data-card="${key}">
    <div class="card-h"><span class="ctype">${TYPE_NAME[t.type]}</span><h3>${esc(cardTitle(t))}</h3><span class="pill ${st[1]}">${st[0]}</span></div>
    <div class="meta">${meta.map(m=>`<span>${m}</span>`).join("")}</div>
    ${t.note&&t.status==="returned"?`<div class="note-ret">ملاحظات إدارة المشروع: ${esc(t.note)}</div>`:""}
    ${body}
    ${acts_?`<div class="card-a">${acts_}</div>`:""}
    <div class="ret-box" data-retbox="${key}" hidden><label>سبب الإعادة أو التعديلات المطلوبة</label><textarea maxlength="600" placeholder="مثال: برجاء إضافة أعداد الحضور وصور التوثيق"></textarea>
      <div class="card-a"><button type="button" class="btn orange" data-ret-ok="${key}">تأكيد الإعادة للتعديل</button><button type="button" class="btn ghost" data-ret-x="${key}">إلغاء</button></div></div>
    <details data-tl="${t.type}:${t.id}"><summary>السجل الزمني</summary><div class="tl-box"></div></details>
  </article>`;
}
function renderTasks(){
  const by=s=>tasks.filter(t=>(!taskFilter||t.type===taskFilter)&&s.includes(t.status));
  const cnt=type=>tasks.filter(t=>t.type===type&&t.status===(isAdmin?"submitted":"returned")).length;
  const chips=[["","الكل"],["plan","الخطط"],["batch","الأنشطة"],["report","التقارير"]].map(([v,l])=>`<button type="button" class="chip${taskFilter===v?" on":""}" data-tf="${v}">${l}${v&&cnt(v)?` <b>${fmt(cnt(v))}</b>`:""}</button>`).join("");
  let head="";
  if(isAdmin){const c=notifState.counts||{};
    head=`<div class="hero"><div><h2>مرحبًا ${esc(me.name)}</h2><p class="hint">كل ما ترسله المؤسسات يصل هنا للاعتماد. الاعتماد يحدّث التقارير ويُشعر المؤسسة فورًا.</p></div>
      <div class="hero-k"><div><b class="num">${fmt(c.plans||0)}</b><span>خطط بانتظار الاعتماد</span></div><div><b class="num">${fmt(c.activities||0)}</b><span>أنشطة قيد المراجعة</span></div><div><b class="num">${fmt(c.reports||0)}</b><span>تقارير بانتظار الاعتماد</span></div></div></div>`;
  }else{
    const cur=todayStr().slice(0,7),next=addMonth(cur,1),mine=Object.values(CENTERS).filter(c=>c.inst===me.institution_id);
    head=`<div class="hero"><div><h2>مرحبًا ${esc(me.name)}</h2><p class="hint">${esc(INST_BY[me.institution_id].name)} · تابع هنا حالة ما أرسلته لإدارة المشروع وما يحتاج تعديلًا منك.</p></div>
      <div class="quick"><button type="button" class="btn" data-q="log">+ تسجيل أنشطة منفذة</button><button type="button" class="btn ghost" data-q="plan">إعداد خطة ${monthLabel(next)}</button><button type="button" class="btn ghost" data-q="reports">تقرير ${monthLabel(cur)}</button></div></div>
      <div class="tbl-wrap" style="margin-bottom:18px"><table><thead><tr><th>المركز</th><th>أنشطة ${MONTHS[+cur.slice(5)-1]}</th><th>منها معتمد</th><th>خطة ${MONTHS[+next.slice(5)-1]}</th></tr></thead><tbody>`+
      mine.map(c=>{const l=acts.filter(a=>a.center===c.id&&a.date.startsWith(cur)),ap=l.filter(a=>a.status==="approved").length,p=planSums.find(x=>x.center===c.id&&x.month===next);
        return `<tr class="inst-row" data-open-plan="${c.id}|${next}"><td>${esc(c.vil)} <span class="hint">– ${esc(c.mk)}${c.assoc?" · "+esc(c.assoc):""}</span></td><td>${l.length<MIN_PER_MONTH?`<span class="pill low">${fmt(l.length)} من ${fmt(MIN_PER_MONTH)}</span>`:`<span class="pill ok">${fmt(l.length)}</span>`}</td><td class="num">${fmt(ap)}</td><td>${planPill(p)}</td></tr>`}).join("")+`</tbody></table></div>`;
  }
  $("#t-head").innerHTML=head+`<div class="chips">${chips}</div>`;
  const sec=(title,list,empty)=>`<div class="sec"><div class="sec-h"><h2>${title}</h2><span class="hint">${fmt(list.length)}</span></div>${list.length?`<div class="cards">${list.map(cardHTML).join("")}</div>`:`<div class="empty">${empty}</div>`}</div>`;
  $("#t-body").innerHTML=isAdmin
    ?sec("بانتظار اعتمادك",by(["submitted"]),"لا يوجد ما ينتظر اعتمادك الآن ✓")+sec("اعتُمد خلال آخر ٧ أيام",by(["approved"]),"لا شيء بعد.")
    :sec("يحتاج إجراء منك",by(["returned"]),"لا يوجد ما يحتاج تعديلًا ✓")+sec("قيد المراجعة لدى إدارة المشروع",by(["submitted"]),"لا يوجد ما ينتظر المراجعة.")+sec("اعتُمد خلال آخر ٣٠ يومًا",by(["approved"]),"لا شيء بعد.");
}
$("#t-head").addEventListener("click",e=>{
  const c=e.target.closest("[data-tf]");if(c){taskFilter=c.dataset.tf;renderTasks();return}
  const q=e.target.closest("[data-q]");if(q){if(q.dataset.q==="plan")goTo({view:"plan",month:addMonth(todayStr().slice(0,7),1)});else if(q.dataset.q==="reports")goTo({view:"reports",kind:"m",period:todayStr().slice(0,7)});else show(q.dataset.q)}
});
document.addEventListener("click",async e=>{
  const op=e.target.closest("[data-open-plan]");if(op){const[center,month]=op.dataset.openPlan.split("|");goTo({view:"plan",center,month});return}
  const orp=e.target.closest("[data-open-report]");if(orp){const[kind,period]=orp.dataset.openReport.split("|");goTo({view:"reports",kind,period});return}
  const rt=e.target.closest("[data-ret]");if(rt){const box=document.querySelector(`[data-retbox="${rt.dataset.ret}"]`);box.hidden=false;box.querySelector("textarea").focus();return}
  const rx=e.target.closest("[data-ret-x]");if(rx){document.querySelector(`[data-retbox="${rx.dataset.retX}"]`).hidden=true;return}
  const ro=e.target.closest("[data-ret-ok]");if(ro){const key=ro.dataset.retOk,[type,id]=key.split(/:(.*)/s),note=document.querySelector(`[data-retbox="${key}"] textarea`).value.trim();
    if(note.length<3){toast("اكتب سبب الإعادة أو التعديلات المطلوبة");return}
    if(type==="batch")return reviewBatch(id,"return",note,ro);
    return reviewDoc(type,id,"return",note,ro)}
  const rv=e.target.closest("[data-review]");if(rv){const[type,id,action]=rv.dataset.review.split(":");return reviewDoc(type,id,action,"",rv)}
  const rb=e.target.closest("[data-review-batch]");if(rb){const[id,action]=rb.dataset.reviewBatch.split(":");return reviewBatch(id,action,"",rb)}
});
async function reviewDoc(type,id,action,note,btn){
  btn.disabled=true;
  try{await api(`/api/${type==="plan"?"plans":"reports"}/${id}/review`,{method:"POST",body:{action,note}});
    toast(action==="approve"?(type==="plan"?"تم اعتماد الخطة وإصدار كودها":"تم اعتماد التقرير وإصدار كوده"):"أُعيد للتعديل وتم إشعار المؤسسة");
    await Promise.all([loadTasks(),pollNotifications(),loadReports(),refreshPlanSums()]);}
  catch(x){toast(x.message);btn.disabled=false}
}
async function reviewBatch(id,action,note,btn){
  const card=document.querySelector(`[data-card="batch:${id}"]`),ids=[...card.querySelectorAll(".pick-a:checked")].map(i=>+i.value);
  if(!ids.length){toast("حدد نشاطًا واحدًا على الأقل");return}
  btn.disabled=true;
  try{await api("/api/activities/review",{method:"POST",body:{ids,action,note}});
    toast(action==="approve"?`تم اعتماد ${fmt(ids.length)} نشاط`:`أُعيد ${fmt(ids.length)} نشاط للتعديل وتم إشعار المؤسسة`);
    await Promise.all([loadTasks(),pollNotifications(),loadActs()]);}
  catch(x){toast(x.message);btn.disabled=false}
}

/* ---------- تعديل نشاط (قبل اعتماده) ---------- */
let editing=null;
function findAct(id){return acts.find(a=>String(a.id)===String(id))||tasks.flatMap(t=>t.activities||[]).find(a=>String(a.id)===String(id))}
document.addEventListener("click",e=>{const b=e.target.closest("[data-edit]");if(!b)return;const a=findAct(b.dataset.edit);if(!a)return;editing=a;
  $("#e-type").innerHTML=[...new Set([...TYPES,a.type])].map(t=>`<option${t===a.type?" selected":""}>${esc(t)}</option>`).join("");
  for(const f of ["date","title","kids","women","men","partner","link","notes"])$("#e-"+f).value=a[f]??"";
  $("#e-date").max=todayStr();
  $("#act-note").innerHTML=a.status==="returned"&&a.reviewNote?`<div class="note-ret">ملاحظات الإدارة: ${esc(a.reviewNote)}</div>`:"";
  $("#act-ok").textContent=isAdmin?"حفظ التعديل":"حفظ وإعادة الإرسال للاعتماد";
  $("#act-err").textContent="";$("#act-dlg").showModal();
});
$("#act-x").onclick=()=>$("#act-dlg").close();
$("#act-form").addEventListener("submit",async e=>{
  e.preventDefault();const body={type:$("#e-type").value};
  for(const f of ["date","title","kids","women","men","partner","link","notes"])body[f]=$("#e-"+f).value;
  try{await api(`/api/activities/${editing.id}`,{method:"PATCH",body});$("#act-dlg").close();
    toast(isAdmin?"تم حفظ التعديل":"تم حفظ التعديل وإرساله لإدارة المشروع");
    await Promise.all([loadActs(),loadTasks(),pollNotifications()]);}
  catch(x){$("#act-err").textContent=x.message}
});
