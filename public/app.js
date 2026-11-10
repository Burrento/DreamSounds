const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = { token: localStorage.getItem("ds_token") || "", user: JSON.parse(localStorage.getItem("ds_user") || "null"), equipment: [], portfolio: [] };
const api = async (url, options={}) => {
  const headers = {...(options.headers||{})};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && !(options.body instanceof FormData)) headers["Content-Type"]="application/json";
  const res=await fetch(url,{...options,headers});
  const data=await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error||"Request failed.");
  return data;
};
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const peso = n => "₱"+Number(n).toLocaleString("en-PH",{minimumFractionDigits:2});
function setAuth(token,user){state.token=token;state.user=user;localStorage.setItem("ds_token",token);localStorage.setItem("ds_user",JSON.stringify(user));syncAuthUI();}
function clearAuth(){state.token="";state.user=null;localStorage.removeItem("ds_token");localStorage.removeItem("ds_user");syncAuthUI();}
function syncAuthUI(){$("#loginOpen").textContent=state.user?"Dashboard":"Admin Login";}
function modal(id,open=true){const el=$("#"+id);el.classList.toggle("open",open);el.setAttribute("aria-hidden",String(!open));}
function message(el,text,ok=false){el.textContent=text;el.style.color=ok?"#8fe0a0":"#ff626c";}
$("#year").textContent=new Date().getFullYear();
$("#menuToggle").addEventListener("click",()=>document.body.classList.toggle("menu-open"));
$$("nav a").forEach(a=>a.addEventListener("click",()=>document.body.classList.remove("menu-open")));
$$("[data-close]").forEach(b=>b.addEventListener("click",()=>b.closest(".modal").classList.remove("open")));
$$(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)modal(m.id,false)}));

async function loadEquipment(){
  try{
    state.equipment=await api("/api/equipment");
    $("#equipmentList").innerHTML=state.equipment.map((e,i)=>`<div class="equipment-row"><span class="num">${String(i+1).padStart(2,"0")}</span><div><h3>${esc(e.name)}</h3><p>${esc(e.description)}</p></div><span class="category">${esc(e.category).toUpperCase()}</span><button type="button" data-select-equipment="${e.id}">ADD TO INQUIRY +</button></div>`).join("") || '<p class="muted">No equipment has been listed yet.</p>';
    $("#serviceChecks").innerHTML=state.equipment.map(e=>`<label><input type="checkbox" value="${e.id}" data-name="${esc(e.name)}"> ${esc(e.name)}</label>`).join("");
    $$("[data-select-equipment]").forEach(b=>b.addEventListener("click",()=>{const cb=$(`#serviceChecks input[value="${b.dataset.selectEquipment}"]`);if(cb)cb.checked=true;location.hash="#quote";}));
  }catch(e){$("#equipmentList").innerHTML=`<p class="muted">${esc(e.message)}</p>`;}
}
async function loadPortfolio(){
  try{
    state.portfolio=await api("/api/portfolio"); renderPortfolio("All");
    $("#filters").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ $$(".filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");renderPortfolio(b.dataset.filter);}));
  }catch{ $("#portfolioGrid").innerHTML='<div class="empty-state">Portfolio is temporarily unavailable.</div>'; }
}
function renderPortfolio(filter){
  const list=filter==="All"?state.portfolio:state.portfolio.filter(p=>p.category===filter);
  $("#portfolioGrid").innerHTML=list.length?list.map(p=>`<article class="portfolio-card"><img src="${esc(p.image_path)}" alt="${esc(p.title)}" loading="lazy"><div><h3>${esc(p.title)}</h3><small>${esc(p.category)}</small></div></article>`).join(""):'<div class="empty-state">No photos in this category yet.</div>';
}
$("#quoteForm").addEventListener("submit",async e=>{
  e.preventDefault();const form=e.currentTarget, data=Object.fromEntries(new FormData(form).entries());
  data.items=$$("#serviceChecks input:checked").map(x=>({id:Number(x.value),name:x.dataset.name}));
  $("#quoteMessage").textContent="Submitting your request…";
  try{const result=await api("/api/bookings",{method:"POST",body:JSON.stringify(data)});message($("#quoteMessage"),`${result.message} Reference: ${result.reference}`,true);form.reset();}
  catch(err){message($("#quoteMessage"),err.message);}
});

