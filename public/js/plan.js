/* ================= MONTHLY PLAN =================
   خطة مستقلة لكل مركز في كل شهر، وفق محاور ومحددات محضر اجتماع ٧ أكتوبر ٢٠٢٦.
   Uses globals from app.js ($, esc, fmt, api, INST, CENTERS, AXES, OCCASIONS, isAdmin, ...). */

const PLAN_STATUS={none:["لم تُعد بعد","no"],draft:["مسودة","low"],submitted:["مرسلة للاعتماد","sub"],approved:["معتمدة","ok"],returned:["معادة للتعديل","no"]};
function planOK(x){return !!x&&(x.status==="submitted"||x.status==="approved")}
function planPill(x){const s=PLAN_STATUS[x?x.status:"none"]||PLAN_STATUS.none;return `<span class="pill ${s[1]}">${s[0]}</span>`}
const TARGETS=["أطفال الحضانة ورياض الأطفال","الأطفال (٦–١٢ سنة)","النشء والمراهقون","الشباب","الأمهات والسيدات","المقبلون على الزواج","الأسر","الرجال","كبار السن","الأشخاص ذوو الإعاقة","الفئات الأولى بالرعاية","المجتمع المحلي"];
const DAYS=["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
const arDigits=s=>String(s).replace(/\d/g,d=>"٠١٢٣٤٥٦٧٨٩"[d]);
const fmtTime=t=>{if(!t)return"";const h=+t.slice(0,2),m=t.slice(3,5);return arDigits(`${h%12||12}:${m}`)+(h<12?" ص":" م")};
const dayName=d=>DAYS[new Date(d+"T00:00").getDay()];
const isWeekend=d=>WEEKEND.includes(new Date(d+"T00:00").getDay());
const weekendNames=()=>WEEKEND.map(i=>DAYS[i]).join(" و");
// أقرب يوم عمل داخل نفس الشهر (عند تساوي المسافة يُفضَّل اليوم السابق)
function nearestWorkday(d){
  const ym=d.slice(0,7),t=new Date(d+"T00:00");
  for(let k=1;k<7;k++){const b=new Date(t);b.setDate(t.getDate()-k);if(ymd(b).startsWith(ym)&&!WEEKEND.includes(b.getDay()))return ymd(b);
    const a=new Date(t);a.setDate(t.getDate()+k);if(ymd(a).startsWith(ym)&&!WEEKEND.includes(a.getDay()))return ymd(a)}
  return d;
}
const occInPlan=o=>pitems.some(r=>r.date.startsWith(o.date.slice(0,7))&&norm(r.title).includes(norm(o.name)));
const lastDay=ym=>new Date(+ym.slice(0,4),+ym.slice(5),0).getDate();
const addMonth=(ym,n)=>{const d=new Date(+ym.slice(0,4),+ym.slice(5)-1+n,1);return ymd(d).slice(0,7)};

let plan=null,pitems=[],pk=0,planBusy=false;
const newItem=(x={})=>({k:++pk,title:"",type:"",target:"",expected:"",date:"",start:"09:00",end:"11:00",partner:"",responsible:"",err:"",...x});
const itemEmpty=r=>!r.title.trim()&&!r.type&&!r.target.trim()&&!r.partner.trim()&&!r.responsible.trim();
const planMonthVal=()=>$("#p-month").value;
const planLocked=()=>!isAdmin&&plan&&(plan.status==="submitted"||plan.status==="approved");

function occasionsFor(ym){
  const y=+ym.slice(0,4),m=+ym.slice(5);
  const out=OCCASIONS.filter(o=>o.month===m).map(o=>({date:`${ym}-${String(o.day).padStart(2,"0")}`,name:o.name}));
  MOVABLE_OCCASIONS.filter(o=>o.month===m&&o.rule==="first-friday").forEach(o=>{
    const d=new Date(y,m-1,1);while(d.getDay()!==5)d.setDate(d.getDate()+1);out.push({date:ymd(d),name:o.name})});
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}

/* ---------- setup & selectors ---------- */
function initPlan(){
  const cur=todayStr().slice(0,7),months=[];
  for(let n=PLAN_AHEAD;n>=1;n--)months.push(addMonth(cur,n));
  months.push(...monthList());
  $("#p-month").innerHTML=months.map(k=>`<option value="${k}">${monthLabel(k)}${k===cur?" (الشهر الحالي)":""}</option>`).join("");
  $("#p-month").value=addMonth(cur,1); // الخطة تُعد عادةً للشهر القادم
  $("#p-inst-wrap").hidden=!isAdmin;
  fillPlanCenters();
}
function fillPlanCenters(){
  const inst=isAdmin?$("#p-inst").value:me.institution_id;
  const list=Object.values(CENTERS).filter(c=>!inst||c.inst===inst);
  const prev=$("#p-center").value||(!isAdmin?st.center:"");
  $("#p-center").innerHTML=(isAdmin||list.length>1?'<option value="">— اختر المركز —</option>':"")+
    list.map(c=>`<option value="${c.id}">${esc(c.vil)} – ${esc(c.mk)}${isAdmin&&!inst?" · "+esc(INST_BY[c.inst].name):""}</option>`).join("");
  if(list.some(c=>c.id===prev))$("#p-center").value=prev;
}
$("#p-month").addEventListener("change",renderPlanView);
$("#p-inst").addEventListener("change",()=>{fillPlanCenters();renderPlanView()});
$("#p-center").addEventListener("change",()=>{loadPlan()});

async function renderPlanView(){if($("#view-plan").hidden)return;renderPlanOverview();loadPlan();await refreshPlanSums()}
let planFilter="";

/* ---------- overview: plan status of every center in scope ---------- */
function renderPlanOverview(){
  if(!$("#p-overview")||$("#view-plan").hidden)return;
  const ym=planMonthVal(),inst=isAdmin?$("#p-inst").value:me.institution_id;
  const centers=Object.values(CENTERS).filter(c=>!inst||c.inst===inst);
  if(!isAdmin&&centers.length<2){$("#p-overview").innerHTML="";return}
  const by={};planSums.filter(x=>x.month===ym).forEach(x=>by[x.center]=x);
  const n=s=>centers.filter(c=>(by[c.id]?.status||"none")===s).length;
  const sel=$("#p-center").value,F={submitted:["submitted"],approved:["approved"],work:["draft","returned"],none:["none"]};
  const shown=centers.filter(c=>!planFilter||F[planFilter].includes(by[c.id]?.status||"none"));
  const k=(f,v,l)=>`<button type="button" class="kpi kbtn${planFilter===f?" on":""}" data-pf-filter="${f}"><div class="v num">${fmt(v)}</div><div class="l">${l}</div></button>`;
  $("#p-overview").innerHTML=`<div class="kpis" style="margin-bottom:8px">${k("approved",n("approved"),"خطط معتمدة")}${k("submitted",n("submitted"),"مرسلة تنتظر الاعتماد")}${k("work",n("draft")+n("returned"),"قيد الإعداد أو معادة")}${k("none",n("none"),"مراكز لم تبدأ خطتها")}</div>
    <p class="hint" style="margin:0 0 8px">${planFilter?`يعرض ${fmt(shown.length)} مركز · <button type="button" class="link" data-pf-filter="">عرض الكل</button>`:"اضغط على أي رقم لتصفية المراكز حسب حالة الخطة."}</p>
    <div class="tbl-wrap" style="margin-bottom:22px"><table><thead><tr><th>المركز</th>${isAdmin?"<th>المؤسسة</th>":""}<th>حالة الخطة</th><th>الأنشطة المخططة</th><th>المستفيدون المتوقعون</th><th>آخر تحديث</th></tr></thead><tbody>`+
    shown.map(c=>{const x=by[c.id];return `<tr class="inst-row${c.id===sel?" open":""}" data-pcenter="${c.id}" tabindex="0"><td>${esc(c.vil)} <span class="hint">– ${esc(c.mk)}، ${esc(c.gov)}</span></td>
      ${isAdmin?`<td>${esc(INST_BY[c.inst].name)}</td>`:""}<td>${planPill(x)}</td><td class="num">${x?fmt(x.items):"—"}</td><td class="num">${x?fmt(x.expected):"—"}</td>
      <td class="num">${x?shortDate(String(x.updatedAt).slice(0,10)):"—"}</td></tr>`}).join("")+`</tbody></table></div>`;
}
$("#p-overview").addEventListener("click",e=>{const f=e.target.closest("[data-pf-filter]");if(f){planFilter=planFilter===f.dataset.pfFilter?"":f.dataset.pfFilter;renderPlanOverview();return}
  const r=e.target.closest("[data-pcenter]");if(!r)return;
  $("#p-center").value=r.dataset.pcenter;loadPlan().then(()=>$("#p-editor").scrollIntoView({behavior:"smooth",block:"start"}))});
$("#p-overview").addEventListener("keydown",e=>{if(e.key==="Enter")e.target.closest("[data-pcenter]")?.click()});

/* ---------- load / render one plan ---------- */
async function loadPlan(){
  const c=$("#p-center").value,ym=planMonthVal(),ed=$("#p-editor");
  renderPlanOverview();
  if(!c){plan=null;ed.innerHTML=`<div class="empty">اختر المركز لعرض خطته الشهرية أو إعدادها.</div>`;return}
  ed.innerHTML='<div class="empty">جارٍ تحميل الخطة…</div>';
  try{
    plan=(await api(`/api/plans/${encodeURIComponent(c)}/${ym}`)).plan;
    pitems=plan.items.map(i=>newItem({...i,expected:String(i.expected)}));
    if(!pitems.length&&!planLocked())pitems=[newItem(),newItem(),newItem()];
    renderPlanEditor();
  }catch(x){ed.innerHTML=`<div class="notice bad">${esc(x.message)}</div>`}
}

function planItemHTML(r,i){
  const ym=planMonthVal(),axis=AXES.find(a=>a.name===r.type);
  const f=(name,label,inner)=>`<div><label for="p${r.k}-${name}">${label}</label>${inner}</div>`;
  const inp=(name,extra="")=>`<input id="p${r.k}-${name}" data-pk="${r.k}" data-pf="${name}" value="${esc(r[name])}" ${extra}>`;
  return `<div class="act${r.err?" has-err":""}" data-prow="${r.k}">
    <div class="act-h"><b>نشاط ${fmt(i+1)}</b>${r.date?`<span class="act-st">${dayName(r.date)} ${longDate(r.date)}</span>`:'<span class="act-st"></span>'}<button type="button" class="rm" data-prm="${r.k}">حذف</button></div>
    <div class="pg1">
      ${f("title","اسم النشاط",inp("title",'type="text" maxlength="140" placeholder="مثال: ندوة عن التغذية السليمة للطفل"'))}
      ${f("type","المحور",`<select id="p${r.k}-type" data-pk="${r.k}" data-pf="type"><option value="">اختر المحور</option>${AXES.map((a,x)=>`<option value="${esc(a.name)}"${a.name===r.type?" selected":""}>${fmt(x+1)}. ${esc(a.name)}</option>`).join("")}</select>`)}
    </div>
    ${axis?`<div class="hint" style="margin:-6px 0 0">${esc(axis.desc)}</div>`:""}
    <div class="pg2">
      ${f("target","الفئة المستهدفة",inp("target",'type="text" list="p-targets" maxlength="100" placeholder="اختر أو اكتب"'))}
      ${f("expected","العدد المتوقع",inp("expected",'type="number" min="0" inputmode="numeric" placeholder="0"'))}
      ${f("date","تاريخ التنفيذ",inp("date",`type="date" min="${ym}-01" max="${ym}-${lastDay(ym)}"`))}
      ${f("start","من",inp("start",`type="time" min="${DAY_START}" max="${DAY_END}" step="900"`))}
      ${f("end","إلى",inp("end",`type="time" min="${DAY_START}" max="${DAY_END}" step="900"`))}
    </div>
    <div class="grid2f">
      ${f("partner",'الجهة المنفذة أو الشريكة <span class="opt">(اختياري)</span>',inp("partner",'type="text" maxlength="150" placeholder="مثال: الوحدة الصحية بالقرية"'))}
      ${f("responsible","المسؤول عن التنفيذ",inp("responsible",'type="text" maxlength="100"'))}
    </div>
    <div class="act-err" data-perr="${r.k}">${esc(r.err)}</div></div>`;
}

function readOnlyTable(list){
  return `<div class="tbl-wrap"><table><thead><tr><th>م</th><th>التاريخ</th><th>التوقيت</th><th>اسم النشاط</th><th>المحور</th><th>الفئة المستهدفة</th><th>العدد المتوقع</th><th>الجهة المنفذة / الشريكة</th><th>المسؤول</th></tr></thead><tbody>`+
    list.map((r,i)=>`<tr><td class="num">${fmt(i+1)}</td><td class="num">${dayName(r.date)} ${shortDate(r.date)}</td><td class="num">${fmtTime(r.start)} – ${fmtTime(r.end)}</td><td>${esc(r.title)}</td><td>${esc(r.type)}</td><td>${esc(r.target)}</td><td class="num">${fmt(+r.expected||0)}</td><td>${esc(r.partner)||"—"}</td><td>${esc(r.responsible)}</td></tr>`).join("")+`</tbody></table></div>`;
}

const sortedItems=()=>pitems.filter(r=>!itemEmpty(r)).sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));

