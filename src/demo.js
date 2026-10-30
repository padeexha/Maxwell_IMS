import { seed } from './seed.js';
import { permissions, transitions, validateProduct, validateReceipt, validateValue } from './domain.js';
const KEY = 'maxwell_inventory_v1';
export function loadDemo(storage) {
  let warning=''; let db;
  try {
    const raw = storage.getItem(KEY);
    db = raw ? JSON.parse(raw) : structuredClone(seed);
    if (!['products','units','activities','users'].every(key=>Array.isArray(db[key]))) throw Error('Invalid demo data');
    if(!db.products.every(p=>typeof p.name==='string' && typeof p.sku==='string') || !db.units.every(u=>typeof u.code==='string' && db.products.some(p=>p.id===u.productId))) throw Error('Invalid demo records');
  } catch { db=structuredClone(seed); warning='Stored demo data could not be loaded. Showing a temporary sample; your original data has not been overwritten.'; }
  db.products.forEach(p=>{
    p.unitValue = Number(p.unitValue) || 0;
    if (!p.unitValue) {
      const match = seed.products.find(s => s.id === p.id);
      if (match && match.unitValue) p.unitValue = match.unitValue;
    }
  });
  db.units.forEach(u=>{u.version ||=1;u.serial ||= '';if(u.status==='Returned')u.status='Available';if(u.status==='Damaged')u.status='Repair';});
  return {db,warning};
}
export function demoCommand(db, action, p, actor, storage) {
  const next=structuredClone(db), access=permissions(actor.role);
  const audit=(type,text,unitCode='')=>next.activities.unshift({id:crypto.randomUUID(),type,text,unitCode,by:actor.name,at:new Date().toISOString()});
  let result=[];
  if(action==='create_product'){
    if(!access.catalogue)throw Error('Administrator access required.');
    const error=validateProduct(p,next.products);if(error)throw Error(error);
    next.products.push({...p,id:crypto.randomUUID()});audit('product',`Created product ${p.sku}`);
  } else if(action==='set_value'){
    if(!access.catalogue)throw Error('Administrator access required.');
    const error=validateValue(p.value);if(error)throw Error(error);
    const product=next.products.find(x=>x.id===p.id);if(!product)throw Error('Product not found.');
    product.unitValue=p.value;audit('product',`Changed value for ${product.name}`);
  } else if(action==='receive'){
    if(!access.receive)throw Error('Manager access required.');
    const error=validateReceipt(p,next);if(error)throw Error(error);
    for(let i=0;i<p.quantity;i++){
      const u={id:crypto.randomUUID(),code:'MSM-'+crypto.randomUUID().replaceAll('-','').toUpperCase(),productId:p.productId,serial:p.serials[i]||'',status:'Available',receivedAt:new Date().toISOString(),reference:p.reference,version:1};
      next.units.push(u);result.push(u);audit('add','Received into stock',u.code);
    }
  } else if(action==='transition'){
    const u=next.units.find(u=>u.id===p.id);
    if(!u || u.version!==p.version)throw Error('Stock changed. Refresh and try again.');
    const transition=transitions(u.status,actor.role).find(t=>t.status===p.status);
    if(!transition)throw Error('This stock transition is not allowed.');
    u.status=p.status;u.version++;if(p.status==='Sold')u.soldAt=new Date().toISOString();if(transition.type==='return')u.returnedAt=new Date().toISOString();
    audit(transition.type,transition.label,u.code);
  } else if(action==='set_access'){
    if(!access.team)throw Error('Administrator access required.');
    const u=next.users.find(u=>u.email===p.id);if(!u||u.email===actor.email)throw Error('Cannot change this account.');
    u.role=p.role;u.active=p.active;audit('access',`Changed access for ${u.name}`);
  } else throw Error('Unknown action');
  storage.setItem(KEY,JSON.stringify(next)); // Commit only after storage succeeds.
  return {db:next,result};
}
