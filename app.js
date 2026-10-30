import { hosted, client, command, snapshot } from './backend.js';
const PRINT_SERVER = localStorage.getItem('maxwell_print_server') || 'http://localhost:5001';
const KEY = 'maxwell_inventory_v1';
const seed = {
  products: [
    {id:'p1',name:'Samsung 55-inch Crystal UHD TV',brand:'Samsung',sku:'SAM-TV-55-CU8000',category:'Electronics',model:'CU8000',reorderLevel:2,unitValue:0},
    {id:'p2',name:'Singer 300L Double Door Refrigerator',brand:'Singer',sku:'SIN-RF-300-DD',category:'Appliances',model:'SRF-300',reorderLevel:2,unitValue:0},
    {id:'p3',name:'Modern 3-Seater Sofa',brand:'Maxwell Home',sku:'MXL-SOF-3S-GRY',category:'Furniture',model:'M3S-GRY',reorderLevel:1,unitValue:0},
    {id:'p4',name:'Panasonic Microwave Oven 25L',brand:'Panasonic',sku:'PAN-MW-25L',category:'Appliances',model:'NN-ST34',reorderLevel:2,unitValue:0}
  ],
  units: [
    {id:'u1',code:'MSM-8F4A7C',productId:'p1',serial:'SAM-CU8-091428',status:'Available',receivedAt:'2026-10-24'},
    {id:'u2',code:'MSM-9K2D5H',productId:'p1',serial:'SAM-CU8-091429',status:'Available',receivedAt:'2026-10-24'},
    {id:'u3',code:'MSM-4Q7X1B',productId:'p2',serial:'SNG-300-00481',status:'Available',receivedAt:'2026-10-22'},
    {id:'u4',code:'MSM-6L9P3R',productId:'p2',serial:'SNG-300-00482',status:'Sold',receivedAt:'2026-10-21',soldAt:'2026-10-27'},
    {id:'u5',code:'MSM-2T8M5V',productId:'p3',serial:'',status:'Available',receivedAt:'2026-10-20'},
    {id:'u6',code:'MSM-7W3N9C',productId:'p3',serial:'',status:'Repair',receivedAt:'2026-10-19'},
    {id:'u7',code:'MSM-3J5R8K',productId:'p4',serial:'PAN-25L-10923',status:'Available',receivedAt:'2026-10-26'},
    {id:'u8',code:'MSM-1C6F4Z',productId:'p4',serial:'PAN-25L-10924',status:'Returned',receivedAt:'2026-10-18',returnedAt:'2026-10-27'}
  ],
  activities: [
    {id:'a1',type:'sale',unitCode:'MSM-6L9P3R',text:'Marked as sold',by:'Kavindi Perera',at:'2026-10-28T09:45:00'},
    {id:'a2',type:'return',unitCode:'MSM-1C6F4Z',text:'Returned to stock',by:'Nimal Abeysekera',at:'2026-10-27T15:22:00'},
    {id:'a3',type:'add',unitCode:'MSM-3J5R8K',text:'Received into stock',by:'Nimal Abeysekera',at:'2026-10-26T11:10:00'},
    {id:'a4',type:'add',unitCode:'MSM-9K2D5H',text:'Received into stock',by:'Nimal Abeysekera',at:'2026-10-24T10:03:00'}
  ],
  users:[{name:'Nimal Abeysekera',initials:'NA',role:'Administrator',email:'nimal@maxwell.lk'},{name:'Kavindi Perera',initials:'KP',role:'Worker',email:'kavindi@maxwell.lk'},{name:'Dilan Fernando',initials:'DF',role:'Manager',email:'dilan@maxwell.lk'}]
};
let db = hosted ? {products:[],units:[],activities:[],users:[]} : JSON.parse(localStorage.getItem(KEY) || 'null') || structuredClone(seed);
let currentUser = hosted ? null : seed.users[0];
let busy = false;
db.products.forEach(p=>{if(typeof p.unitValue!=='number')p.unitValue=0});
let selected = new Set(); let scanner = null;
const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
const save = () => {if(!hosted) localStorage.setItem(KEY, JSON.stringify(db))};
const product = id => db.products.find(p=>p.id===id);
const esc = s => String(s || '').replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const date = d => new Intl.DateTimeFormat('en-LK',{day:'numeric',month:'short',year:'numeric'}).format(new Date(d));
const money = value => new Intl.NumberFormat('en-LK',{style:'currency',currency:'LKR',maximumFractionDigits:0}).format(value||0);
const timeAgo = d => { const h=(Date.now()-new Date(d))/36e5; return h<24?`${Math.max(1,Math.floor(h))}h ago`:h<48?'Yesterday':date(d) };
function code(){return 'MSM-'+crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase().slice(0,7)}
function toast(message){const t=document.createElement('div');t.className='toast';t.textContent=message;document.body.append(t);setTimeout(()=>t.remove(),2700)}
function statusClass(status){return status.toLowerCase()}
function unitProductName(u){return product(u.productId)?.name || 'Unknown product'}
function activityIcon(type){return type==='sale'?'↗':type==='add'?'＋':type==='return'?'↶':'!'}
function activityRow(a){let u=db.units.find(x=>x.code===a.unitCode), name=u?unitProductName(u):'Inventory update';return `<div class="activity-row"><div class="activity-dot ${a.type}">${activityIcon(a.type)}</div><div><strong>${esc(a.text)} <span class="code">${esc(a.unitCode||'')}</span></strong><span>${esc(name)} · ${esc(a.by)}</span></div><time>${timeAgo(a.at)}</time></div>`}
function addActivity(type,unit,text){db.activities.unshift({id:crypto.randomUUID(),type,unitCode:unit.code,text,by:'Nimal Abeysekera',at:new Date().toISOString()});save()}
function sameMonth(value){const d=new Date(value||0),now=new Date();return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()}
function renderDashboard(){const available=db.units.filter(u=>u.status==='Available');$('#stat-available').textContent=available.length;$('#stat-stock-value').textContent=money(available.reduce((sum,u)=>sum+Number(product(u.productId)?.unitValue||0),0));$('#stat-sold').textContent=db.units.filter(u=>u.status==='Sold'&&sameMonth(u.soldAt)).length;$('#stat-returned').textContent=db.units.filter(u=>sameMonth(u.returnedAt)).length;$('#stat-attention').textContent=db.units.filter(u=>['Repair','Damaged'].includes(u.status)).length;
 const rows=db.products.map(p=>{const count=available.filter(u=>u.productId===p.id).length;return {p,count}}).sort((a,b)=>b.count-a.count);
 $('#stock-summary').innerHTML=rows.length?rows.slice(0,5).map(({p,count})=>`<div class="summary-row"><div class="product-mark">${esc(p.name[0])}</div><div><strong>${esc(p.name)}</strong><span>${count} unit${count===1?'':'s'} · ${Number(p.unitValue)?money(count*p.unitValue):'Value not set'}</span></div><div class="qty">${Number(p.unitValue)?money(count*p.unitValue):'—'}</div></div>`).join(''):'<div class="empty">No products yet.</div>';
 $('#recent-activity').innerHTML=db.activities.slice(0,5).map(activityRow).join('')||'<div class="empty">No activity yet.</div>'}
