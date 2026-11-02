/* Reference data is loaded from /api/meta (see applyMeta) */
let INST=[],CENTERS={},INST_BY={},GOVS=[],TYPES=[],AXES=[],OCCASIONS=[],MOVABLE_OCCASIONS=[];
let DAY_START="07:30",DAY_END="17:00",PLAN_AHEAD=3,WEEKEND=[5,6],planSums=[];
let MIN_PER_MONTH=3,MAX_PHOTOS=4,MIN_PER_BATCH=3,START="2024-09";
function applyMeta(m){
  INST=m.institutions.map(i=>({id:i.id,name:i.name,c:i.centers}));
  CENTERS={};m.institutions.forEach(i=>i.centers.forEach(c=>CENTERS[c.id]=c));
  INST_BY=Object.fromEntries(INST.map(i=>[i.id,i]));
  GOVS=[...new Set(Object.values(CENTERS).map(c=>c.gov))];
  TYPES=m.types;AXES=m.axes;OCCASIONS=m.occasions;MOVABLE_OCCASIONS=m.movableOccasions||[];
  ({dayStart:DAY_START,dayEnd:DAY_END,planMonthsAhead:PLAN_AHEAD,weekendDays:WEEKEND=[5,6]}=m.rules);
  ({minPerMonth:MIN_PER_MONTH,maxPhotos:MAX_PHOTOS,minPerBatch:MIN_PER_BATCH,startMonth:START}=m.rules);
}
const MONTHS=["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const QN=["الربع الأول","الربع الثاني","الربع الثالث","الربع الرابع"];

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const fmt=n=>Number(n||0).toLocaleString("ar-EG");
const ymd=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const todayStr=()=>ymd(new Date());
const ls={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const norm=s=>String(s||"").replace(/[ً-ْٰـ]/g,"").replace(/[أإآٱ]/g,"ا").replace(/ة/g,"ه").replace(/ى/g,"ي").replace(/[^\p{L}\p{N}]+/gu," ").trim().toLowerCase();
const total=a=>(a.kids||0)+(a.women||0)+(a.men||0);
const sum=(l,k)=>l.reduce((s,a)=>s+(k?(a[k]||0):total(a)),0);
const shortDate=s=>{const d=new Date(s+"T00:00");return fmt(d.getDate())+" "+MONTHS[d.getMonth()]};
const longDate=s=>{const d=new Date(s+"T00:00");return fmt(d.getDate())+" "+MONTHS[d.getMonth()]+" "+d.getFullYear()};
const pct=(a,b)=>b?Math.round(a/b*100):0;

let db=false /* true once data has loaded */,me=null,isAdmin=false,acts=[];
const st={inst:null,center:null};
function restoreChoice(){
  st.inst=isAdmin?ls.get("fcdc.inst"):me.institution_id;st.center=ls.get("fcdc.center");
  if(st.inst&&!INST_BY[st.inst])st.inst=null;
  if(st.center&&(!CENTERS[st.center]||CENTERS[st.center].inst!==st.inst))st.center=null;
  if(st.inst&&!st.center){const one=Object.values(CENTERS).filter(c=>c.inst===st.inst);if(one.length===1)st.center=one[0].id}
}

/* ---------- API helper ---------- */
async function api(url,opt={}){
  const o={...opt,headers:{"X-Requested-With":"fetch",...(opt.headers||{})},credentials:"same-origin"};
  if(o.body&&!(o.body instanceof FormData)){o.headers["Content-Type"]="application/json";o.body=JSON.stringify(o.body)}
  const r=await fetch(url,o);
  if(r.status===401){location.href="/login";throw Object.assign(new Error("login"),{status:401})}
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(d.error||"خطأ"),{status:r.status,data:d});
  return d;
}

function toast(t){const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>el.hidden=true,3000)}
async function saveFile(filename,data){
  try{
    const type=filename.endsWith(".csv")?"text/csv;charset=utf-8":"text/html;charset=utf-8";
    const u=URL.createObjectURL(new Blob([data],{type})),a=document.createElement("a");
    a.href=u;a.download=filename;a.hidden=true;document.body.appendChild(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(u)},30000);
  }catch(x){toast("تعذر تنزيل الملف")}
}
const toDataURL=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob)});
const dataURLtoBlob=async u=>(await fetch(u)).blob();

/* ================= REGISTER ================= */
function renderSteps(){
  const s1=$("#s1-body"),s2=$("#s2-body");
  $("#s1").classList.toggle("done",!!st.inst);
  s1.innerHTML=!st.inst?'<p class="hint">اختر مؤسستك. سنتذكر اختيارك في المرات القادمة.</p><div class="inst-grid">'+
    INST.map(i=>`<button class="pick" data-inst="${i.id}"><span>${esc(i.name)}</span><span class="cnt num">${fmt(i.c.length)} ${i.c.length>2&&i.c.length<11?"مراكز":"مركز"}</span></button>`).join("")+'</div>'
    :`<div class="chosen"><strong>${esc(INST_BY[st.inst].name)}</strong>${isAdmin?'<button class="link" data-reset="inst">تغيير</button>':""}</div>`;
  $("#s2").hidden=!st.inst; $("#s2").classList.toggle("done",!!st.center);
  if(st.inst){
    if(!st.center){
      const byGov={};Object.values(CENTERS).filter(c=>c.inst===st.inst).forEach(c=>(byGov[c.gov]=byGov[c.gov]||[]).push(c));
      s2.innerHTML='<p class="hint">اختر المركز الذي نُفّذت فيه الأنشطة.</p>'+Object.entries(byGov).map(([g,l])=>`<div class="gov-group"><h3>محافظة ${esc(g)}</h3><div class="center-grid">`+
        l.map(c=>`<button class="pick" data-center="${c.id}"><span><span class="vil">${esc(c.vil)}</span><span class="mk">مركز ${esc(c.mk)}</span></span></button>`).join("")+'</div></div>').join("");
    }else{const c=CENTERS[st.center];
      s2.innerHTML=`<div class="chosen"><strong>${esc(c.vil)}</strong><span class="hint" style="margin:0">مركز ${esc(c.mk)} · ${esc(c.gov)}</span><button class="link" data-reset="center">تغيير</button></div>`;}
  }
  $("#s3").hidden=!st.center; if(st.center)checkAll();
  renderMine();
}
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-inst],[data-center],[data-reset]");if(!b)return;
  if(b.dataset.inst&&!isAdmin)return;
  if(b.dataset.inst){st.inst=b.dataset.inst;st.center=null;ls.set("fcdc.inst",st.inst);ls.set("fcdc.center","");
    const one=Object.values(CENTERS).filter(c=>c.inst===st.inst);if(one.length===1){st.center=one[0].id;ls.set("fcdc.center",st.center)}}
  if(b.dataset.center){st.center=b.dataset.center;ls.set("fcdc.center",st.center)}
  if(b.dataset.reset==="inst"&&isAdmin){st.inst=null;st.center=null}
  if(b.dataset.reset==="center")st.center=null;
  renderSteps();
});