function renderPlanEditor(){
  const c=CENTERS[plan.center],ym=planMonthVal(),locked=planLocked(),occ=occasionsFor(ym);
  const meta=[plan.updatedAt?`آخر تحديث ${longDate(String(plan.updatedAt).slice(0,10))}${plan.updatedByName?" بواسطة "+esc(plan.updatedByName):""}`:"",
    plan.status==="approved"&&plan.reviewedByName?`اعتمدها ${esc(plan.reviewedByName)}`:""].filter(Boolean).join(" · ");
  let h=`<div class="panel" style="margin-bottom:14px"><div class="sec-h" style="margin:0"><div>
      <h2 style="font-size:18px">خطة ${esc(c.vil)} <span class="hint">– مركز ${esc(c.mk)}، ${esc(c.gov)}</span></h2>
      <div class="meta"><span>${esc(INST_BY[c.inst].name)}</span><span>${monthLabel(ym)}</span>${meta?`<span>${meta}</span>`:""}${plan.code?`<span>كود الاعتماد <bdi dir="ltr" class="code">${esc(plan.code)}</bdi></span>`:""}</div></div>${planPill(plan)}</div></div>`;
  if(plan.status==="returned"&&plan.note)h+=`<div class="notice bad"><b>ملاحظات إدارة المشروع:</b> ${esc(plan.note)}</div>`;
  if(locked)h+=`<div class="notice">${plan.status==="approved"?"الخطة معتمدة.":"الخطة مرسلة للاعتماد."} لا يمكن تعديلها إلا إذا أعادتها إدارة المشروع للتعديل.</div>`;
  h+=`<div class="rules"><span class="rule">خطة مستقلة لكل مركز</span><span class="rule">${fmt(MIN_PER_MONTH)} أنشطة على الأقل</span><span class="rule">التوقيت من ${fmtTime(DAY_START)} حتى ${fmtTime(DAY_END)}</span><span class="rule">لا أنشطة يومي ${weekendNames()}</span><span class="rule">توزيع منتظم على أسابيع الشهر</span><span class="rule">دون تعارض مع أنشطة الحضانة ورياض الأطفال</span><span class="rule">إدراج المناسبات الرسمية والأيام العالمية</span></div>`;
  if(occ.length)h+=`<div class="panel occ" style="margin-bottom:14px"><h3>مناسبات ${MONTHS[+ym.slice(5)-1]}</h3><p class="hint">يُراعى التنسيق لدعوة الشركاء الحكوميين المعنيين. المناسبات الهجرية (رمضان والأعياد والمولد النبوي) تُضاف يدويًا.</p><div class="occ-list">`+
    occ.map(o=>{const inPlan=occInPlan(o),wk=isWeekend(o.date);
      return `<div class="occ-i"><span class="num">${dayName(o.date)} ${shortDate(o.date)}${wk?` · عطلة، تُدرج يوم ${dayName(nearestWorkday(o.date))} ${shortDate(nearestWorkday(o.date))}`:""}</span><b>${esc(o.name)}</b>${inPlan?'<span class="pill ok">مدرجة</span>':locked?"":`<button type="button" class="link" data-pocc="${o.date}|${esc(o.name)}">+ إضافة للخطة</button>`}</div>`}).join("")+`</div></div>`;
  h+=`<div class="pwrap"><div style="min-width:0">`;
  if(locked)h+=readOnlyTable(sortedItems());
  else h+=`<div class="acts" id="p-items">${pitems.map((r,i)=>planItemHTML(r,i)).join("")||'<div class="empty">لا توجد أنشطة في الخطة بعد.</div>'}</div>
    <div style="margin-top:12px"><button type="button" class="btn ghost" id="p-add">+ إضافة نشاط للخطة</button></div>`;
  h+=`</div><aside class="panel psum" id="p-sum"></aside></div>
    <datalist id="p-targets">${TARGETS.map(t=>`<option value="${esc(t)}">`).join("")}</datalist>
    <div class="savebar"><div class="savemsg" id="p-msg"></div>
      ${sortedItems().length?dlButtons('data-pdl="1"'):""}
      ${locked?"":`<button class="btn ghost" type="button" id="p-save">حفظ كمسودة</button><button class="btn" type="button" id="p-submit">${isAdmin&&plan.status==="approved"?"حفظ التعديلات":"إرسال للاعتماد"}</button>`}
      ${isAdmin&&plan.status==="submitted"?'<button class="btn orange" type="button" id="p-approve">اعتماد الخطة</button>':""}
      ${isAdmin&&(plan.status==="submitted"||plan.status==="approved")?'<button class="btn ghost" type="button" id="p-return">إعادة للتعديل</button>':""}
    </div>
    <div class="ret-box panel" id="p-retbox" hidden><label for="p-retnote">سبب الإعادة أو التعديلات المطلوبة من المركز</label><textarea id="p-retnote" maxlength="600"></textarea>
      <div class="card-a"><button type="button" class="btn orange" id="p-return-ok">تأكيد الإعادة للتعديل</button><button type="button" class="btn ghost" id="p-return-x">إلغاء</button></div></div>
    ${plan.id?`<details class="panel" data-tl="plan:${plan.id}" style="margin-top:14px"><summary>السجل الزمني للخطة</summary><div class="tl-box"></div></details>`:""}`;
  $("#p-editor").innerHTML=h;
  renderPlanSummary();
}