function renderProducts(){let q=$('#product-search').value.toLowerCase();let products=db.products.filter(p=>`${p.name} ${p.sku} ${p.model}`.toLowerCase().includes(q));$('#product-count').textContent=`${products.length} product${products.length===1?'':'s'}`;$('#product-table').innerHTML=products.map(p=>{let count=db.units.filter(u=>u.productId===p.id&&u.status==='Available').length,value=Number(p.unitValue||0);return `<tr><td><strong>${esc(p.name)}</strong><span>${esc(p.brand||'')}</span></td><td class="code">${esc(p.sku)}</td><td>${esc(p.category)}</td><td><strong>${count}</strong>${count<=p.reorderLevel?'<span style="color:#c87b12">Low stock</span>':''}</td><td>${value?money(value):'<span>Not set</span>'}</td><td><strong>${value?money(count*value):'—'}</strong></td><td><button class="row-btn" data-value-product="${p.id}">${value?'Edit value':'Set value'}</button> <button class="row-btn" data-receive-product="${p.id}">Receive →</button></td></tr>`}).join('')||'<tr><td colspan="7" class="empty">No matching products.</td></tr>'}
function renderUnits(){let q=$('#unit-search').value.toLowerCase(), status=$('#status-filter').value;let units=db.units.filter(u=>!status||u.status===status).filter(u=>`${u.code} ${u.serial} ${unitProductName(u)}`.toLowerCase().includes(q));$('#unit-count').textContent=`${units.length} unit${units.length===1?'':'s'}`;$('#unit-table').innerHTML=units.map(u=>`<tr><td><input type="checkbox" class="unit-check" value="${u.id}" ${selected.has(u.id)?'checked':''}/></td><td class="code">${u.code}</td><td><strong>${esc(unitProductName(u))}</strong><span>${esc(product(u.productId)?.sku)}</span></td><td>${esc(u.serial||'—')}</td><td>${date(u.receivedAt)}</td><td><span class="status ${statusClass(u.status)}">${u.status}</span></td><td><button class="row-btn" data-unit="${u.code}">View →</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">No matching stock units.</td></tr>';$('#select-all').checked=units.length>0&&units.every(u=>selected.has(u.id))}
function renderActivity(){$('#full-activity').innerHTML=db.activities.map(activityRow).join('')||'<div class="empty">No activity yet.</div>'}
function renderTeam(){$('#team-list').innerHTML=db.users.map(u=>`<div class="member"><div class="avatar">${esc(u.initials)}</div><div class="member-info"><strong>${esc(u.name)}</strong><span>${esc(u.email)}</span></div><span class="status ${u.role==='Administrator'?'returned':u.role==='Manager'?'available':'sold'}">${u.role}</span>${hosted&&currentUser?.role==='Administrator'&&u.id!==currentUser.id?`<button class="row-btn" data-access="${u.id}">Edit access${u.active?'':' (disabled)'}</button>`:''}</div>`).join('')}
function render(){renderDashboard();renderProducts();renderUnits();renderActivity();renderTeam();applyPermissions()}
function openModal(content){$('#modal-content').replaceChildren(content);$('#modal-backdrop').classList.add('show');$('#modal').showModal();$('.cancel')?.addEventListener('click',closeModal)}
function closeModal(){stopScanner();$('#modal').close();$('#modal-backdrop').classList.remove('show')}
function cloneTemplate(id){return $('#'+id).content.cloneNode(true)}
function productModal(){let c=cloneTemplate('product-form');let form=c.querySelector('form');form.addEventListener('submit',async e=>{e.preventDefault();let f=new FormData(form),p={id:crypto.randomUUID(),name:f.get('name').trim(),brand:f.get('brand').trim(),sku:f.get('sku').trim().toUpperCase(),category:f.get('category'),model:f.get('model').trim(),reorderLevel:Number(f.get('reorderLevel')),unitValue:Number(f.get('unitValue')||0)};if(db.products.some(x=>x.sku===p.sku))return toast('That SKU already exists.');if(hosted)return mutate('create_product',p);db.products.push(p);save();render();closeModal();toast('Product added successfully.')});openModal(c)}
function valueModal(p){let c=document.createElement('div');c.innerHTML=`<div class="modal-title"><p class="eyebrow">PRODUCT VALUE</p><h2>${esc(p.name)}</h2><p>Set the value counted for every available unit.</p></div><form class="form-grid" id="value-form"><label class="full">Unit stock value (LKR)<input required name="unitValue" type="number" min="0" step="0.01" value="${Number(p.unitValue||0)}" /><small>Current available value: ${money(db.units.filter(u=>u.productId===p.id&&u.status==='Available').length*Number(p.unitValue||0))}</small></label><div class="form-actions"><button type="button" class="btn ghost cancel">Cancel</button><button class="btn primary">Save value</button></div></form>`;c.querySelector('form').onsubmit=async e=>{e.preventDefault();let value=Number(new FormData(e.target).get('unitValue')||0);if(hosted)return mutate('set_value',{id:p.id,value});p.unitValue=value;save();render();closeModal();toast('Product value saved.');};openModal(c)}
function receiveModal(preselected=''){let c=cloneTemplate('receive-form'), select=c.querySelector('#receive-product');select.innerHTML='<option value="">Select a product</option>'+db.products.map(p=>`<option value="${p.id}" ${p.id===preselected?'selected':''}>${esc(p.name)} · ${esc(p.sku)}</option>`).join('');let form=c.querySelector('form');form.addEventListener('submit',async e=>{e.preventDefault();let f=new FormData(form),pid=f.get('productId'),qty=Number(f.get('quantity')),serials=f.get('serials').split('\n').map(x=>x.trim()).filter(Boolean);if(!pid)return toast('Choose a product first.'); if(serials.length>qty)return toast('You entered more serial numbers than units.');if(hosted){const units=await mutate('receive',{productId:pid,quantity:qty,serials,reference:f.get('reference')});if(units&&f.get('print')==='on')await printLabels(units);return;}let units=[];for(let i=0;i<qty;i++){let u={id:crypto.randomUUID(),code:code(),productId:pid,serial:serials[i]||'',status:'Available',receivedAt:new Date().toISOString().slice(0,10),reference:f.get('reference')};db.units.push(u);addActivity('add',u,'Received into stock');units.push(u)}save();render();let shouldPrint=f.get('print')==='on';closeModal();toast(`${qty} stock unit${qty===1?'':'s'} created.`);if(shouldPrint)await printLabels(units)});if(hosted){c.querySelector('[name=print]').checked=false;c.querySelector('[name=print]').disabled=true;}openModal(c)}
async function printLabels(units){if(hosted)return toast('Hosted printing requires a secure print agent; see deployment guide.');if(!units.length)return toast('Select at least one unit to print.');let labels=units.map(u=>({name:unitProductName(u),barcode:u.code})),key=localStorage.getItem('maxwell_print_key'),headers={'Content-Type':'application/json'};if(key)headers['X-Api-Key']=key;toast('Sending QR label job to printer…');try{let r=await fetch(PRINT_SERVER+'/print',{method:'POST',headers,body:JSON.stringify({labels})});if(!r.ok)throw new Error(await r.text());toast(`Print job sent: ${labels.length} label${labels.length===1?'':'s'}.`)}catch(e){toast('Units created. Printer not reached — check local print server.');console.warn(e)}}
function unitModal(unit){let p=product(unit.productId);let c=document.createElement('div');c.innerHTML=`<div class="modal-title"><p class="eyebrow">STOCK UNIT</p><h2>${esc(p.name)}</h2><p class="code">${unit.code}</p></div><div class="scan-result"><h3>Current status: <span class="status ${statusClass(unit.status)}">${unit.status}</span></h3><p>Serial number: ${esc(unit.serial||'Not recorded')}<br>Received: ${date(unit.receivedAt)}</p></div><div class="sale-actions"><button class="btn ghost" id="unit-print">Print label</button>${unit.status==='Available'?'<button class="btn primary" id="unit-sell">Mark sold</button>':''}${unit.status==='Sold'?'<button class="btn primary" id="unit-return">Return to stock</button>':''}</div>`;c.querySelector('#unit-print').hidden=hosted||currentUser?.role==='Worker';c.querySelector('#unit-print').onclick=()=>printLabels([unit]);if(unit.status==='Repair'&&currentUser?.role!=='Worker'){let b=document.createElement('button');b.className='btn primary';b.textContent='Complete repair';b.onclick=()=>updateUnit(unit,'Available','repair','Repair completed');c.querySelector('.sale-actions').append(b);}c.querySelector('#unit-sell')?.addEventListener('click',()=>updateUnit(unit,'Sold','sale','Marked as sold'));c.querySelector('#unit-return')?.addEventListener('click',()=>updateUnit(unit,'Available','return','Returned to stock'));openModal(c)}
async function updateUnit(unit,status,type,text){if(hosted)return mutate('transition',{id:unit.id,status,version:unit.version});unit.status=status;if(status==='Sold')unit.soldAt=new Date().toISOString();if(type==='return')unit.returnedAt=new Date().toISOString();addActivity(type,unit,text);save();render();closeModal();toast(`${unit.code} updated to ${status}.`)}
async function scannerModal(){let c=document.createElement('div');c.className='scan-modal';c.innerHTML=`<div class="modal-title"><p class="eyebrow">WORKER MODE</p><h2>Scan an item</h2><p>Point the camera at the Maxwell QR label.</p></div><div class="scanner-frame"><video autoplay playsinline></video><div class="scanner-placeholder">Opening camera…</div></div><div class="scan-choice"><button id="manual-scan">Enter unit code manually</button><button id="demo-scan">Try demo scan</button></div><div id="scan-output"></div>`;openModal(c);let video=c.querySelector('video');c.querySelector('#manual-scan').onclick=()=>{let value=prompt('Enter the unit code (for example MSM-8F4A7C)');if(value)showScanned(value.trim().toUpperCase(),c)};c.querySelector('#demo-scan').hidden=hosted;c.querySelector('#demo-scan').onclick=()=>showScanned(db.units.find(u=>u.status==='Available')?.code,c);try{let stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});scanner=stream;video.srcObject=stream;c.querySelector('.scanner-placeholder').remove();if('BarcodeDetector'in window){let detector=new BarcodeDetector({formats:['qr_code']});let timer=setInterval(async()=>{try{let codes=await detector.detect(video);if(codes[0]?.rawValue){clearInterval(timer);showScanned(codes[0].rawValue,c)}}catch{}},500);c.dataset.timer=timer}}catch{c.querySelector('.scanner-placeholder').textContent='Camera unavailable. Enter the unit code manually.'}}
function stopScanner(){if(scanner){scanner.getTracks().forEach(t=>t.stop());scanner=null}let c=$('#modal-content > div');if(c?.dataset?.timer)clearInterval(c.dataset.timer)}
function showScanned(raw,c){let normalized=(raw||'').trim().toUpperCase();let u=db.units.find(x=>x.code===normalized);let out=c.querySelector('#scan-output');stopScanner();if(!u){out.innerHTML='<div class="scan-result"><h3>Item not found</h3><p>This QR code is not registered in Maxwell Inventory System.</p></div>';return}let p=product(u.productId);let buttons=u.status==='Available'?`<button class="btn primary" id="scan-sell">Mark as sold</button><button class="btn ghost" id="scan-repair">Damaged / repair</button>`:u.status==='Sold'?`<button class="btn primary" id="scan-return">Return to stock</button>`:'';out.innerHTML=`<div class="scan-result"><h3>${esc(p.name)}</h3><p><span class="code">${u.code}</span> · Current status: <b>${u.status}</b></p><div class="sale-actions">${buttons}</div></div>`;out.querySelector('#scan-sell')?.addEventListener('click',()=>updateUnit(u,'Sold','sale','Marked as sold'));out.querySelector('#scan-return')?.addEventListener('click',()=>updateUnit(u,'Available','return','Returned to stock'));out.querySelector('#scan-repair')?.addEventListener('click',()=>updateUnit(u,'Repair','alert','Marked for repair'))}
function printerSettings(){let c=document.createElement('div');c.innerHTML=`<div class="modal-title"><p class="eyebrow">PRINTING</p><h2>Local print server</h2><p>Connect the app to the computer running <span class="code">print_server.py</span>.</p></div><form class="form-grid" id="printer-form"><label class="full">Print server address<input name="url" value="${esc(PRINT_SERVER)}" placeholder="http://localhost:5001"/><small>For production, use the secure local print-agent address.</small></label><label class="full">Print server API key<input name="key" type="password" value="${esc(localStorage.getItem('maxwell_print_key')||'')}" placeholder="Optional unless enabled on the print server" /></label><div class="form-actions"><button type="button" class="btn ghost cancel">Cancel</button><button class="btn primary">Save connection</button></div></form>`;c.querySelector('form').onsubmit=e=>{e.preventDefault();let f=new FormData(e.target);localStorage.setItem('maxwell_print_server',f.get('url').replace(/\/$/,''));localStorage.setItem('maxwell_print_key',f.get('key'));closeModal();toast('Print server connection saved. Reload to apply the address.');};openModal(c)}
function exportActivity(){let csv=['Date,Action,Unit code,Product,Performed by'];db.activities.forEach(a=>{let u=db.units.find(x=>x.code===a.unitCode);csv.push([a.at,a.text,a.unitCode,u?unitProductName(u):'',a.by].map(v=>'"'+String(/^[=+@\-\t\r]/.test(String(v)) ? "'"+v : v).replaceAll('"','""')+'"').join(','))});let blob=new Blob([csv.join('\n')],{type:'text/csv'}),link=Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:'maxwell-inventory-activity.csv'});link.click();URL.revokeObjectURL(link.href)}
function lookupItem(value){let query=value.trim().toLowerCase();if(!query)return toast('Enter an item number or serial number.');let unit=db.units.find(u=>u.code.toLowerCase()===query||u.serial.toLowerCase()===query);if(unit)return unitModal(unit);toast('No item was found with that number.');}
$$('.nav-item').forEach(b=>b.onclick=()=>{let id=b.dataset.page;$$('.nav-item').forEach(x=>x.classList.toggle('active',x===b));$$('.page').forEach(x=>x.classList.toggle('active-page',x.id===id));$('#page-kicker').textContent=b.textContent.trim();$('#page-title').textContent=id==='dashboard'?'Inventory overview':b.textContent.trim();$('.sidebar').classList.remove('open');window.scrollTo(0,0)});
$('#open-product').onclick=productModal;$('#open-receive').onclick=()=>receiveModal();$('#stock-receive').onclick=()=>receiveModal();$('#open-scan').onclick=scannerModal;$('#open-print-settings').onclick=printerSettings;$('#modal-backdrop').onclick=closeModal;$('#modal').querySelector('.modal-close').onclick=closeModal;$('#product-search').oninput=renderProducts;$('#unit-search').oninput=renderUnits;$('#status-filter').onchange=renderUnits;$('#product-table').onclick=e=>{let id=e.target.dataset.receiveProduct;if(id)receiveModal(id)};$('#unit-table').onclick=e=>{let id=e.target.value;if(e.target.classList.contains('unit-check')){e.target.checked?selected.add(id):selected.delete(id);return}let code=e.target.dataset.unit;if(code)unitModal(db.units.find(u=>u.code===code))};$('#select-all').onchange=e=>{let visible=[...$('#unit-table').querySelectorAll('.unit-check')];visible.forEach(x=>e.target.checked?selected.add(x.value):selected.delete(x.value));renderUnits()};$('#print-selected').onclick=()=>printLabels(db.units.filter(u=>selected.has(u.id)));$('#export-activity').onclick=exportActivity;$('#item-lookup').onsubmit=e=>{e.preventDefault();lookupItem($('#item-number').value)};$$('[data-go]').forEach(b=>b.onclick=()=>document.querySelector(`[data-page="${b.dataset.go}"]`).click());$('.menu-toggle').onclick=()=>$('.sidebar').classList.toggle('open');
initialize();
$('#product-table').addEventListener('click',e=>{let id=e.target.dataset.valueProduct;if(id)valueModal(product(id))});

function applyPermissions(){
 const role=currentUser?.role, admin=role==='Administrator', manager=admin||role==='Manager';
 for(const id of ['open-product']) $('#'+id).hidden=!admin;
 for(const id of ['open-receive','stock-receive','print-selected','export-activity']) $('#'+id).hidden=!manager;
 $('#open-print-settings').hidden=hosted||!admin;$('#print-selected').hidden=hosted||!manager;
 $$('[data-value-product]').forEach(b=>b.hidden=!admin);
 $$('[data-receive-product]').forEach(b=>b.hidden=!manager);
 $('[data-page="team"]').hidden=!admin;
 $('[data-page="activity"]').hidden=!manager;
 $('[data-go="activity"]').hidden=!manager;
 $('#recent-activity').closest('section').hidden=!manager;
 $('#open-user').hidden=!admin;
 $('.profile strong').textContent=currentUser?.name||'';
 $('.profile .avatar').textContent=currentUser?.name?.split(' ').map(x=>x[0]).slice(0,2).join('')||'';
 $('.profile span').textContent=role||'';
 $('#data-mode').textContent=hosted?'Live database':'Local demo';
 $('#sign-out').hidden=!hosted; $('#refresh-data').hidden=!hosted;
}
function lock(message){
 closeModal(); currentUser=null; selected.clear(); db={products:[],units:[],activities:[],users:[]};render();
 document.body.classList.remove('authenticated');$('#auth-message').textContent=message;
}
async function refresh(){
 const state=await snapshot();db=state.db;currentUser=state.profile;selected.clear();render();
 if(currentUser.role!=='Administrator' && $('#team').classList.contains('active-page') || currentUser.role==='Worker'&&$('#activity').classList.contains('active-page')) $('[data-page="dashboard"]').click();
 document.body.classList.add('authenticated');
}
async function mutate(action,payload){
 if(busy)return;busy=true;
 const buttons=$$('#modal button');buttons.forEach(b=>b.disabled=true);
 let committed=false;
 try{const result=await command(action,payload);committed=true;closeModal();await refresh();toast('Saved to database.');return result;}
 catch(error){if(committed){lock('Saved, but refresh failed. Sign in again before continuing.');}toast(error.message||'Request failed.');}
 finally{busy=false;buttons.forEach(b=>b.disabled=false);}
}
async function initialize(){
 $('#login-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
  try{const f=new FormData(e.target);const {error}=await client.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});if(error)throw error;await refresh();e.target.reset();}
  catch(error){lock(error.message);}finally{button.disabled=false;}
 };
 const logout=async()=>{const {error}=await client.auth.signOut();lock(error?'Sign out failed. Try clearing the session again.':'Sign in to access inventory.');};
 $('#sign-out').onclick=logout;$('#auth-signout').onclick=logout;
 $('#refresh-data').onclick=async()=>{try{await refresh();toast('Inventory refreshed.');}catch(e){lock(e.message);}};
 $('#open-user').onclick=()=>toast('Create the account in Supabase Auth and provision its profile using the README SQL.');
 $('#team-list').onclick=e=>{const u=db.users.find(u=>u.id===e.target.dataset.access);if(!u)return;
  const c=document.createElement('div');c.innerHTML=`<h2>Edit access: ${esc(u.name)}</h2><form class="form-grid"><label>Role<select name="role">${['Administrator','Manager','Worker'].map(r=>`<option ${u.role===r?'selected':''}>${r}</option>`).join('')}</select></label><label>Active<input type="checkbox" name="active" ${u.active?'checked':''}></label><button class="btn primary">Save access</button></form>`;
  c.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);mutate('set_access',{id:u.id,role:f.get('role'),active:f.get('active')==='on'});};openModal(c);
 };
 if(!hosted){document.body.classList.add('authenticated');render();return;}
 client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')lock('Sign in to access inventory.');});
 try{await refresh();}catch(error){lock(error.message);}
}