/* batch rows */
let rows=[],rk=0;
const newRow=()=>({k:++rk,date:todayStr(),type:"",title:"",kids:"",women:"",men:"",partner:"",link:"",notes:"",photos:[],err:""});
function resetRows(){rows=[newRow(),newRow(),newRow()];renderRows()}
const isEmpty=r=>!r.title.trim()&&!r.type&&!r.photos.length&&!r.notes.trim();
const isDone=r=>r.date&&r.type&&r.title.trim().length>=4;
function rowHTML(r,i){
  const typeOpts='<option value="">اختر المحور</option>'+TYPES.map(t=>`<option${t===r.type?" selected":""}>${esc(t)}</option>`).join("");
  const nIn=(f,l)=>`<div><label for="r${r.k}-${f}" class="opt">${l}</label><input type="number" min="0" inputmode="numeric" id="r${r.k}-${f}" data-k="${r.k}" data-f="${f}" value="${esc(r[f])}" placeholder="0"></div>`;
  return `<div class="act" data-row="${r.k}">
   <div class="act-h"><b>نشاط ${fmt(i+1)}</b><span class="act-st" data-st="${r.k}"></span>${rows.length>3?`<button type="button" class="rm" data-rm="${r.k}">حذف</button>`:""}</div>
   <div class="grid3">
     <div><label for="r${r.k}-date">التاريخ</label><input type="date" id="r${r.k}-date" data-k="${r.k}" data-f="date" value="${r.date}" max="${todayStr()}"></div>
     <div><label for="r${r.k}-type">المحور</label><select id="r${r.k}-type" data-k="${r.k}" data-f="type">${typeOpts}</select></div>
     <div><label for="r${r.k}-title">عنوان النشاط</label><input type="text" id="r${r.k}-title" data-k="${r.k}" data-f="title" maxlength="140" value="${esc(r.title)}" placeholder="مثال: ندوة عن التغذية السليمة للأطفال"></div>
   </div>
   <div><label class="opt" style="font-weight:600;color:var(--fg)">عدد الحضور <span class="opt">(اختياري)</span></label><div class="cnts">${nIn("kids","أطفال")}${nIn("women","سيدات")}${nIn("men","رجال")}</div></div>
   <div class="grid2f">
     <div><label for="r${r.k}-partner">جهة شريكة <span class="opt">(اختياري)</span></label><input type="text" id="r${r.k}-partner" data-k="${r.k}" data-f="partner" maxlength="100" value="${esc(r.partner)}"></div>
     <div><label for="r${r.k}-link">رابط النشر الإعلامي <span class="opt">(فيسبوك، يوتيوب… اختياري)</span></label><input type="url" id="r${r.k}-link" data-k="${r.k}" data-f="link" dir="ltr" maxlength="400" value="${esc(r.link)}" placeholder="https://"></div>
   </div>
   <div><label for="r${r.k}-notes">ملاحظات <span class="opt">(اختياري)</span></label><textarea id="r${r.k}-notes" data-k="${r.k}" data-f="notes" maxlength="600">${esc(r.notes)}</textarea></div>
   <div><label>صور التوثيق <span class="opt">(حتى ${fmt(MAX_PHOTOS)} صور، بدون صور قريبة لوجوه الأطفال)</span></label>
     <div class="photos">${r.photos.map((p,j)=>`<div class="ph"><img src="${p.thumb}" alt="صورة ${j+1}"><button type="button" data-rmph="${r.k}:${j}" aria-label="إزالة الصورة">×</button></div>`).join("")}
     ${r.photos.length<MAX_PHOTOS?`<label class="add-ph">+ إضافة صور<input type="file" accept="image/*" multiple data-ph="${r.k}"></label>`:""}</div></div>
   <div class="act-err" data-err="${r.k}">${esc(r.err)}</div>
  </div>`;
}
function renderRows(){$("#acts").innerHTML=rows.map(rowHTML).join("");checkAll()}
const rowOf=k=>rows.find(r=>r.k==k);
$("#acts").addEventListener("input",e=>{const t=e.target;if(!t.dataset.f)return;const r=rowOf(t.dataset.k);r[t.dataset.f]=t.value;if(r.err){r.err="";$(`[data-err="${r.k}"]`).textContent=""}checkAll()});
$("#acts").addEventListener("change",e=>{const t=e.target;if(t.dataset.ph){addPhotos(rowOf(t.dataset.ph),[...t.files]);t.value=""}else if(t.dataset.f){rowOf(t.dataset.k)[t.dataset.f]=t.value;checkAll()}});
$("#acts").addEventListener("click",e=>{
  const rm=e.target.closest("[data-rm]");if(rm){rows=rows.filter(r=>r.k!=rm.dataset.rm);renderRows();return}
  const rp=e.target.closest("[data-rmph]");if(rp){const[k,j]=rp.dataset.rmph.split(":");rowOf(k).photos.splice(+j,1);renderRows()}
});
$("#add-act").onclick=()=>{rows.push(newRow());renderRows();setTimeout(()=>document.getElementById(`r${rows.at(-1).k}-title`)?.focus(),30)};

function loadImg(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file),im=new Image();im.onload=()=>{res(im);setTimeout(()=>URL.revokeObjectURL(u),1000)};im.onerror=()=>rej();im.src=u})}
function shrink(im,max,q,limit){
  let s=Math.min(1,max/Math.max(im.naturalWidth,im.naturalHeight)),out="";
  for(let t=0;t<6;t++){const c=document.createElement("canvas");c.width=Math.round(im.naturalWidth*s);c.height=Math.round(im.naturalHeight*s);
    const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(im,0,0,c.width,c.height);
    out=c.toDataURL("image/jpeg",q);if(out.length<=limit)break;q=Math.max(.5,q-.08);s*=.85}
  return out;
}
async function addPhotos(r,files){
  const room=MAX_PHOTOS-r.photos.length;
  if(files.length>room)toast(`يمكن إضافة ${fmt(room)} صور فقط لهذا النشاط`);
  for(const f of files.slice(0,room)){
    if(!f.type.startsWith("image/")){toast("الملفات المقبولة صور فقط");continue}
    try{const im=await loadImg(f);r.photos.push({full:shrink(im,1400,.8,230000),thumb:shrink(im,420,.7,40000)})}catch(e){toast("تعذر قراءة إحدى الصور")}
  }
  renderRows();
}

function dupCheck(list){
  const errs=new Map();const today=todayStr();
  list.forEach((r,i)=>{
    if(isEmpty(r))return;
    if(!isDone(r)){errs.set(r.k,"أكمل التاريخ والمحور والعنوان (٤ أحرف على الأقل)، أو احذف هذا النشاط.");return}
    if(r.date>today){errs.set(r.k,"التاريخ لا يمكن أن يكون في المستقبل.");return}
    if(r.link&&!/^https?:\/\/\S+\.\S+/.test(r.link.trim())){errs.set(r.k,"رابط النشر غير صحيح. يجب أن يبدأ بـ https://");return}
    const n=norm(r.title);
    const j=list.findIndex((o,x)=>x<i&&!isEmpty(o)&&norm(o.title)===n);
    if(j>-1){errs.set(r.k,`مكرر: نفس عنوان النشاط ${fmt(j+1)} في هذا التسجيل.`);return}
    const k=list.findIndex((o,x)=>x<i&&!isEmpty(o)&&o.date===r.date&&o.type===r.type&&total(o)===total(r)&&total(r)>0);
    if(k>-1){errs.set(r.k,`مكرر: نفس تاريخ ونوع وعدد حضور النشاط ${fmt(k+1)}.`);return}
    const ex=acts.find(a=>a.center===st.center&&a.date.slice(0,7)===r.date.slice(0,7)&&norm(a.title)===n);
    if(ex){errs.set(r.k,`مكرر: سبق تسجيل نشاط بنفس العنوان في هذا المركز بتاريخ ${longDate(ex.date)}.`);return}
    const ex2=acts.find(a=>a.center===st.center&&a.date===r.date&&a.type===r.type&&total(a)===total(r)&&total(r)>0);
    if(ex2)errs.set(r.k,`مكرر: سبق تسجيل «${ex2.title}» بنفس التاريخ والنوع وعدد الحضور.`);
  });
  return errs;
}
function checkAll(){
  const done=rows.filter(r=>isDone(r)).length;
  document.querySelectorAll("#meter i").forEach((i,x)=>i.classList.toggle("on",x<done));
  rows.forEach(r=>{const el=document.querySelector(`[data-row="${r.k}"]`);if(!el)return;const ok=isDone(r);el.classList.toggle("ok",ok);el.classList.toggle("has-err",!!r.err);
    $(`[data-st="${r.k}"]`).textContent=ok?(r.photos.length?`مكتمل · ${fmt(r.photos.length)} صور`:"مكتمل · بدون صور"):isEmpty(r)?"فارغ":"غير مكتمل"});
  const msg=$("#savemsg");msg.classList.remove("bad");
  msg.textContent=done<MIN_PER_BATCH?`أكملت ${fmt(done)} من ${fmt(MIN_PER_BATCH)} أنشطة على الأقل. لا يمكن الحفظ قبل إكمال ${fmt(MIN_PER_BATCH)} أنشطة.`:`${fmt(done)} أنشطة جاهزة للحفظ.`;
  $("#save").disabled=done<MIN_PER_BATCH||!db||saving;
}
let saving=false;
$("#f").addEventListener("submit",async e=>{
  e.preventDefault(); if(saving)return;
  const msg=$("#savemsg");
  const errs=dupCheck(rows);rows.forEach(r=>r.err=errs.get(r.k)||"");
  const good=rows.filter(r=>isDone(r)&&!errs.has(r.k));
  if(errs.size){renderRows();msg.textContent=`لم يتم الحفظ: ${fmt(errs.size)} نشاط يحتاج تصحيح (موضح باللون الأحمر).`;msg.classList.add("bad");document.querySelector(".act.has-err")?.scrollIntoView({behavior:"smooth",block:"center"});return}
  if(good.length<MIN_PER_BATCH){msg.textContent=`الحد الأدنى ${fmt(MIN_PER_BATCH)} أنشطة في كل تسجيل.`;msg.classList.add("bad");return}
  saving=true;$("#save").disabled=true;msg.textContent=`جارٍ حفظ ${fmt(good.length)} أنشطة…`;
  try{
    const fd=new FormData();
    fd.append("data",JSON.stringify({center:st.center,activities:good.map(r=>({date:r.date,type:r.type,title:r.title.trim(),kids:+r.kids||0,women:+r.women||0,men:+r.men||0,
      partner:r.partner.trim(),link:r.link.trim(),notes:r.notes.trim()}))}));
    for(const [i,r] of good.entries())for(const [j,p] of r.photos.entries()){
      fd.append(`p${i}_${j}_full`,await dataURLtoBlob(p.full),"full.jpg");fd.append(`p${i}_${j}_thumb`,await dataURLtoBlob(p.thumb),"thumb.jpg");
    }
    await api("/api/activities/batch",{method:"POST",body:fd});
    toast(isAdmin?`تم حفظ ${fmt(good.length)} أنشطة واعتمادها`:`تم إرسال ${fmt(good.length)} أنشطة لإدارة المشروع للاعتماد`);resetRows();await loadActs();if(typeof pollNotifications==="function")pollNotifications();
  }catch(x){
    if(x.data&&x.data.errors){Object.entries(x.data.errors).forEach(([i,m])=>{if(good[i])good[i].err=m});renderRows();
      msg.textContent="لم يتم الحفظ: "+x.message;}
    else msg.textContent="تعذر الحفظ: "+(x.status&&x.status<500?x.message:"تحقق من الاتصال وحاول مرة أخرى.");
    msg.classList.add("bad");
  }finally{saving=false;checkAll()}
});

