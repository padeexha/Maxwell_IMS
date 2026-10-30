export const ROLES = ['Administrator', 'Manager', 'Worker'];
export const emptyDatabase = () => ({ products: [], units: [], activities: [], users: [] });
export function permissions(role) {
  return { catalogue: role === 'Administrator', receive: ['Administrator','Manager'].includes(role),
    reports: ['Administrator','Manager'].includes(role), team: role === 'Administrator',
    stock: ROLES.includes(role) };
}
export function transitions(status, role) {
  if (!permissions(role).stock) return [];
  if (status === 'Available') return [{status:'Sold', label:'Mark as sold', type:'sale'}, {status:'Repair', label:'Send for repair', type:'alert'}];
  if (status === 'Sold') return [{status:'Available', label:'Return to stock', type:'return'}];
  if (status === 'Repair' && permissions(role).receive) return [{status:'Available', label:'Complete repair', type:'repair'}];
  return [];
}
export function validateProduct(p, products = [], currentId = null) {
  if (!p.name?.trim() || p.name.trim().length > 200) return 'Enter a product name (up to 200 characters).';
  if (!p.sku?.trim() || p.sku.trim().length > 100) return 'Enter an SKU (up to 100 characters).';
  if (products.some(x => x.id !== currentId && x.sku.toUpperCase() === p.sku.trim().toUpperCase())) return 'This SKU already exists. Use a unique SKU.';
  if (!Number.isInteger(p.reorderLevel) || p.reorderLevel < 0) return 'Reorder level must be a whole number of zero or more.';
  return validateValue(p.unitValue);
}
export function validateValue(value) {
  return Number.isFinite(value) && value >= 0 && value < 1e12 ? '' : 'Enter a valid value between 0 and 999,999,999,999.99.';
}
export function validateReceipt(p, db) {
  if (!db.products.some(x => x.id === p.productId)) return 'Choose a product from the catalogue.';
  if (!Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 100) return 'Quantity must be a whole number between 1 and 100.';
  if (p.serials.length > p.quantity) return 'There are more serial numbers than units.';
  const seen = new Set(db.units.map(x => x.serial?.trim().toLowerCase()).filter(Boolean));
  for (const serial of p.serials) {
    const key = serial.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) return `Serial number “${serial}” is already in use or repeated in this batch.`;
    seen.add(key);
  }
  return '';
}
export function metrics(db) {
  const counts = {Available:0, Sold:0, Repair:0};
  const products = new Map(db.products.map(p=>[p.id,p]));
  let value = 0;
  for (const u of db.units) { if(u.status in counts) counts[u.status]++; if(u.status==='Available') value += Number(products.get(u.productId)?.unitValue || 0); }
  return {...counts, value, total: db.units.length};
}
export function paginate(items, page, size = 25) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return {items: items.slice((current-1)*size, current*size), page:current, pages, total:items.length};
}
export function findUnit(units, input) {
  const q = String(input || '').trim().toLowerCase();
  return q ? units.find(u => u.code.toLowerCase()===q || (u.serial && u.serial.toLowerCase()===q)) : undefined;
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]|^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"','""') + '"';
}
export function errorMessage(error) {
  if (error?.code === '23505') return 'That SKU or serial number already exists. Refresh and check the inventory.';
  if (error?.code === '40001') return 'Someone updated this item. Close this window, refresh inventory, and try again.';
  if (error?.code === '42501') return 'Your account does not have permission for this action. Refresh to check your current access.';
  if (/fetch|network|load failed/i.test(error?.message || '')) return 'Connection interrupted. Check your internet and retry. Your form has been kept.';
  return error?.message || 'Something went wrong. Please try again.';
}
