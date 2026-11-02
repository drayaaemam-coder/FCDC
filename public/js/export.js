/* ================= EXPORT: PDF / Word / HTML بهوية الموقع وكود الاعتماد =================
   Uses globals from app.js ($, esc, fmt, api, toast, saveFile, standalone, longDate, me, isAdmin). */

let reportsList=[];
async function loadReports(){try{reportsList=(await api("/api/reports")).reports}catch(e){}renderReportBars();renderReportList()}

function saveBlob(filename,blob){
  const u=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=u;a.download=filename;a.hidden=true;document.body.appendChild(a);a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(u)},30000);
}

// ختم الاعتماد: كود + رمز QR + اسم المعتمد والتاريخ + رابط التحقق
function stampHTML(ap){
  if(!ap||!ap.code)return"";
  return `<div class="r-sec r-stamp"><div class="r-stamp-q"><img src="${ap.qr}" alt="رمز التحقق"></div><div class="r-stamp-t">
    <b>اعتماد إدارة المشروع</b>
    <span>كود الاعتماد: <bdi dir="ltr" class="r-code">${esc(ap.code)}</bdi></span>
    <span>اعتمده: ${esc(ap.approver||"إدارة المشروع")}${ap.at?" · "+longDate(String(ap.at).slice(0,10)):""}</span>
    <span class="r-stamp-v">للتحقق من صحة المستند امسح الرمز أو افتح: <bdi dir="ltr">${esc(ap.verifyUrl)}</bdi></span></div></div>`;
}

/* doc = {title, body, filename, landscape, approval:{code,qr,verifyUrl,approver,at}|null, draft:boolean} */
async function exportDoc(fmt,doc,btn){
  const old=btn?.textContent;if(btn){btn.disabled=true;btn.textContent="جارٍ التجهيز…"}
  try{
    const body=doc.body+stampHTML(doc.approval);
    const opts={landscape:doc.landscape,code:doc.approval?.code,draft:!doc.approval};
    const name=doc.filename+(doc.approval?"":"-مسودة");
    if(fmt==="html"){await saveFile(name+".html",standalone(doc.title,body,opts));return}
    if(fmt==="pdf"){
      const r=await fetch("/api/exports/pdf",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-Requested-With":"fetch"},
        body:JSON.stringify({html:standalone(doc.title,body,{...opts,forPdf:true}),filename:name+".pdf"})});
      if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||"تعذر إنشاء ملف PDF")}
      saveBlob(name+".pdf",await r.blob());return;
    }
    if(fmt==="docx"){saveBlob(name+".docx",await buildDocx(body,doc));return}
  }catch(x){toast(x.message||"تعذر التنزيل")}
  finally{if(btn){btn.disabled=false;btn.textContent=old}}
}
const dlButtons=(attr)=>`<span class="dl-group"><span class="hint">تنزيل:</span><button type="button" class="btn ghost sm" ${attr} data-fmt="pdf">PDF</button><button type="button" class="btn ghost sm" ${attr} data-fmt="docx">Word</button><button type="button" class="btn ghost sm" ${attr} data-fmt="html">HTML</button></span>`;

/* ---------- Word (.docx) built in the browser from the report HTML ---------- */
let docxLib=null;
function loadDocx(){
  if(docxLib)return docxLib;
  docxLib=new Promise((res,rej)=>{const s=document.createElement("script");s.src="/vendor/docx.iife.js";s.onload=()=>res(window.docx);s.onerror=()=>{docxLib=null;rej(new Error("تعذر تحميل مكتبة Word"))};document.head.appendChild(s)});
  return docxLib;
}
function dataUrlBytes(u){const b=atob(u.split(",")[1]);const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a}
function imgSize(u){return new Promise(r=>{const i=new Image();i.onload=()=>r([i.naturalWidth,i.naturalHeight]);i.onerror=()=>r([1,1]);i.src=u})}