const ACT_STATUS={pending:["قيد المراجعة","sub"],approved:["معتمد","ok"],returned:["معاد للتعديل","no"]};
const approvedActs=()=>acts.filter(a=>a.status==="approved");
function itemHTML(a,where){
  const d=new Date(a.date+"T00:00"),c=CENTERS[a.center]||{};
  const ppl=[a.kids?fmt(a.kids)+" طفل":"",a.women?fmt(a.women)+" سيدة":"",a.men?fmt(a.men)+" رجل":""].filter(Boolean).join(" · ");
  const canDel=isAdmin||(me&&a.by===me.id&&a.status!=="approved");
  const canEdit=isAdmin||(me&&a.inst===me.institution_id&&a.status!=="approved");
  const st=ACT_STATUS[a.status]||ACT_STATUS.pending;
  return `<div class="item"><div class="date num"><b>${fmt(d.getDate())}</b><span>${MONTHS[d.getMonth()]||""}</span></div>
   <div style="min-width:0"><div class="t">${esc(a.title)}</div>
    <div class="meta"><span class="pill ${st[1]}">${st[0]}</span><span class="tag">${esc(a.type)}</span>${a.photos?`<span class="tag o">${fmt(a.photos)} صور</span>`:""}${where?`<span>${esc(c.vil||"")} – ${esc(c.mk||"")} (${esc(c.gov||"")})</span><span>${esc(INST_BY[a.inst]?.name||"")}</span>`:""}${ppl?`<span class="num">الحضور: ${ppl}</span>`:""}${a.partner?`<span>بالشراكة مع ${esc(a.partner)}</span>`:""}${a.byName?`<span>سجّله: ${esc(a.byName)}</span>`:""}</div>
    ${a.status==="returned"&&a.reviewNote?`<div class="note-ret">ملاحظات الإدارة: ${esc(a.reviewNote)}</div>`:""}${a.notes?`<div class="note">${esc(a.notes)}</div>`:""}${a.link?`<div class="note"><a href="${esc(a.link)}" target="_blank" rel="noopener" dir="ltr">${esc(a.link.slice(0,70))}</a></div>`:""}</div>
   <div class="item-a">${canEdit?`<button class="del" data-edit="${a._id}">تعديل</button>`:""}${canDel?`<button class="del" data-del="${a._id}">حذف</button>`:""}</div></div>`;
}
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-del]");if(!b)return;
  if(!b.classList.contains("confirm")){b.classList.add("confirm");b.textContent="تأكيد الحذف";setTimeout(()=>{if(b.isConnected){b.classList.remove("confirm");b.textContent="حذف"}},4000);return}
  try{await api("/api/activities/"+encodeURIComponent(b.dataset.del),{method:"DELETE"});toast("تم حذف النشاط");await loadActs();if(typeof loadTasks==="function")loadTasks()}
  catch(x){toast(x.status&&x.status<500?x.message:"تعذر الحذف")}
});
function renderMine(){
  const sec=$("#mine-sec");if(!st.inst){sec.hidden=true;return}sec.hidden=false;
  const list=acts.filter(a=>a.inst===st.inst&&(!st.center||a.center===st.center));
  $("#mine-h").textContent=st.center?"آخر أنشطة هذا المركز":"آخر أنشطة المؤسسة";
  const m=todayStr().slice(0,7),mc=st.center?list.filter(a=>a.date.startsWith(m)).length:0;
  $("#mine-n").textContent=st.center?`هذا الشهر: ${fmt(mc)} من الحد الأدنى ٣`:list.length?fmt(list.length)+" نشاط":"";
  $("#mine").innerHTML=list.length?list.slice(0,15).map(a=>itemHTML(a,!st.center)).join(""):`<div class="empty">${db?"لم يُسجَّل أي نشاط هنا بعد. ستظهر الأنشطة هنا فور حفظها.":"جارٍ تحميل الأنشطة…"}</div>`;
}

/* ================= shared selects ================= */
function fillSelects(){
document.querySelectorAll(".sel-inst").forEach(s=>s.innerHTML=`<option value="">${s.id==="r-inst"?"كل المؤسسات (تقرير قومي)":"كل المؤسسات"}</option>`+INST.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join(""));
document.querySelectorAll(".sel-gov").forEach(s=>s.innerHTML='<option value="">كل المحافظات</option>'+GOVS.map(g=>`<option>${esc(g)}</option>`).join(""));
$("#d-type").innerHTML='<option value="">كل المحاور</option>'+TYPES.map(t=>`<option>${esc(t)}</option>`).join("");
$("#u-inst").innerHTML=INST.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join("");
$("#m-period").innerHTML=monthList().map(k=>`<option value="${k}">${monthLabel(k)}</option>`).join("");
fillPeriods();
}
function monthList(){const out=[],now=new Date();let y=now.getFullYear(),m=now.getMonth();while(true){const k=y+"-"+String(m+1).padStart(2,"0");out.push(k);if(k<=START)break;m--;if(m<0){m=11;y--}}return out}
const monthLabel=k=>MONTHS[+k.slice(5)-1]+" "+k.slice(0,4);

/* ================= DASHBOARD ================= */
["d-period","d-inst","d-gov","d-type","d-status"].forEach(id=>$("#"+id).addEventListener("change",()=>{feedLimit=30;renderDash()}));
const open=new Set();let feedLimit=30;
function range(p){const now=new Date();
  if(p==="this")return[ymd(new Date(now.getFullYear(),now.getMonth(),1)),ymd(now)];
  if(p==="last")return[ymd(new Date(now.getFullYear(),now.getMonth()-1,1)),ymd(new Date(now.getFullYear(),now.getMonth(),0))];
  if(p==="30"||p==="90"){const s=new Date(now);s.setDate(s.getDate()-Number(p)+1);return[ymd(s),ymd(now)]}
  return["0000","9999"]}