/* ---------- live summary & warnings ---------- */
function renderPlanSummary(){
  const el=$("#p-sum");if(!el)return;
  const ym=planMonthVal(),list=pitems.filter(r=>!itemEmpty(r)),days=lastDay(ym);
  const weeks=[];for(let d=1;d<=days;d+=7)weeks.push([d,Math.min(days,d+6),0]);
  list.forEach(r=>{if(r.date.startsWith(ym)){const d=+r.date.slice(8);weeks.forEach(w=>{if(d>=w[0]&&d<=w[1])w[2]++})}});
  const axesUsed=new Set(list.map(r=>r.type).filter(Boolean));
  const warn=[];
  const empty=weeks.filter(w=>!w[2]);
  if(list.length&&empty.length)warn.push(`لا توجد أنشطة في ${empty.map(w=>`الأيام ${arDigits(w[0])}–${arDigits(w[1])}`).join("، ")}. يُراعى توزيع الأنشطة بانتظام على الشهر.`);
  const byDate={};list.forEach(r=>{if(r.date&&r.start&&r.end)(byDate[r.date]=byDate[r.date]||[]).push(r)});
  Object.entries(byDate).forEach(([d,l])=>{for(let i=0;i<l.length;i++)for(let j=i+1;j<l.length;j++)if(l[i].start<l[j].end&&l[j].start<l[i].end)
    warn.push(`تداخل في التوقيت يوم ${shortDate(d)}: «${esc(l[i].title||"بدون اسم")}» و«${esc(l[j].title||"بدون اسم")}».`)});
  const missOcc=occasionsFor(ym).filter(o=>!occInPlan(o));
  if(missOcc.length)warn.push(`${fmt(missOcc.length)} مناسبة في هذا الشهر غير مدرجة في الخطة.`);
  if(list.length&&list.length<MIN_PER_MONTH)warn.push(`الخطة تحتاج ${fmt(MIN_PER_MONTH)} أنشطة على الأقل قبل إرسالها.`);
  const mx=Math.max(1,...weeks.map(w=>w[2]));
  el.innerHTML=`<h3>ملخص الخطة</h3>
    <div class="ps-row"><span>عدد الأنشطة</span><b class="num">${fmt(list.length)}</b></div>
    <div class="ps-row"><span>المستفيدون المتوقعون</span><b class="num">${fmt(list.reduce((s,r)=>s+(+r.expected||0),0))}</b></div>
    <div class="ps-row"><span>المحاور المغطاة</span><b class="num">${fmt(axesUsed.size)} من ${fmt(AXES.length)}</b></div>
    <div class="ax-chips">${AXES.map((a,i)=>`<span class="ax${axesUsed.has(a.name)?" on":""}" title="${esc(a.name)}">${fmt(i+1)}</span>`).join("")}</div>
    <h3 style="margin-top:14px">التوزيع على الشهر</h3>
    <div class="wk">${weeks.map(w=>`<div title="الأيام ${w[0]}–${w[1]}"><b class="num">${fmt(w[2])}</b><i style="height:${w[2]/mx*100}%"></i><span class="num">${arDigits(w[0])}–${arDigits(w[1])}</span></div>`).join("")}</div>
    ${warn.length?`<h3 style="margin-top:14px">تنبيهات</h3><ul class="pwarn">${warn.map(w=>`<li>${w}</li>`).join("")}</ul>`:list.length>=MIN_PER_MONTH?'<p class="hint" style="margin-top:12px">✓ الخطة مستوفية للضوابط الأساسية.</p>':""}`;
}