async function buildDocx(bodyHtml,doc){
  const D=await loadDocx();
  const root=new DOMParser().parseFromString(`<div id="root">${bodyHtml}</div>`,"text/html").getElementById("root");
  const FONT={ascii:"Arial",hAnsi:"Arial",cs:"Arial",eastAsia:"Arial"};
  const TEAL="0B4F4A",BRAND="0E7C6E",MUTED="5A6F6B",LINE="D6E2DF";
  const run=(text,o={})=>new D.TextRun({text,font:FONT,rightToLeft:true,size:o.size||20,sizeComplexScript:o.size||20,bold:!!o.bold,boldComplexScript:!!o.bold,color:o.color||"15302C"});
  const P=(children,o={})=>new D.Paragraph({bidirectional:true,alignment:o.align,spacing:{before:o.before??0,after:o.after??100},children,border:o.border,keepNext:o.keepNext});
  const clean=t=>String(t||"").replace(/\s+/g," ").trim();
  const img=async(u,w)=>{if(!u||!u.startsWith("data:image/"))return null;const[nw,nh]=await imgSize(u);const h=Math.round(w*nh/Math.max(1,nw));
    return new D.ImageRun({type:/png/.test(u.slice(0,30))?"png":"jpg",data:dataUrlBytes(u),transformation:{width:w,height:h}})};
  const inline=(el,o={})=>{const out=[];el.childNodes.forEach(n=>{
    if(n.nodeType===3){const t=n.textContent.replace(/\s+/g," ");if(t.trim()||t===" ")out.push(run(t,o))}
    else if(n.nodeType===1){const tag=n.tagName;if(tag==="BR")out.push(new D.TextRun({break:1}));else if(tag==="IMG")return;
      else out.push(...inline(n,{...o,bold:o.bold||tag==="B"||tag==="STRONG"}))}});return out};
  const border={style:D.BorderStyle.SINGLE,size:4,color:LINE};
  const cell=(children,o={})=>new D.TableCell({children:children.length?children:[P([run("")])],columnSpan:o.span,
    shading:o.fill?{fill:o.fill,type:D.ShadingType.CLEAR,color:"auto"}:undefined,margins:{top:70,bottom:70,left:110,right:110},verticalAlign:D.VerticalAlign.CENTER,width:o.width});
  const table=(rows,o={})=>new D.Table({visuallyRightToLeft:true,width:{size:100,type:D.WidthType.PERCENTAGE},rows,
    borders:o.noBorders?D.TableBorders?.NONE||undefined:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border}});
  const row=(cells,o={})=>new D.TableRow({children:cells,tableHeader:o.header,cantSplit:true});

  async function convertTable(t){
    const rows=[];
    for(const tr of t.querySelectorAll("tr")){
      const head=tr.parentElement.tagName==="THEAD",foot=tr.parentElement.tagName==="TFOOT";
      rows.push(row([...tr.children].map(c=>cell([P(inline(c,{bold:head||foot,size:18,color:head?"FFFFFF":undefined}),{after:0})],
        {span:c.colSpan>1?c.colSpan:undefined,fill:head?TEAL:foot?"DDF0EC":undefined})),{header:head}));
    }
    return table(rows);
  }
  async function convertSection(sec,out){
    for(const el of sec.children){
      const c=el.classList;
      if(el.tagName==="H2"){const num=el.querySelector("span")?.textContent||"";const txt=clean(el.textContent.slice(num.length));
        out.push(P([...(num?[run(num+"  ",{bold:true,size:26,color:"EE8F2F"})]:[]),run(txt,{bold:true,size:28,color:TEAL})],{before:280,after:120,keepNext:true}))}
      else if(el.tagName==="H3")out.push(P([run(clean(el.textContent),{bold:true,size:22,color:TEAL})],{before:120,keepNext:true}));
      else if(el.tagName==="P")out.push(P(inline(el)));
      else if(c.contains("r-kpis")){const cells=[...el.children].map(d=>cell([P([run(clean(d.querySelector("b")?.textContent),{bold:true,size:30,color:TEAL})],{after:0}),P([run(clean(d.querySelector("small")?.textContent),{size:17,color:MUTED})],{after:0})]));
        const rows=[];for(let i=0;i<cells.length;i+=3)rows.push(row(cells.slice(i,i+3).concat(Array(Math.max(0,3-cells.slice(i,i+3).length)).fill(0).map(()=>cell([])))));out.push(table(rows))}
      else if(c.contains("r-tw")||el.tagName==="TABLE"){const t=el.tagName==="TABLE"?el:el.querySelector("table");if(t)out.push(await convertTable(t))}
      else if(c.contains("r-bars")){const rows=[...el.querySelectorAll(".rb")].map(rb=>{const s=rb.children;return row([cell([P([run(clean(s[0].textContent))],{after:0})]),cell([P([run(clean(s[2].textContent),{bold:true})],{after:0})],{width:{size:15,type:D.WidthType.PERCENTAGE}})])});
        if(rows.length)out.push(table(rows))}
      else if(c.contains("r-cols")){const labels=[...(el.nextElementSibling?.querySelectorAll("span")||[])].map(s=>clean(s.textContent));const vals=[...el.children].map(d=>clean(d.querySelector("b")?.textContent)||"٠");
        out.push(table([row(labels.map(l=>cell([P([run(l,{bold:true,size:17,color:"FFFFFF"})],{after:0})],{fill:TEAL})),{header:true}),row(vals.map(v=>cell([P([run(v,{bold:true})],{after:0})])))]))}
      else if(c.contains("r-axis"))continue;
      else if(c.contains("r-flag")){for(const d of el.children){out.push(P([run(clean(d.querySelector("h3")?.textContent),{bold:true,color:"B4483A"})],{before:120}));
        const lis=[...d.querySelectorAll("li")];if(lis.length)lis.forEach(li=>out.push(P([run("•  "+clean(li.textContent),{size:19})],{after:40})));else out.push(P([run(clean(d.querySelector("p")?.textContent||""),{size:19})]))}}
      else if(c.contains("r-hl")){const figs=[...el.querySelectorAll("figure")],cells=[];
        for(const f of figs){const im=await img(f.querySelector("img")?.getAttribute("src"),250);const cap=f.querySelector("figcaption");
          cells.push(cell([...(im?[P([im],{after:60,align:D.AlignmentType.CENTER})]:[]),...(cap?[P(inline(cap,{size:17}),{after:0})]:[])]))}
        const rows=[];for(let i=0;i<cells.length;i+=2)rows.push(row(cells.length-i===1?[cells[i],cell([])]:[cells[i],cells[i+1]]));if(rows.length)out.push(table(rows))}
      else if(c.contains("r-stamp")){const q=await img(el.querySelector("img")?.getAttribute("src"),105);
        const lines=[...el.querySelectorAll(".r-stamp-t > *")].map((s,i)=>P([run(clean(s.textContent),{bold:i===0,size:i===0?24:19,color:i===0?TEAL:undefined})],{after:40}));
        out.push(table([row([cell(lines),cell(q?[P([q],{after:0,align:D.AlignmentType.CENTER})]:[],{width:{size:22,type:D.WidthType.PERCENTAGE}})])]))}
      else if(c.contains("r-sign")){out.push(table([row([...el.children].map(d=>cell([...d.children].map((s,i)=>P([run(clean(s.textContent),{bold:i===0})],{after:i===0?160:220})))))]))}
      else{const t=clean(el.textContent);if(t)out.push(P([run(t)]))}
    }
  }

  const children=[],logos=[];
  for(const el of root.children){
    const c=el.classList;
    if(c.contains("r-band")){for(const im of el.querySelectorAll("img")){const r=await img(im.getAttribute("src"),im.classList.contains("wide")?78:46);if(r){logos.push(r);logos.push(new D.TextRun("      "))}}}
    else if(c.contains("r-cover")){
      const e=el.querySelector(".r-eyebrow"),h=el.querySelector("h1"),s=el.querySelector(".r-sub"),m=el.querySelector(".r-meta");
      if(e)children.push(P([run("●  ",{color:"EE8F2F",size:16}),run(clean(e.textContent),{bold:true,color:BRAND,size:20})],{before:200}));
      if(h)children.push(P([run(clean(h.textContent),{bold:true,size:38,color:TEAL})],{after:80}));
      if(s)children.push(P([run(clean(s.textContent),{size:22,color:"3E5A55"})]));
      if(m)children.push(P([run([...m.children].map(x=>clean(x.textContent)).join("   ·   "),{size:17,color:MUTED})],{after:200,border:{bottom:{style:D.BorderStyle.SINGLE,size:6,color:LINE,space:8}}}));
    }
    else if(c.contains("r-stamp")||c.contains("r-sign")){children.push(P([run("")],{after:120}));await convertSection({children:[el]},children)}
    else if(c.contains("r-sec"))await convertSection(el,children);
    else if(c.contains("r-note"))children.push(P([run(clean(el.textContent),{size:16,color:MUTED})],{before:300,border:{top:{style:D.BorderStyle.SINGLE,size:4,color:LINE,space:6}}}));
    else{const t=clean(el.textContent);if(t)children.push(P([run(t)]))}
  }
  const code=doc.approval?.code;
  const header=new D.Header({children:[
    ...(logos.length?[new D.Paragraph({alignment:D.AlignmentType.CENTER,children:logos,border:{bottom:{style:D.BorderStyle.SINGLE,size:12,color:BRAND,space:6}}})]:[]),
    ...(!code?[P([run("مسودة غير معتمدة — لا يُعتد بها قبل اعتماد إدارة المشروع",{bold:true,color:"B4483A",size:18})],{align:D.AlignmentType.CENTER,after:0})]:[]),
  ]});
  const footer=new D.Footer({children:[new D.Paragraph({bidirectional:true,alignment:D.AlignmentType.CENTER,border:{top:{style:D.BorderStyle.SINGLE,size:4,color:LINE,space:4}},children:[
    run("قاعدة بيانات مشروع مراكز تنمية الأسرة والطفل   ·   ",{size:15,color:MUTED}),
    run(code?`كود الاعتماد: ${code}   ·   `:"مسودة غير معتمدة   ·   ",{size:15,color:code?TEAL:"B4483A",bold:true}),
    new D.TextRun({children:["صفحة ",D.PageNumber.CURRENT," من ",D.PageNumber.TOTAL_PAGES],font:FONT,rightToLeft:true,size:15,sizeComplexScript:15,color:MUTED})]})]});
  const document_=new D.Document({creator:"قاعدة بيانات مشروع مراكز تنمية الأسرة والطفل",title:doc.title,
    styles:{default:{document:{run:{font:FONT,size:20,sizeComplexScript:20,rightToLeft:true},paragraph:{bidirectional:true}}}},
    sections:[{properties:{page:{size:{orientation:doc.landscape?D.PageOrientation.LANDSCAPE:D.PageOrientation.PORTRAIT},margin:{top:1300,bottom:1100,left:900,right:900,header:400,footer:400}}},
      headers:{default:header},footers:{default:footer},children}]});
  return D.Packer.toBlob(document_);
}