function renderDash(){
  if($("#view-dash").hidden)return;
  const f={inst:$("#d-inst").value,gov:$("#d-gov").value,type:$("#d-type").value,status:$("#d-status").value},p=$("#d-period").value,monthly=p==="this"||p==="last";
  const centers=Object.values(CENTERS).filter(c=>(!f.inst||c.inst===f.inst)&&(!f.gov||c.gov===f.gov));
  const base=acts.filter(a=>(!f.inst||a.inst===f.inst)&&(!f.gov||a.gov===f.gov)&&(!f.type||a.type===f.type)&&(!f.status||a.status===f.status));
  const[from,to]=range(p),list=base.filter(a=>a.date>=from&&a.date<=to);
  const cnt={};list.forEach(a=>cnt[a.center]=(cnt[a.center]||0)+1);
  const covered=centers.filter(c=>cnt[c.id]).length,met=centers.filter(c=>(cnt[c.id]||0)>=MIN_PER_MONTH).length;
  $("#kpis").innerHTML=[
    [fmt(list.length),"نشاط مسجل",`${fmt(list.filter(a=>a.status==="approved").length)} معتمد · ${fmt(list.filter(a=>a.status==="pending").length)} قيد المراجعة · ${fmt(list.filter(a=>a.photos).length)} موثق بالصور`],
    [fmt(covered)+" / "+fmt(centers.length),"مراكز سجّلت أنشطة",monthly?fmt(met)+" مركز حقق الحد الأدنى (٣)":fmt(pct(covered,centers.length))+"% من المراكز"],
    [fmt(sum(list,"kids")),"مشاركات أطفال",""],
    [fmt(sum(list,"women")+sum(list,"men")),"مشاركات بالغين",fmt(sum(list,"women"))+" سيدة · "+fmt(sum(list,"men"))+" رجل"],
  ].map(k=>`<div class="kpi"><div class="v num">${k[0]}</div><div class="l">${k[1]}</div>${k[2]?`<div class="s num">${k[2]}</div>`:""}</div>`).join("");
  const planMonth=monthly?from.slice(0,7):null,planOf={};
  if(planMonth)planSums.filter(x=>x.month===planMonth).forEach(x=>planOf[x.center]=x);
  const planCell=ic=>{if(!planMonth)return '<span class="hint">—</span>';const n=ic.filter(c=>planOK(planOf[c.id])).length;
    return `<div class="cov"><span class="num">${fmt(n)}</span><span class="bar"><i style="width:${pct(n,ic.length)}%"></i></span></div>`};
  const rowsH=[];
  INST.forEach(i=>{const ic=centers.filter(c=>c.inst===i.id);if(!ic.length)return;
    const il=list.filter(a=>a.inst===i.id),cov=ic.filter(c=>cnt[c.id]).length,last=base.filter(a=>a.inst===i.id).map(a=>a.date).sort().pop(),isOpen=open.has(i.id);
    rowsH.push(`<tr class="inst-row${isOpen?" open":""}" data-open="${i.id}" tabindex="0"><td><span class="caret">◂</span> ${esc(i.name)}</td><td class="num">${fmt(ic.length)}</td>
      <td><div class="cov"><span class="num">${fmt(cov)}</span><span class="bar"><i style="width:${pct(cov,ic.length)}%"></i></span></div></td>
      <td>${planCell(ic)}</td><td class="num">${fmt(il.length)}</td><td class="num">${fmt(sum(il))}</td><td class="num">${last?shortDate(last):"—"}</td></tr>`);
    if(isOpen)ic.forEach(c=>{const cl=il.filter(a=>a.center===c.id),n=cl.length,l=base.filter(a=>a.center===c.id).map(a=>a.date).sort().pop();
      const pill=!n?'<span class="pill no">لم يسجل</span>':monthly&&n<MIN_PER_MONTH?`<span class="pill low">${fmt(n)} من ٣</span>`:'<span class="pill ok">سجّل</span>';
      rowsH.push(`<tr class="sub"><td>${esc(c.vil)} <span class="hint">– ${esc(c.mk)}، ${esc(c.gov)}</span></td><td></td><td>${pill}</td><td>${planMonth?planPill(planOf[c.id]):""}</td><td class="num">${fmt(n)}</td><td class="num">${fmt(sum(cl))}</td><td class="num">${l?shortDate(l):"—"}</td></tr>`)});
  });
  $("#inst-tb").innerHTML=rowsH.join("")||'<tr><td colspan="7" class="hint">لا توجد مراكز ضمن هذا الاختيار.</td></tr>';
  const bt=[...new Set([...TYPES,...list.map(a=>a.type)])].map(t=>[t,list.filter(a=>a.type===t).length]).filter(x=>x[1]).sort((a,b)=>b[1]-a[1]),mx=Math.max(1,...bt.map(x=>x[1]));
  $("#by-type").innerHTML=bt.length?bt.map(([t,n])=>`<div class="hbar"><span>${esc(t)}</span><span class="bar"><i style="width:${n/mx*100}%"></i></span><span class="n num">${fmt(n)}</span></div>`).join(""):'<div class="empty">لا أنشطة في هذه الفترة.</div>';
  const wk=[],now=new Date();now.setHours(0,0,0,0);const s0=new Date(now);s0.setDate(s0.getDate()-((s0.getDay()+1)%7));
  for(let k=11;k>=0;k--){const s=new Date(s0);s.setDate(s.getDate()-7*k);const e=new Date(s);e.setDate(e.getDate()+6);wk.push([s,ymd(s),ymd(e),0])}
  base.forEach(a=>wk.forEach(w=>{if(a.date>=w[1]&&a.date<=w[2])w[3]++}));
  const top=Math.ceil(Math.max(4,...wk.map(w=>w[3]))/4)*4,W=420,H=180,pl=8,pr=30,pt=10,pb=28,bw=(W-pl-pr)/12;
  let svg=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="عدد الأنشطة أسبوعيًا">`;
  for(let g=0;g<=4;g++){const y=pt+(H-pt-pb)*(1-g/4);svg+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1"/><text x="${W-pr+6}" y="${y+4}" font-size="11">${fmt(top*g/4)}</text>`}
  wk.forEach((w,k)=>{const x=W-pr-(k+1)*bw+bw*.18,h=(H-pt-pb)*w[3]/top,y=H-pb-h;
    svg+=`<rect x="${x}" y="${y}" width="${bw*.64}" height="${h}" rx="2" fill="${k===11?"var(--brand)":"var(--brand-soft)"}" stroke="var(--brand)" stroke-width="${k===11?0:1}"><title>${fmt(w[3])} نشاط</title></rect>`;
    if(k%3===2||k===11)svg+=`<text x="${x+bw*.32}" y="${H-10}" font-size="10.5" text-anchor="middle">${fmt(w[0].getDate())} ${MONTHS[w[0].getMonth()].slice(0,5)}</text>`});
  $("#by-week").innerHTML=svg+'</svg><p class="foot">العمود الداكن هو الأسبوع الحالي (يبدأ السبت).</p>';
  $("#feed-n").textContent=fmt(list.length)+" نشاط";
  $("#feed").innerHTML=list.length?list.slice(0,feedLimit).map(a=>itemHTML(a,true)).join(""):'<div class="empty">لا توجد أنشطة ضمن هذا الاختيار. عند تسجيل المؤسسات لأنشطتها ستظهر هنا مباشرة.</div>';
  $("#more").hidden=list.length<=feedLimit;
  $("#csv").onclick=()=>{
    const q=v=>'"'+String(v??"").replace(/"/g,'""')+'"',head=["التاريخ","المؤسسة","المحافظة","المركز","القرية","كود المركز","المحور","العنوان","حالة الاعتماد","أطفال","سيدات","رجال","عدد الصور","رابط إعلامي","جهة شريكة","ملاحظات"];
    const lines=[head.map(q).join(",")].concat(list.map(a=>{const c=CENTERS[a.center]||{};return[a.date,INST_BY[a.inst]?.name,c.gov,c.mk,c.vil,a.center,a.type,a.title,(ACT_STATUS[a.status]||[""])[0],a.kids||0,a.women||0,a.men||0,a.photos||0,a.link,a.partner,a.notes].map(q).join(",")}));
    saveFile("أنشطة-المراكز-"+todayStr()+".csv","﻿"+lines.join("\r\n"));
  };
}
$("#inst-tb").addEventListener("click",e=>{const r=e.target.closest("[data-open]");if(!r)return;const id=r.dataset.open;open.has(id)?open.delete(id):open.add(id);renderDash()});
$("#inst-tb").addEventListener("keydown",e=>{if(e.key==="Enter")e.target.closest("[data-open]")?.click()});
$("#more").onclick=()=>{feedLimit+=30;renderDash()};