/* ---------- client-side checks (the server repeats them) ---------- */
function planCheck(){
  const ym=planMonthVal();let bad=0;
  const list=pitems.filter(r=>!itemEmpty(r));
  list.forEach((r,i)=>{
    r.err="";
    if(r.title.trim().length<4)r.err="اكتب اسم النشاط (٤ أحرف على الأقل).";
    else if(!r.type)r.err="اختر المحور.";
    else if(r.target.trim().length<2)r.err="حدد الفئة المستهدفة.";
    else if(r.expected!==""&&!(Number.isInteger(+r.expected)&&+r.expected>=0))r.err="العدد المتوقع يجب أن يكون رقمًا صحيحًا موجبًا.";
    else if(!r.date||!r.date.startsWith(ym))r.err="اختر تاريخ التنفيذ داخل شهر الخطة.";
    else if(isWeekend(r.date))r.err=`يوم ${dayName(r.date)} عطلة أسبوعية. اختر يومًا من الأحد إلى الخميس.`;
    else if(!r.start||!r.end)r.err="حدد توقيت البداية والنهاية.";
    else if(r.start<DAY_START||r.end>DAY_END)r.err=`التوقيت يجب أن يكون داخل الفترة التشغيلية من ${fmtTime(DAY_START)} حتى ${fmtTime(DAY_END)}.`;
    else if(r.start>=r.end)r.err="توقيت النهاية يجب أن يكون بعد توقيت البداية.";
    else if(r.responsible.trim().length<2)r.err="اكتب اسم المسؤول عن التنفيذ.";
    else{const j=list.findIndex((o,x)=>x<i&&norm(o.title)===norm(r.title)&&o.date===r.date);if(j>-1)r.err=`مكرر: نفس اسم وتاريخ النشاط ${fmt(pitems.indexOf(list[j])+1)}.`}
    if(r.err)bad++;
  });
  pitems.filter(itemEmpty).forEach(r=>r.err="");
  return{list,bad};
}