/* ---------- شريط المستند: حالة الاعتماد + الإصدار/طلب الاعتماد + التنزيل ---------- */
const REPORT_STATUS={submitted:["بانتظار اعتماد إدارة المشروع","sub"],approved:["معتمد","ok"],returned:["معاد للتعديل","no"]};
const findReport=(kind,period,inst)=>{const l=reportsList.filter(r=>r.kind===kind&&r.period===period&&(r.inst||"")===(inst||""));
  return l.find(r=>r.status!=="returned")||l[0]||null};

// configs registered by the reports and media views
const DOC_BARS={};
function registerDocBar(id,cfg){DOC_BARS[id]=cfg;renderDocBar(id)}
function renderReportBars(){Object.keys(DOC_BARS).forEach(renderDocBar)}
function renderDocBar(id){
  const cfg=DOC_BARS[id],el=document.getElementById(id);if(!cfg||!el)return;
  const k=cfg.key();if(!k){el.innerHTML="";return}
  const r=k.noIssue?null:findReport(k.kind,k.period,k.inst),st=r&&REPORT_STATUS[r.status];
  const canIssue=isAdmin&&!k.noIssue,canRequest=!isAdmin&&k.kind!=="media";
  let left="",right="";
  if(!r||r.status==="returned"){
    left=r?`<span class="pill no">معاد للتعديل</span><span class="note-inline">ملاحظات الإدارة: ${esc(r.note)}</span>`:`<span class="pill low">غير معتمد بعد</span><span class="hint">التنزيل الآن يكون نسخة مسودة بعلامة «غير معتمد».</span>`;
    if(canIssue&&!r)right=`<button type="button" class="btn" data-doc-issue="${id}">اعتماد وإصدار بكود</button>`;
    if(canRequest)right=`<button type="button" class="btn" data-doc-request="${id}">${r?"تحديث وإعادة الإرسال للاعتماد":"طلب اعتماد التقرير"}</button>`;
  }else if(r.status==="submitted"){
    left=`<span class="pill sub">${st[0]}</span><span class="hint">أُرسل ${longDate(String(r.updatedAt).slice(0,10))}${r.byName?" بواسطة "+esc(r.byName):""}</span>`;
    if(isAdmin)right=`<button type="button" class="btn" data-goto-task="report:${r.id}">مراجعة واعتماد</button>`;
  }else{
    left=`<span class="pill ok">معتمد</span><span>كود الاعتماد <bdi dir="ltr" class="code">${esc(r.code)}</bdi></span><span class="hint">${r.reviewerName?"اعتمده "+esc(r.reviewerName)+" · ":""}${longDate(String(r.reviewedAt).slice(0,10))}</span>`;
  }
  el.innerHTML=`<div class="db-l">${left}</div><div class="db-r">${right}${dlButtons(`data-doc-dl="${id}"`)}</div>`;
}