/* ================= MEDIA ================= */
let mediaCache={},mediaShown=[];
const thumbURL=id=>`/api/photos/${encodeURIComponent(id)}/thumb`,fullURL=id=>`/api/photos/${encodeURIComponent(id)}/full`;
async function fetchThumbs(from,to){
  const map={};acts.filter(a=>a.date>=from&&a.date<=to).forEach(a=>(a.mediaIds||[]).forEach(id=>map[id]=thumbURL(id)));return map;
}
async function renderMedia(){
  if($("#view-media").hidden||!db)return;
  const m=$("#m-period").value,f={inst:$("#m-inst").value,gov:$("#m-gov").value},from=m+"-01",to=m+"-31";
  const list=approvedActs().filter(a=>a.date>=from&&a.date<=to&&(!f.inst||a.inst===f.inst)&&(!f.gov||a.gov===f.gov));
  const doc=list.filter(a=>a.photos||a.link);
  renderDocBar("m-bar");
  $("#m-kpis").innerHTML=[[fmt(list.length),"نشاط في الشهر",""],[fmt(list.filter(a=>a.photos).length),"نشاط موثق بالصور",fmt(pct(list.filter(a=>a.photos).length,list.length))+"% من الأنشطة"],
    [fmt(sum(list,"photos")),"صورة مرفوعة",""],[fmt(list.filter(a=>a.link).length),"رابط نشر إعلامي",""]]
    .map(k=>`<div class="kpi"><div class="v num">${k[0]}</div><div class="l">${k[1]}</div>${k[2]?`<div class="s num">${k[2]}</div>`:""}</div>`).join("");
  $("#m-n").textContent=fmt(doc.length)+" نشاط موثق";
  if(!doc.length){$("#m-list").innerHTML='<div class="empty">لا يوجد توثيق إعلامي لهذا الشهر بعد. عندما ترفع المؤسسات صورًا أو روابط مع أنشطتها ستظهر هنا.</div>';mediaShown=[];return}
  $("#m-list").innerHTML='<div class="empty">جارٍ تحميل الصور…</div>';
  let th={};try{th=await fetchThumbs(from,to)}catch(e){}
  mediaShown=doc;
  $("#m-list").innerHTML=doc.map(a=>{const c=CENTERS[a.center]||{};return `<div class="mcard"><div class="t" style="font-weight:600">${esc(a.title)}</div>
    <div class="meta"><span class="tag">${esc(a.type)}</span><span>${longDate(a.date)}</span><span>${esc(c.vil)} – ${esc(c.mk)} (${esc(c.gov)})</span><span>${esc(INST_BY[a.inst]?.name)}</span></div>
    ${a.mediaIds&&a.mediaIds.length?`<div class="thumbs">${a.mediaIds.map(id=>th[id]?`<button type="button" data-lb="${id}" data-cap="${esc(a.title+" · "+c.vil)}"><img src="${th[id]}" alt="صورة من ${esc(a.title)}" loading="lazy"></button>`:"").join("")}</div>`:""}
    ${a.link?`<div class="note"><a href="${esc(a.link)}" target="_blank" rel="noopener" dir="ltr">${esc(a.link)}</a></div>`:""}</div>`}).join("");
}
["m-period","m-inst","m-gov"].forEach(id=>$("#"+id).addEventListener("change",renderMedia));
document.addEventListener("click",async e=>{const b=e.target.closest("[data-lb]");if(!b)return;
  $("#lb-img").src=b.querySelector("img").src;$("#lb-cap").textContent=b.dataset.cap;$("#lb").hidden=false;
  const full=new Image();full.onload=()=>{if(!$("#lb").hidden)$("#lb-img").src=full.src};full.src=fullURL(b.dataset.lb)});
$("#lb-x").onclick=()=>$("#lb").hidden=true;$("#lb").addEventListener("click",e=>{if(e.target.id==="lb")$("#lb").hidden=true});
document.addEventListener("keydown",e=>{if(e.key==="Escape")$("#lb").hidden=true});
async function fullImages(ids,onStep){const out={};let n=0;for(const id of ids){try{const r=await fetch(fullURL(id),{credentials:"same-origin"});if(r.ok)out[id]=await toDataURL(await r.blob())}catch(e){}onStep&&onStep(++n,ids.length)}return out}
async function mediaDoc(){
  const m=$("#m-period").value,inst=$("#m-inst").value,gov=$("#m-gov").value;
  if(!mediaShown.length){toast("لا يوجد توثيق معتمد في هذا الاختيار");return null}
  const ids=mediaShown.flatMap(a=>a.mediaIds||[]);
  const full=await fullImages(ids);
  const scope=(inst?INST_BY[inst].name:"كل المؤسسات")+(gov?" · محافظة "+gov:"");
  const body=`${coverBand()}<div class="r-cover"><div class="r-eyebrow">ملف التوثيق الإعلامي</div><h1>التوثيق الإعلامي لأنشطة مراكز تنمية الأسرة والطفل</h1><div class="r-sub">${monthLabel(m)} · ${esc(scope)}</div>
   <div class="r-meta"><span>${fmt(mediaShown.length)} نشاط موثق</span><span>${fmt(ids.length)} صورة</span><span>تاريخ الإصدار: ${longDate(todayStr())}</span></div></div>`+
   mediaShown.map(a=>{const c=CENTERS[a.center]||{};return `<div class="r-sec"><h2>${esc(a.title)}</h2><p style="font-size:13px;color:#5A6F6B">${longDate(a.date)} · ${esc(a.type)} · ${esc(c.vil)} – ${esc(c.mk)}، ${esc(c.gov)} · ${esc(INST_BY[a.inst]?.name)}${total(a)?` · الحضور ${fmt(total(a))}`:""}</p>
   ${(a.mediaIds||[]).length?`<div class="r-hl">${a.mediaIds.map(id=>full[id]?`<figure><img src="${full[id]}" alt=""></figure>`:"").join("")}</div>`:""}
   ${a.link?`<p style="font-size:13px">رابط النشر: <a href="${esc(a.link)}" dir="ltr">${esc(a.link)}</a></p>`:""}</div>`}).join("")+
   `<div class="r-note">الصور مرفوعة من المؤسسات المشغلة عبر منظومة المتابعة. يُراعى الحصول على موافقة أولياء الأمور قبل النشر العام لأي صورة يظهر فيها أطفال.</div>`;
  return{title:"ملف التوثيق الإعلامي "+monthLabel(m)+" – "+scope,body,summary:{"أنشطة موثقة":mediaShown.length,"صور":ids.length},filename:`ملف-التوثيق-الإعلامي-${m}`};
}