async function savePlan(submit){
  if(planBusy)return;
  const msg=$("#p-msg"),{list,bad}=planCheck();msg.classList.remove("bad");
  if(bad){renderPlanEditor();const m=$("#p-msg");m.textContent=`لم يتم الحفظ: ${fmt(bad)} نشاط يحتاج تصحيح (موضح باللون الأحمر).`;m.classList.add("bad");
    document.querySelector("#p-items .act.has-err")?.scrollIntoView({behavior:"smooth",block:"center"});return}
  if(submit&&list.length<MIN_PER_MONTH){msg.textContent=`الخطة تحتاج ${fmt(MIN_PER_MONTH)} أنشطة على الأقل قبل إرسالها.`;msg.classList.add("bad");return}
  const keepStatus=isAdmin&&plan.status==="approved"&&submit; // admin editing an approved plan keeps it approved
  planBusy=true;msg.textContent="جارٍ الحفظ…";
  try{
    const items=list.map(r=>({title:r.title.trim(),type:r.type,target:r.target.trim(),expected:+r.expected||0,date:r.date,start:r.start,end:r.end,partner:r.partner.trim(),responsible:r.responsible.trim()}));
    plan=(await api(`/api/plans/${encodeURIComponent(plan.center)}/${planMonthVal()}`,{method:"PUT",body:{items,submit:submit&&!keepStatus}})).plan;
    pitems=plan.items.map(i=>newItem({...i,expected:String(i.expected)}));
    toast(submit&&!keepStatus?"تم إرسال الخطة للاعتماد":"تم حفظ الخطة");
    await refreshPlanSums();renderPlanEditor();pollNotifications();
  }catch(x){
    if(x.data&&x.data.errors){Object.entries(x.data.errors).forEach(([i,m])=>{if(list[i])list[i].err=m});renderPlanEditor()}
    const m=$("#p-msg");m.textContent="لم يتم الحفظ: "+(x.status&&x.status<500?x.message:"تحقق من الاتصال وحاول مرة أخرى.");m.classList.add("bad");
  }finally{planBusy=false}
}
async function refreshPlanSums(){try{planSums=(await api("/api/plans")).plans}catch(e){}renderPlanOverview();renderDash()}