$("#loginOpen").addEventListener("click",()=>state.user?openAdmin():modal("authModal"));
$("#authForm").addEventListener("submit",async e=>{
 e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget).entries());
 try{const result=await api("/api/auth/login",{method:"POST",body:JSON.stringify(d)});setAuth(result.token,result.user);e.target.reset();modal("authModal",false);openAdmin();}
 catch(err){message($("#authMessage"),err.message);}
});
$("#adminLogout").addEventListener("click",()=>{clearAuth();modal("adminModal",false);});
async function openAdmin(){
 if(!state.user){modal("authModal");return;}
 modal("adminModal");await refreshAdmin();
}
async function refreshAdmin(){
 try{
  const s=await api("/api/admin/overview");
  $("#adminStats").innerHTML=[["INQUIRIES",s.inquiries],["NEW",s.newInquiries],["EQUIPMENT",s.equipment],["PORTFOLIO",s.portfolio]].map(x=>`<div class="stat"><b>${x[1]}</b><small>${x[0]}</small></div>`).join("");
  await Promise.all([loadAdminBookings(),loadAdminEquipment(),loadAdminPortfolio()]);
 }catch(e){$("#panel-inquiries").innerHTML=`<p class="form-message">${esc(e.message)}</p>`;}
}
$$("[data-panel]").forEach(b=>b.addEventListener("click",()=>{ $$(".admin-tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");$$(".admin-panel").forEach(p=>p.hidden=true);$("#panel-"+b.dataset.panel).hidden=false;}));
async function loadAdminBookings(){
 const rows=await api("/api/admin/bookings");
 $("#panel-inquiries").innerHTML=rows.length?rows.map(b=>`<div class="admin-row"><div><strong>${esc(b.event_name)}</strong><small>DS-${String(b.id).padStart(5,"0")} • ${esc(b.customer_name)} • ${esc(b.email)} • ${esc(b.phone)}</small><small>${esc(b.event_date)} ${esc(b.event_time)} • ${esc(b.venue)} • ${b.guest_count||"Guest count n/a"} guests</small><small>Requested: ${esc((b.items||[]).map(x=>x.name).join(", ")||"Not specified")} ${esc(b.notes)}</small></div><form class="row-actions" data-booking="${b.id}"><select name="status" aria-label="Status">${["New","Reviewing","Quoted","Confirmed","Completed","Cancelled"].map(s=>`<option ${b.status===s?"selected":""}>${s}</option>`).join("")}</select><input name="quoted_amount" type="number" min="0" step=".01" placeholder="Quoted amount (PHP)" aria-label="Quoted amount in pesos" value="${b.quoted_amount??""}"><input name="admin_notes" placeholder="Notes" aria-label="Internal notes" value="${esc(b.admin_notes)}"><button class="outline-btn">SAVE</button></form></div>`).join(""):'<p class="muted">No inquiries have been received yet.</p>';
 const save=async(form,body)=>{try{await api(`/api/admin/bookings/${form.dataset.booking}`,{method:"PATCH",body:JSON.stringify(body)});return true;}catch(e){alert(e.message);return false;}};
 $$("[data-booking]").forEach(form=>{
  form.elements.status.addEventListener("change",()=>save(form,{status:form.elements.status.value}));
  form.addEventListener("submit",async e=>{e.preventDefault();const btn=form.querySelector("button");if(await save(form,Object.fromEntries(new FormData(form).entries()))){btn.textContent="SAVED ✓";setTimeout(()=>btn.textContent="SAVE",1500);}});
 });
}
async function loadAdminEquipment(){
 const rows=await api("/api/admin/equipment");
 $("#panel-inventory").innerHTML=`<h3>ADD EQUIPMENT / SERVICE</h3><form id="equipmentForm" class="admin-form"><label>NAME<input name="name" required></label><label>CATEGORY<input name="category" required placeholder="Audio, Lighting, LED Walls…"></label><label>QUANTITY<input name="quantity" type="number" min="0" value="1"></label><label>DAILY RATE (PHP)<input name="daily_rate" type="number" min="0" step=".01" value="0"></label><label style="grid-column:1/-1">DESCRIPTION<input name="description"></label><button class="button red">ADD TO CATALOGUE</button></form>`+
 rows.map(r=>`<div class="admin-row"><div><strong>${esc(r.name)}</strong><small>${esc(r.category)} • Quantity: ${r.quantity} • ${peso(r.daily_rate)}/day • ${r.active?"Active":"Hidden"}</small></div><div><button class="outline-btn" data-edit-equipment="${r.id}">EDIT</button> ${r.active?`<button class="outline-btn" data-hide-equipment="${r.id}">HIDE</button>`:`<button class="outline-btn" data-show-equipment="${r.id}">SHOW</button>`}</div></div>`).join("");
 const form=$("#equipmentForm"), byId=id=>rows.find(r=>r.id===Number(id));
 const reload=async()=>{await loadAdminEquipment();await loadEquipment();await refreshAdminStatsOnly();};
 // The add form doubles as the edit form: `editing` holds the row being changed.
 let editing=null;
 form.addEventListener("submit",async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(form).entries());try{
  if(editing)await api(`/api/admin/equipment/${editing.id}`,{method:"PATCH",body:JSON.stringify({...d,active:editing.active})});
  else await api("/api/admin/equipment",{method:"POST",body:JSON.stringify(d)});
  await reload();}catch(err){alert(err.message);}});
 $$("[data-edit-equipment]").forEach(b=>b.addEventListener("click",()=>{editing=byId(b.dataset.editEquipment);for(const k of ["name","category","quantity","daily_rate","description"])form.elements[k].value=editing[k]??"";$("#panel-inventory h3").textContent=`EDIT: ${editing.name}`;form.querySelector("button").textContent="SAVE CHANGES";form.scrollIntoView({block:"center"});form.elements.name.focus();}));
 $$("[data-show-equipment]").forEach(b=>b.addEventListener("click",async()=>{try{await api(`/api/admin/equipment/${b.dataset.showEquipment}`,{method:"PATCH",body:JSON.stringify({...byId(b.dataset.showEquipment),active:true})});await reload();}catch(err){alert(err.message);}}));
 $$("[data-hide-equipment]").forEach(b=>b.addEventListener("click",async()=>{if(confirm("Hide this item from the public catalogue?")){await api(`/api/admin/equipment/${b.dataset.hideEquipment}`,{method:"DELETE"});await reload();}}));
}
async function loadAdminPortfolio(){
 const rows=await api("/api/portfolio");
 $("#panel-uploads").innerHTML=`<h3>UPLOAD DREAMSOUNDS EVENT PHOTOS</h3><p class="muted">Upload real DreamSounds production photos only. JPG, PNG, WEBP or GIF. Up to 12 images per upload, 8MB each.</p><form id="uploadForm" class="upload-form"><label>EVENT / ALBUM TITLE<input name="title" required placeholder="e.g. LGU Night 2026"></label><label>CATEGORY<select name="category"><option>Concerts & Live Events</option><option>Government Events</option><option>Corporate Events</option><option>Festivals</option><option>Nightlife & DJ Productions</option><option>Behind the Scenes</option><option>Equipment & Setup</option></select></label><label>DESCRIPTION<textarea name="description" rows="2"></textarea></label><label><input type="checkbox" name="featured" value="true"> FEATURE ON HOMEPAGE</label><input type="file" name="images" accept="image/jpeg,image/png,image/webp,image/gif" multiple required><button class="button red">UPLOAD TO PORTFOLIO ↗</button><p class="form-message" id="uploadMessage"></p></form><div class="admin-gallery">${rows.map(p=>`<article><img src="${esc(p.image_path)}" alt=""><small>${esc(p.title)}<br>${esc(p.category)}</small><button class="outline-btn" data-delete-photo="${p.id}">DELETE</button></article>`).join("")}</div>`;
 $("#uploadForm").addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,fd=new FormData(form);try{const r=await api("/api/admin/portfolio",{method:"POST",body:fd});message($("#uploadMessage"),r.message,true);form.reset();await loadAdminPortfolio();await loadPortfolio();await refreshAdminStatsOnly();}catch(err){message($("#uploadMessage"),err.message);}});
 $$("[data-delete-photo]").forEach(b=>b.addEventListener("click",async()=>{if(confirm("Delete this portfolio image?")){await api(`/api/admin/portfolio/${b.dataset.deletePhoto}`,{method:"DELETE"});await loadAdminPortfolio();await loadPortfolio();}}));
}
async function refreshAdminStatsOnly(){const s=await api("/api/admin/overview");$("#adminStats").innerHTML=[["INQUIRIES",s.inquiries],["NEW",s.newInquiries],["EQUIPMENT",s.equipment],["PORTFOLIO",s.portfolio]].map(x=>`<div class="stat"><b>${x[1]}</b><small>${x[0]}</small></div>`).join("");}
async function init(){
 await Promise.all([loadEquipment(),loadPortfolio()]);
 if(state.token){try{const r=await api("/api/auth/me");state.user=r.user;localStorage.setItem("ds_user",JSON.stringify(r.user));}catch{clearAuth();}}
 syncAuthUI();
}
init();