/* ================= REPORTS ================= */
function periodOptions(kind){
  const ms=monthList();
  if(kind==="m")return ms.map(k=>[k,monthLabel(k)]);
  if(kind==="q"){const s=new Set(),o=[];ms.forEach(k=>{const q=k.slice(0,4)+"-Q"+(Math.floor((+k.slice(5)-1)/3)+1);if(!s.has(q)){s.add(q);o.push([q,QN[+q.slice(-1)-1]+" "+q.slice(0,4)])}});return o}
  return [...new Set(ms.map(k=>k.slice(0,4)))].map(y=>[y,"عام "+y]);
}
function periodSpec(kind,v){
  let months;
  if(kind==="m")months=[v];
  else if(kind==="q"){const y=v.slice(0,4),q=+v.slice(-1);months=[0,1,2].map(i=>y+"-"+String(q*3-2+i).padStart(2,"0"))}
  else months=Array.from({length:12},(_,i)=>v+"-"+String(i+1).padStart(2,"0"));
  const cur=todayStr().slice(0,7),elapsed=months.filter(m=>m<=cur&&m>=START);
  let prev;
  if(kind==="m"){const d=new Date(+v.slice(0,4),+v.slice(5)-2,1);prev=[ymd(d).slice(0,7)]}
  else if(kind==="q"){const d=new Date(+months[0].slice(0,4),+months[0].slice(5)-4,1);prev=[0,1,2].map(i=>{const x=new Date(d.getFullYear(),d.getMonth()+i,1);return ymd(x).slice(0,7)})}
  else prev=Array.from({length:12},(_,i)=>(+v-1)+"-"+String(i+1).padStart(2,"0"));
  return{months,elapsed,prev,from:months[0]+"-01",to:months.at(-1)+"-31"};
}
let LOGOS=[...document.querySelectorAll("#logos img")].map(i=>({src:i.getAttribute("src"),alt:i.alt,wide:i.classList.contains("wide")}));
async function embedLogos(){LOGOS=await Promise.all(LOGOS.map(async l=>{try{return {...l,src:await toDataURL(await (await fetch(l.src)).blob())}}catch(e){return l}}))}
const coverBand=()=>`<div class="r-band">${LOGOS.map(l=>`<img src="${l.src}" alt="${esc(l.alt)}"${l.wide?' class="wide"':""}>`).join("")}</div>`;
function fillPeriods(){const o=periodOptions($("#r-kind").value);$("#r-period").innerHTML=o.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join("")}
$("#r-kind").addEventListener("change",()=>{fillPeriods();renderReport()});
["r-period","r-inst"].forEach(id=>$("#"+id).addEventListener("change",renderReport));
let reportPhotos={};
async function buildReport(photoMap){
  const kind=$("#r-kind").value,v=$("#r-period").value,instId=$("#r-inst").value,spec=periodSpec(kind,v);
  const kindName={m:"التقرير الشهري",q:"التقرير الربع سنوي",y:"التقرير السنوي"}[kind];
  const pLabel=$("#r-period").selectedOptions[0]?.textContent||v;
  const centers=Object.values(CENTERS).filter(c=>!instId||c.inst===instId);
  const inScope=a=>!instId||a.inst===instId;
  const A=approvedActs(),list=A.filter(a=>inScope(a)&&spec.months.includes(a.date.slice(0,7)));
  const prevList=A.filter(a=>inScope(a)&&spec.prev.includes(a.date.slice(0,7)));
  const pendingN=acts.filter(a=>a.status!=="approved"&&inScope(a)&&spec.months.includes(a.date.slice(0,7))).length;
  lastReportSummary={"الأنشطة المعتمدة":list.length,"مراكز سجّلت أنشطة":`${fmt(centers.filter(c=>list.some(a=>a.center===c.id)).length)} من ${fmt(centers.length)}`,"إجمالي المشاركات":sum(list)};
  const need=MIN_PER_MONTH*Math.max(1,spec.elapsed.length);
  const cnt={};list.forEach(a=>cnt[a.center]=(cnt[a.center]||0)+1);
  lastPendingN=pendingN;
  const covered=centers.filter(c=>cnt[c.id]).length,met=centers.filter(c=>(cnt[c.id]||0)>=need).length;
  const docd=list.filter(a=>a.photos).length;
  const chg=prevList.length?Math.round((list.length-prevList.length)/prevList.length*100):null;
  const scopeName=instId?INST_BY[instId].name:"كل المؤسسات المشغلة (المستوى القومي)";
  const typeRank=[...new Set([...TYPES,...list.map(a=>a.type)])].map(t=>[t,list.filter(a=>a.type===t).length]).filter(x=>x[1]).sort((a,b)=>b[1]-a[1]);
  const zero=centers.filter(c=>!cnt[c.id]),low=centers.filter(c=>cnt[c.id]&&cnt[c.id]<need);
  const cName=c=>`${esc(c.vil)} (${esc(c.mk)}، ${esc(c.gov)})${instId?"":" – "+esc(INST_BY[c.inst].name)}`;

  let h=coverBand()+`<div class="r-cover"><div class="r-eyebrow">${kindName}</div>
   <h1>${kindName} لأنشطة مراكز تنمية الأسرة والطفل</h1><div class="r-sub">${esc(pLabel)} · ${esc(scopeName)}</div>
   <div class="r-meta"><span>نطاق التقرير: ${fmt(centers.length)} مركز</span><span>تاريخ الإصدار: ${longDate(todayStr())}</span><span>المصدر: منظومة متابعة الأنشطة</span></div></div>`;

  if(!list.length){
    return h+`<div class="r-sec"><h2><span>١</span>الملخص</h2><p>لم تُسجَّل أي أنشطة ضمن هذه الفترة والنطاق في منظومة المتابعة حتى تاريخ إصدار التقرير. يتكوّن التقرير تلقائيًا بمجرد تسجيل المؤسسات لأنشطتها.</p></div>
      <div class="r-sec"><h2><span>٢</span>مراكز لم تسجل أنشطة</h2><p>${fmt(centers.length)} مركز ضمن النطاق لم يسجل أي نشاط.</p></div>`+methodNote(need,spec);
  }
  let n=0;const sec=t=>`<h2><span>${fmt(++n)}</span>${t}</h2>`;
  h+=`<div class="r-sec">${sec("الملخص التنفيذي")}<p>خلال ${esc(pLabel)} سجّلت ${instId?esc(INST_BY[instId].name):"المؤسسات المشغلة"} <b>${fmt(list.length)}</b> نشاطًا في <b>${fmt(covered)}</b> من أصل ${fmt(centers.length)} مركزًا (${fmt(pct(covered,centers.length))}%)${chg===null?"":`، ${chg>=0?"بزيادة":"بانخفاض"} ${fmt(Math.abs(chg))}% عن الفترة السابقة (${fmt(prevList.length)} نشاط)`}.
    بلغ إجمالي المشاركات ${fmt(sum(list))} مشاركة، منها ${fmt(sum(list,"kids"))} مشاركة أطفال و${fmt(sum(list,"women"))} سيدة و${fmt(sum(list,"men"))} رجل.
    ${typeRank.length?`وتصدّرت أنشطة «${esc(typeRank[0][0])}» بعدد ${fmt(typeRank[0][1])} نشاط.`:""}</p>
    <p>حقق ${fmt(met)} مركزًا الحد الأدنى المطلوب (${fmt(need)} أنشطة للفترة)، بينما ${zero.length?`لم يسجل ${fmt(zero.length)} مركز أي نشاط`:"سجّلت جميع المراكز أنشطة"}${low.length?` وسجّل ${fmt(low.length)} مركز أقل من الحد الأدنى`:""}. وُثّق ${fmt(pct(docd,list.length))}% من الأنشطة بالصور.</p></div>`;
  h+=`<div class="r-sec">${sec("المؤشرات الرئيسية")}<div class="r-kpis">
    <div><b>${fmt(list.length)}</b><small>نشاط مسجل</small></div>
    <div><b>${fmt(covered)} / ${fmt(centers.length)}</b><small>مراكز سجّلت أنشطة</small></div>
    <div><b>${fmt(met)} / ${fmt(centers.length)}</b><small>مراكز حققت الحد الأدنى (${fmt(need)})</small></div>
    <div><b>${fmt(sum(list,"kids"))}</b><small>مشاركات أطفال</small></div>
    <div><b>${fmt(sum(list,"women")+sum(list,"men"))}</b><small>مشاركات بالغين</small></div>
    <div><b>${fmt(pct(docd,list.length))}%</b><small>أنشطة موثقة بالصور</small></div></div></div>`;
  if(!instId){
    h+=`<div class="r-sec">${sec("الأداء حسب المؤسسة")}<div class="r-tw"><table class="r-t"><thead><tr><th>المؤسسة</th><th>المراكز</th><th>سجّلت</th><th>حققت الحد الأدنى</th><th>الأنشطة</th><th>المشاركات</th><th>موثقة بالصور</th></tr></thead><tbody>`+
    INST.map(i=>{const ic=centers.filter(c=>c.inst===i.id),il=list.filter(a=>a.inst===i.id);
      return `<tr><td>${esc(i.name)}</td><td>${fmt(ic.length)}</td><td>${fmt(ic.filter(c=>cnt[c.id]).length)}</td><td>${fmt(ic.filter(c=>(cnt[c.id]||0)>=need).length)}</td><td>${fmt(il.length)}</td><td>${fmt(sum(il))}</td><td>${fmt(pct(il.filter(a=>a.photos).length,il.length))}%</td></tr>`}).join("")+
    `</tbody><tfoot><tr><td>الإجمالي</td><td>${fmt(centers.length)}</td><td>${fmt(covered)}</td><td>${fmt(met)}</td><td>${fmt(list.length)}</td><td>${fmt(sum(list))}</td><td>${fmt(pct(docd,list.length))}%</td></tr></tfoot></table></div></div>`;
  }else{
    h+=`<div class="r-sec">${sec("الأداء حسب المركز")}<div class="r-tw"><table class="r-t"><thead><tr><th>المركز</th><th>المحافظة</th><th>الأنشطة</th><th>الحد الأدنى</th><th>المشاركات</th><th>آخر نشاط</th></tr></thead><tbody>`+
    centers.map(c=>{const cl=list.filter(a=>a.center===c.id),l=cl.map(a=>a.date).sort().pop();return `<tr><td>${esc(c.vil)} – ${esc(c.mk)}</td><td>${esc(c.gov)}</td><td>${fmt(cl.length)}</td><td>${cl.length>=need?"متحقق":"غير متحقق"}</td><td>${fmt(sum(cl))}</td><td>${l?longDate(l):"—"}</td></tr>`}).join("")+`</tbody></table></div></div>`;
  }
  const pl=planSums.filter(x=>planOK(x)&&spec.months.includes(x.month)&&(!instId||x.inst===instId));
  if(pl.length){
    const due=centers.length*Math.max(1,spec.elapsed.length),row=(name,cs)=>{const ids=new Set(cs.map(c=>c.id)),pp=pl.filter(x=>ids.has(x.center)),
      planned=pp.reduce((s,x)=>s+x.items,0),done=list.filter(a=>ids.has(a.center)&&pp.some(x=>x.center===a.center&&a.date.startsWith(x.month))).length;
      return `<tr><td>${name}</td><td>${fmt(pp.length)}</td><td>${fmt(planned)}</td><td>${fmt(done)}</td><td>${planned?fmt(pct(done,planned))+"%":"—"}</td></tr>`};
    h+=`<div class="r-sec">${sec("الالتزام بالخطة الشهرية")}<p>قُدّمت ${fmt(pl.length)} خطة شهرية (مرسلة أو معتمدة) من أصل ${fmt(due)} خطة مستحقة لمراكز النطاق، تضمنت ${fmt(pl.reduce((s,x)=>s+x.items,0))} نشاطًا مخططًا. تُقارن الأنشطة المنفذة بالمخططة للمراكز التي قدّمت خططها فقط.</p>
      <div class="r-tw"><table class="r-t"><thead><tr><th>${instId?"المركز":"المؤسسة"}</th><th>خطط مقدّمة</th><th>أنشطة مخططة</th><th>أنشطة منفذة</th><th>نسبة التنفيذ</th></tr></thead><tbody>`+
      (instId?centers.map(c=>row(`${esc(c.vil)} – ${esc(c.mk)}`,[c])):INST.map(i=>row(esc(i.name),centers.filter(c=>c.inst===i.id)))).join("")+`</tbody></table></div></div>`;
  }
  const govs=[...new Set(centers.map(c=>c.gov))];
  h+=`<div class="r-sec">${sec("التوزيع حسب المحافظة")}<div class="r-tw"><table class="r-t"><thead><tr><th>المحافظة</th><th>المراكز</th><th>سجّلت</th><th>الأنشطة</th><th>أطفال</th><th>سيدات</th><th>رجال</th></tr></thead><tbody>`+
    govs.map(g=>{const gc=centers.filter(c=>c.gov===g),gl=list.filter(a=>a.gov===g);return `<tr><td>${esc(g)}</td><td>${fmt(gc.length)}</td><td>${fmt(gc.filter(c=>cnt[c.id]).length)}</td><td>${fmt(gl.length)}</td><td>${fmt(sum(gl,"kids"))}</td><td>${fmt(sum(gl,"women"))}</td><td>${fmt(sum(gl,"men"))}</td></tr>`}).join("")+`</tbody></table></div></div>`;
  const tm=Math.max(1,...typeRank.map(x=>x[1]));
  h+=`<div class="r-sec">${sec("الأنشطة حسب المحور")}<div class="r-bars">`+typeRank.map(([t,c])=>`<div class="rb"><span>${esc(t)}</span><span><i style="width:${c/tm*100}%"></i></span><span>${fmt(c)}</span></div>`).join("")+`</div></div>`;
  let buckets;
  if(kind==="m"){const y=+v.slice(0,4),mo=+v.slice(5)-1,days=new Date(y,mo+1,0).getDate();buckets=[];for(let d=1;d<=days;d+=7){const e=Math.min(days,d+6);buckets.push([`${fmt(d)}–${fmt(e)}`,a=>{const dd=+a.date.slice(8);return dd>=d&&dd<=e}])}}
  else buckets=spec.months.map(m=>[MONTHS[+m.slice(5)-1].slice(0,kind==="y"?3:12),a=>a.date.startsWith(m)]);
  const bc=buckets.map(([l,f])=>[l,list.filter(f).length]),bm=Math.max(1,...bc.map(x=>x[1]));
  h+=`<div class="r-sec">${sec(kind==="m"?"التطور خلال الشهر (أسبوعيًا)":"التطور الشهري")}<div class="r-cols">${bc.map(([l,c])=>`<div><b>${c?fmt(c):""}</b><i style="height:${c/bm*100}%"></i></div>`).join("")}</div><div class="r-axis">${bc.map(([l])=>`<span>${l}</span>`).join("")}</div></div>`;
  h+=`<div class="r-sec">${sec("مراكز تحتاج متابعة")}<div class="r-flag">
    <div><h3>لم تسجل أي نشاط (${fmt(zero.length)})</h3>${zero.length?`<ul>${zero.map(c=>`<li>${cName(c)}</li>`).join("")}</ul>`:'<p style="font-size:13px">لا يوجد.</p>'}</div>
    <div><h3>أقل من الحد الأدنى (${fmt(low.length)})</h3>${low.length?`<ul>${low.map(c=>`<li>${cName(c)}: ${fmt(cnt[c.id])} من ${fmt(need)}</li>`).join("")}</ul>`:'<p style="font-size:13px">لا يوجد.</p>'}</div></div></div>`;
  const hl=[...list].sort((a,b)=>(b.photos?1:0)-(a.photos?1:0)||total(b)-total(a)).slice(0,6);
  h+=`<div class="r-sec">${sec("أبرز الأنشطة")}<div class="r-hl">`+hl.map(a=>{const c=CENTERS[a.center]||{},pid=(a.mediaIds||[])[0],src=pid&&photoMap[pid];
    return `<figure>${src?`<img src="${src}" alt="">`:""}<figcaption><b>${esc(a.title)}</b>${longDate(a.date)} · ${esc(c.vil)}، ${esc(c.gov)}<br>${esc(a.type)}${total(a)?` · ${fmt(total(a))} مشارك`:""}</figcaption></figure>`}).join("")+`</div></div>`;
  return h+methodNote(need,spec);
}
let lastReportSummary={},lastPendingN=0;
function methodNote(need,spec){return `<div class="r-note">ملاحظات منهجية: يشمل التقرير الأنشطة المعتمدة من إدارة المشروع فقط${lastPendingN?` (${fmt(lastPendingN)} نشاط في الفترة قيد المراجعة أو معاد للتعديل غير مدرج)`:""}. البيانات مُبلَّغ عنها من المؤسسات المشغلة عبر منظومة المتابعة ولم يُتحقق منها ميدانيًا. أعداد الحضور مشاركات وليست مستفيدين فريدين، إذ قد يشارك الشخص نفسه في أكثر من نشاط. الحد الأدنى = ٣ أنشطة لكل مركز عن كل شهر منقضٍ في الفترة (${fmt(need)} نشاط لهذه الفترة).</div>`}
async function renderReport(){
  if($("#view-reports").hidden)return;
  const el=$("#report");el.innerHTML=await buildReport(reportPhotos);
  // fetch thumbnails for highlights lazily, then re-render once
  const kind=$("#r-kind").value,spec=periodSpec(kind,$("#r-period").value);
  renderDocBar("r-bar");
  if(db&&acts.some(a=>a.photos&&spec.months.includes(a.date.slice(0,7)))){try{const th=await fetchThumbs(spec.from,spec.to);let add=false;for(const k in th)if(!reportPhotos[k]){reportPhotos[k]=th[k];add=true}if(add)el.innerHTML=await buildReport(reportPhotos)}catch(e){}}
}
async function reportDoc(){
  const kind=$("#r-kind").value,v=$("#r-period").value,instId=$("#r-inst").value,spec=periodSpec(kind,v);
  const hlIds=approvedActs().filter(a=>a.photos&&(!instId||a.inst===instId)&&spec.months.includes(a.date.slice(0,7))).map(a=>a.mediaIds[0]).slice(0,30);
  const body=await buildReport(await fullImages(hlIds)),name={m:"التقرير الشهري",q:"التقرير الربع سنوي",y:"التقرير السنوي"}[kind],pl=$("#r-period").selectedOptions[0].textContent;
  const scope=instId?INST_BY[instId].name:"كل المؤسسات";
  return{title:`${name} – ${pl} – ${scope}`,body,summary:{...lastReportSummary},filename:`تقرير-${name}-${v}${instId?"-"+INST_BY[instId].name:""}`};
}
function standalone(title,body,opts={}){
  const css=[...document.styleSheets].flatMap(s=>{try{return[...s.cssRules].map(r=>r.cssText).filter(t=>/^\.(r-|paper)/.test(t))}catch(e){return[]}}).join("\n");
  const mark=opts.code?`كود الاعتماد: ${opts.code}`:opts.draft?"مسودة غير معتمدة":"";
  const box=`font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif;font-size:7.5pt;color:#5A6F6B`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'"><title>${esc(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap">
<style>:root{--f-display:"Cairo","IBM Plex Sans Arabic",Tahoma,sans-serif;--f-body:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif;--line:#D6E2DF}
body{margin:0;background:#EEF3F2;font-family:var(--f-body);color:#15302C;line-height:1.6}*{box-sizing:border-box}
${css}
.paper{margin:24px auto;box-shadow:0 4px 20px rgba(0,0,0,.08)}${opts.landscape?".paper{max-width:1180px}":""}
@page{size:A4${opts.landscape?" landscape":""};margin:14mm 12mm 16mm;
  @bottom-right{content:"قاعدة بيانات مشروع مراكز تنمية الأسرة والطفل";${box}}
  @bottom-center{content:"${mark}";${box};color:${opts.code?"#0B4F4A":"#B4483A"};font-weight:600}
  @bottom-left{content:"صفحة " counter(page) " من " counter(pages);${box}}}
${opts.draft?`body::before{content:"مسودة غير معتمدة";position:fixed;top:42%;left:0;right:0;text-align:center;transform:rotate(-28deg);font:800 64px Cairo,sans-serif;color:rgba(180,72,58,.10);z-index:9;pointer-events:none}`:""}@media print{body{background:#fff}.paper{margin:0;border:0;box-shadow:none;max-width:none;padding:0}.r-sec{break-inside:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head>
<body><div class="paper">${body}</div></body></html>`;
}

/* ================= USERS (admin) ================= */
let users=[];
async function loadUsers(){try{users=(await api("/api/users")).users;renderUsers()}catch(x){$("#u-list").innerHTML=`<div class="empty">${esc(x.message)}</div>`}}
function renderUsers(){
  $("#u-list").innerHTML=users.length?users.map(u=>`<div class="urow${u.active?"":" off"}"><div style="min-width:0"><div class="t">${esc(u.name)}</div>
    <div class="meta"><span dir="ltr">${esc(u.email)}</span><span class="tag${u.role==="admin"?" o":""}">${u.role==="admin"?"إدارة المشروع":esc(INST_BY[u.institution_id]?.name||u.institution_id)}</span>${u.active?"":"<span>موقوف</span>"}</div></div>
    <div style="display:flex;gap:6px"><button class="link" data-uedit="${u.id}">تعديل</button>${u.id===me.id?"":`<button class="link" data-utoggle="${u.id}">${u.active?"إيقاف":"تفعيل"}</button>`}</div></div>`).join("")
    :'<div class="empty">لا توجد حسابات.</div>';
}
function userForm(u){
  $("#u-id").value=u?u.id:"";$("#u-name").value=u?u.name:"";$("#u-email").value=u?u.email:"";$("#u-role").value=u?u.role:"institution";
  if(u&&u.institution_id)$("#u-inst").value=u.institution_id;$("#u-pass").value="";$("#u-err").textContent="";
  $("#u-form-h").textContent=u?"تعديل حساب":"إضافة حساب";$("#u-save").textContent=u?"حفظ التعديل":"إضافة الحساب";
  $("#u-pass-hint").textContent=u?"(اتركها فارغة لعدم التغيير)":"(٨ أحرف على الأقل)";$("#u-cancel").hidden=!u;
  $("#u-inst-wrap").hidden=$("#u-role").value==="admin";
}
$("#u-role").addEventListener("change",()=>$("#u-inst-wrap").hidden=$("#u-role").value==="admin");
$("#u-cancel").onclick=()=>userForm(null);
$("#u-list").addEventListener("click",async e=>{
  const ed=e.target.closest("[data-uedit]");if(ed){userForm(users.find(u=>u.id==ed.dataset.uedit));$("#u-name").focus();return}
  const tg=e.target.closest("[data-utoggle]");if(!tg)return;const u=users.find(x=>x.id==tg.dataset.utoggle);
  try{await api("/api/users/"+u.id,{method:"PATCH",body:{active:!u.active}});toast(u.active?"تم إيقاف الحساب":"تم تفعيل الحساب");loadUsers()}catch(x){toast(x.message)}
});
$("#u-form").addEventListener("submit",async e=>{
  e.preventDefault();const id=$("#u-id").value;
  const body={name:$("#u-name").value,email:$("#u-email").value,role:$("#u-role").value,institution_id:$("#u-inst").value};
  if($("#u-pass").value||!id)body.password=$("#u-pass").value;
  try{await api(id?"/api/users/"+id:"/api/users",{method:id?"PATCH":"POST",body});toast(id?"تم حفظ التعديل":"تمت إضافة الحساب");userForm(null);loadUsers()}
  catch(x){$("#u-err").textContent=x.message}
});

/* ================= ACCOUNT ================= */
$("#logout").onclick=async()=>{try{await api("/api/auth/logout",{method:"POST"})}catch(e){}location.href="/"};
$("#pw-btn").onclick=()=>{$("#pw-cur").value=$("#pw-new").value="";$("#pw-err").textContent="";$("#pw-dlg").showModal()};
$("#pw-x").onclick=()=>$("#pw-dlg").close();
$("#pw-form").addEventListener("submit",async e=>{
  e.preventDefault();
  try{await api("/api/auth/password",{method:"POST",body:{current:$("#pw-cur").value,next:$("#pw-new").value}});$("#pw-dlg").close();toast("تم تغيير كلمة المرور")}
  catch(x){$("#pw-err").textContent=x.message}
});

/* ================= TABS & BOOT ================= */
const VIEWS=["dash","tasks","reports","media","users","plan","log"];
function show(v){
  document.querySelectorAll(".tab").forEach(t=>t.setAttribute("aria-selected",t.dataset.view===v?"true":"false"));
  VIEWS.forEach(x=>$("#view-"+x).hidden=x!==v);
  if(v==="dash")renderDash();if(v==="reports")renderReport();if(v==="media")renderMedia();if(v==="users")loadUsers();if(v==="plan")renderPlanView();if(v==="tasks")loadTasks();
}
let navigated=false; // the user picked a view before loading finished → keep it
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{navigated=true;show(t.dataset.view)});

async function loadActs(){
  try{
    const [a,p]=await Promise.all([api("/api/activities"),api("/api/plans")]);
    acts=a.activities;planSums=p.plans;db=true;$("#conn").hidden=true;
  }catch(x){if(x.status===401)return;const c=$("#conn");c.hidden=false;c.className="notice bad";c.textContent="تعذر تحميل البيانات من الخادم. تحقق من الاتصال ثم أعد تحميل الصفحة.";}
  mediaCache={};renderMine();checkAll();renderDash();renderReport();renderMedia();renderPlanOverview();
}

(async()=>{
  try{me=(await api("/api/auth/me")).user}catch(e){return}
  isAdmin=me.role==="admin";
  $("#who").textContent=me.name+(isAdmin?" · إدارة المشروع":"");
  applyMeta(await api("/api/meta"));
  fillSelects();restoreChoice();resetRows();renderSteps();initPlan();
  if(isAdmin)document.querySelectorAll(".tab").forEach(t=>t.hidden=false);
  else{const i=INST_BY[me.institution_id];$("#r-inst").innerHTML=`<option value="${i.id}">${esc(i.name)}</option>`;$("#r-inst").disabled=true}
  registerDocBar("r-bar",{key:()=>({kind:$("#r-kind").value,period:$("#r-period").value,inst:$("#r-inst").value||null}),build:reportDoc});
  registerDocBar("m-bar",{key:()=>({kind:"media",period:$("#m-period").value,inst:$("#m-inst").value||null,noIssue:!!$("#m-gov").value}),build:mediaDoc});
  await loadActs();
  await Promise.all([loadReports(),pollNotifications()]);
  if(!navigated)show(isAdmin&&!(notifState.counts.pending>0)?"dash":"tasks");
  window.appReady=true;
  embedLogos();
  setInterval(()=>{if(document.visibilityState==="visible")pollNotifications()},30000);
  window.addEventListener("focus",()=>pollNotifications());
  // refresh every 2 minutes while the tab is visible (replaces the prototype's live listener)
  setInterval(()=>{if(document.visibilityState==="visible"&&!saving)loadActs()},120000);
})();