async function reviewPlan(action){
  const note=action==="return"?$("#p-retnote").value.trim():"";
  if(action==="return"&&note.length<3){toast("اكتب سبب الإعادة أو التعديلات المطلوبة");return}
  try{plan=(await api(`/api/plans/${plan.id}/review`,{method:"POST",body:{action,note}})).plan;
    pitems=plan.items.map(i=>newItem({...i,expected:String(i.expected)}));
    toast(action==="approve"?`تم اعتماد الخطة · كود ${plan.code}`:"أُعيدت الخطة للتعديل وتم إشعار المؤسسة");await refreshPlanSums();renderPlanEditor();pollNotifications()}
  catch(x){toast(x.message)}
}

/* ---------- events ---------- */
$("#p-editor").addEventListener("input",e=>{const t=e.target;if(!t.dataset.pf)return;const r=pitems.find(x=>x.k==t.dataset.pk);if(!r)return;
  r[t.dataset.pf]=t.value;if(r.err){r.err="";const er=document.querySelector(`[data-perr="${r.k}"]`);if(er)er.textContent="";er?.closest(".act")?.classList.remove("has-err")}
  if(t.dataset.pf==="date"){const st=t.closest(".act").querySelector(".act-st");if(st)st.textContent=t.value?dayName(t.value)+" "+longDate(t.value):"";
    if(t.value&&isWeekend(t.value)){r.err=`يوم ${dayName(t.value)} عطلة أسبوعية. اختر يومًا من الأحد إلى الخميس.`;const er=document.querySelector(`[data-perr="${r.k}"]`);if(er){er.textContent=r.err;er.closest(".act").classList.add("has-err")}}}
  renderPlanSummary()});