// official files are rebuilt from the frozen copy stored on the server
async function officialDoc(r){
  const full=(await api(`/api/reports/${r.id}`)).report;
  return{title:full.title,body:full.body,landscape:false,filename:full.title.replace(/[\\/:*?"<>|]+/g,"-"),
    approval:{...full.approval,approver:full.reviewerName,at:full.reviewedAt}};
}
document.addEventListener("click",async e=>{
  const dl=e.target.closest("[data-doc-dl]");
  if(dl){const cfg=DOC_BARS[dl.dataset.docDl],k=cfg.key();
    const r=k.noIssue?null:findReport(k.kind,k.period,k.inst);
    if(r&&r.status==="approved"){try{await exportDoc(dl.dataset.fmt,await officialDoc(r),dl)}catch(x){toast(x.message)}return}
    const d=await cfg.build();if(!d)return;await exportDoc(dl.dataset.fmt,{...d,approval:null},dl);return}
  const is=e.target.closest("[data-doc-issue],[data-doc-request]");
  if(is){const id=is.dataset.docIssue||is.dataset.docRequest,cfg=DOC_BARS[id],k=cfg.key();
    const old=is.textContent;is.disabled=true;is.textContent="جارٍ التجهيز…";
    try{const d=await cfg.build();if(!d)return;
      const existing=findReport(k.kind,k.period,k.inst);
      const payload={kind:k.kind,period:k.period,inst:k.inst||null,title:d.title,body:d.body,summary:d.summary||{}};
      if(existing&&existing.status==="returned")await api(`/api/reports/${existing.id}`,{method:"PUT",body:payload});
      else await api("/api/reports",{method:"POST",body:payload});
      toast(isAdmin?"تم اعتماد التقرير وإصداره بكود":"أُرسل التقرير لإدارة المشروع للاعتماد");await loadReports();
    }catch(x){toast(x.message)}finally{is.disabled=false;is.textContent=old}
  }
});

/* ---------- سجل التقارير ---------- */
const KIND_NAMES={m:"شهري",q:"ربع سنوي",y:"سنوي",media:"توثيق إعلامي"};
function renderReportList(){
  const el=$("#r-list");if(!el)return;
  if(!reportsList.length){el.innerHTML='<div class="empty">لم يصدر أي تقرير بعد. اختر التقرير بالأعلى ثم «اعتماد وإصدار» أو «طلب اعتماد».</div>';return}
  el.innerHTML=`<div class="tbl-wrap"><table><thead><tr><th>التقرير</th><th>النوع</th><th>النطاق</th><th>الحالة</th><th>كود الاعتماد</th><th>آخر تحديث</th><th></th></tr></thead><tbody>`+
    reportsList.map(r=>{const st=REPORT_STATUS[r.status];return `<tr data-rrow="${r.id}"><td>${esc(r.title)}</td><td>${KIND_NAMES[r.kind]}</td><td>${r.inst?esc(INST_BY[r.inst]?.name||r.inst):"قومي"}</td>
      <td><span class="pill ${st[1]}">${st[0]}</span></td><td>${r.code?`<bdi dir="ltr" class="code">${esc(r.code)}</bdi>`:"—"}</td><td class="num">${shortDate(String(r.updatedAt).slice(0,10))}</td>
      <td class="acts-cell"><button type="button" class="link" data-rpv="${r.id}">معاينة</button>${r.status==="approved"?`<button type="button" class="link" data-rdl="${r.id}" data-fmt="pdf">PDF</button><button type="button" class="link" data-rdl="${r.id}" data-fmt="docx">Word</button>`:""}<button type="button" class="link" data-tl="report:${r.id}">السجل</button></td></tr>
      <tr class="tl-row" data-tlrow="report:${r.id}" hidden><td colspan="7"></td></tr>`}).join("")+`</tbody></table></div>`;
}
document.addEventListener("click",async e=>{
  const pv=e.target.closest("[data-rpv]");
  if(pv){try{const r=(await api(`/api/reports/${pv.dataset.rpv}`)).report;
    openPreview(r.title,standalone(r.title,r.body+stampHTML(r.approval?{...r.approval,approver:r.reviewerName,at:r.reviewedAt}:null),{code:r.code,draft:!r.code}))}catch(x){toast(x.message)}return}
  const d=e.target.closest("[data-rdl]");
  if(d){const r=reportsList.find(x=>x.id==d.dataset.rdl);try{await exportDoc(d.dataset.fmt,await officialDoc(r),d)}catch(x){toast(x.message)}}
});
function openPreview(title,html){$("#pv-title").textContent=title;$("#pv-frame").srcdoc=html;$("#pv-dlg").showModal()}
$("#pv-x").onclick=()=>$("#pv-dlg").close();