$("#p-editor").addEventListener("change",e=>{const t=e.target;if(t.dataset.pf==="type"){const r=pitems.find(x=>x.k==t.dataset.pk);r.type=t.value;renderPlanEditor();document.getElementById(`p${r.k}-target`)?.focus()}});
$("#p-editor").addEventListener("click",e=>{
  const rm=e.target.closest("[data-prm]");if(rm){pitems=pitems.filter(r=>r.k!=rm.dataset.prm);renderPlanEditor();return}
  const oc=e.target.closest("[data-pocc]");if(oc){const[orig,name]=oc.dataset.pocc.split("|"),date=isWeekend(orig)?nearestWorkday(orig):orig;
    const blank=pitems.find(itemEmpty),x={title:"احتفالية "+name,type:"الأنشطة الترفيهية والمناسبات",target:"المجتمع المحلي",date,start:"10:00",end:"12:00"};
    if(blank)Object.assign(blank,x);else pitems.push(newItem(x));renderPlanEditor();
    toast(date!==orig?`أُضيفت يوم ${dayName(date)} ${shortDate(date)} لأن موعدها عطلة. أكمل الفئة والعدد والمسؤول.`:"أُضيفت المناسبة. أكمل الفئة والعدد والمسؤول.");return}
  if(e.target.id==="p-add"){pitems.push(newItem());renderPlanEditor();setTimeout(()=>document.getElementById(`p${pitems.at(-1).k}-title`)?.focus(),30);return}
  if(e.target.id==="p-save")savePlan(false);
  if(e.target.id==="p-submit")savePlan(true);
  if(e.target.id==="p-approve")reviewPlan("approve");
  if(e.target.id==="p-return"){$("#p-retbox").hidden=false;$("#p-retnote").focus()}
  if(e.target.id==="p-return-x")$("#p-retbox").hidden=true;
  if(e.target.id==="p-return-ok")reviewPlan("return");
  const dl=e.target.closest("[data-pdl]");if(dl)exportDoc(dl.dataset.fmt,planDoc(),dl);
});

/* ---------- printable plan (A4 landscape) ---------- */
function planDoc(){
  const c=CENTERS[plan.center],ym=planMonthVal(),list=sortedItems();
  const byAxis=AXES.map(a=>[a.name,list.filter(r=>r.type===a.name)]).filter(x=>x[1].length);
  const body=coverBand()+`<div class="r-cover"><div class="r-eyebrow">الخطة الشهرية للأنشطة والفعاليات</div>
    <h1>خطة ${monthLabel(ym)} – ${esc(c.vil)}</h1><div class="r-sub">مركز تنمية الأسرة والطفولة بقرية ${esc(c.vil)} · مركز ${esc(c.mk)}، محافظة ${esc(c.gov)} · ${esc(INST_BY[c.inst].name)}</div>
    <div class="r-meta"><span>حالة الخطة: ${PLAN_STATUS[plan.status]?.[0]||"مسودة"}</span><span>${fmt(list.length)} نشاط</span><span>${fmt(list.reduce((s,r)=>s+(+r.expected||0),0))} مستفيد متوقع</span><span>تاريخ الإصدار: ${longDate(todayStr())}</span></div></div>
    <div class="r-sec"><h2><span>١</span>جدول الأنشطة</h2><div class="r-tw"><table class="r-t"><thead><tr><th>م</th><th>اليوم والتاريخ</th><th>التوقيت</th><th>اسم النشاط</th><th>المحور</th><th>الفئة المستهدفة</th><th>العدد المتوقع</th><th>الجهة المنفذة / الشريكة</th><th>المسؤول عن التنفيذ</th></tr></thead><tbody>`+
    list.map((r,i)=>`<tr><td>${fmt(i+1)}</td><td>${dayName(r.date)} ${shortDate(r.date)}</td><td>${fmtTime(r.start)} – ${fmtTime(r.end)}</td><td>${esc(r.title)}</td><td>${esc(r.type)}</td><td>${esc(r.target)}</td><td>${fmt(+r.expected||0)}</td><td>${esc(r.partner)||"—"}</td><td>${esc(r.responsible)}</td></tr>`).join("")+
    `</tbody><tfoot><tr><td colspan="6">الإجمالي</td><td>${fmt(list.reduce((s,r)=>s+(+r.expected||0),0))}</td><td colspan="2"></td></tr></tfoot></table></div></div>
    <div class="r-sec"><h2><span>٢</span>التوزيع على المحاور</h2><div class="r-tw"><table class="r-t"><thead><tr><th>المحور</th><th>عدد الأنشطة</th><th>المستفيدون المتوقعون</th></tr></thead><tbody>`+
    byAxis.map(([a,l])=>`<tr><td>${esc(a)}</td><td>${fmt(l.length)}</td><td>${fmt(l.reduce((s,r)=>s+(+r.expected||0),0))}</td></tr>`).join("")+`</tbody></table></div></div>
    <div class="r-sec r-sign"><div><b>مدير المركز</b><span>الاسم:</span><span>التوقيع:</span></div><div><b>ممثل المؤسسة المشغلة</b><span>الاسم:</span><span>التوقيع:</span></div><div><b>اعتماد إدارة المشروع</b><span>الاسم:</span><span>التوقيع:</span></div></div>
    <div class="r-note">أُعدت الخطة وفق محاور ومحددات محضر اجتماع ٧ أكتوبر ٢٠٢٦: تغطية الفترة التشغيلية من ٧:٣٠ صباحًا حتى ٥:٠٠ مساءً من الأحد إلى الخميس، والتوزيع المنتظم على مدار الشهر، دون التعارض مع أنشطة الحضانة ورياض الأطفال، مع إدراج المناسبات الرسمية والأيام العالمية والمحلية والتنسيق لدعوة الشركاء الحكوميين المعنيين.</div>`;
  const ok=plan.status==="approved"&&plan.approval;
  return{title:`الخطة الشهرية ${monthLabel(ym)} – ${c.vil}`,body,landscape:true,filename:`خطة-${ym}-${c.vil}`,
    approval:ok?{...plan.approval,approver:plan.reviewedByName,at:plan.reviewedAt}:null};
}
