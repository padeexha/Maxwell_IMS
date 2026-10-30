import { hosted, client, command, snapshot, configurationError } from './backend.js';
import {
  permissions,
  transitions,
  emptyDatabase,
  metrics,
  paginate,
  findUnit,
  validateProduct,
  validateReceipt,
  validateValue,
  csvCell,
  errorMessage,
  ROLES
} from './src/domain.js';
import { loadDemo, demoCommand } from './src/demo.js';
import { icon } from './src/icons.js';
import QRCode from 'qrcode';

// DOM Selectors & Utilities
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value =>
  new Intl.NumberFormat('en-LK', {
    style: 'currency',
    currency: 'LKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);

const date = value => {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : value + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const initials = name =>
  (name || '')
    .trim()
    .split(/\s+/)
    .map(x => x[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

const badge = status => `<span class="badge ${String(status).toLowerCase()}">${esc(status)}</span>`;

const button = (label, action, kind = 'primary', symbol = 'plus', attrs = '') =>
  `<button class="btn ${kind}" data-action="${action}" ${attrs}>${symbol ? icon(symbol) : ''}${label}</button>`;

const pages = {
  overview: ['Overview', 'grid'],
  products: ['Products', 'layers'],
  stock: ['Stock units', 'box'],
  activity: ['Activity', 'activity'],
  team: ['Team & access', 'users']
};

let db = emptyDatabase();
let user = null;
let page = 'overview';
let busy = false;
let refreshing = false;
let lastRefresh = null;
let authEpoch = 0;

let filters = { products: '', stock: '', status: '', activity: '' };
let pageNumbers = { products: 1, stock: 1, activity: 1 };
let cameraStream = null;
let cameraTimer = null;
let cameraGeneration = 0;
let modalTrigger = null;
const selectedStockIds = new Set();

const dialog = $('#dialog');
const product = id => db.products.find(p => p.id === id);
const access = () => permissions(user?.role);
const canView = id => (id === 'team' ? access().team : id === 'activity' ? access().reports : Boolean(user));

function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = icon('check');
  const text = document.createElement('span');
  text.textContent = message;
  node.append(text);
  $('#toasts').replaceChildren(node);
  setTimeout(() => node.remove(), 4000);
}

function notice(message = '') {
  $('#page-notice').textContent = message;
  $('#page-notice').hidden = !message;
}

function header(title, description, actions = '') {
  return `<div class="page-header">
    <div>
      <span class="eyebrow">Inventory Workspace</span>
      <h1>${title}</h1>
      <p>${description}</p>
    </div>
    ${actions ? `<div class="header-meta">${actions}</div>` : ''}
  </div>`;
}

function empty(title, description, action = '', symbol = 'box') {
  return `<div class="empty">
    <span class="empty-icon">${icon(symbol)}</span>
    <h3>${title}</h3>
    <p>${description}</p>
    ${action}
  </div>`;
}

function activityRow(a) {
  const kind = ['sale', 'return', 'add', 'alert', 'repair', 'product', 'access'].includes(a.type) ? a.type : 'product';
  const sym = kind === 'sale' ? 'arrow' : kind === 'return' ? 'refresh' : kind === 'alert' ? 'repair' : kind === 'access' ? 'shield' : 'plus';
  return `<div class="activity-row">
    <span class="activity-symbol ${kind}">${icon(sym)}</span>
    <div class="activity-body">
      <strong>${esc(a.text)}</strong>
      <p>${esc(a.by)}${a.unitCode ? ` · <span class="code">${esc(a.unitCode)}</span>` : ''}</p>
    </div>
    <time datetime="${esc(a.at)}" title="${esc(new Date(a.at).toLocaleString())}">${date(a.at)}</time>
  </div>`;
}

function renderOverview() {
  const m = metrics(db);
  const counts = new Map(db.products.map(p => [p.id, 0]));
  db.units.forEach(u => {
    if (u.status === 'Available') counts.set(u.productId, (counts.get(u.productId) || 0) + 1);
  });
  const sorted = [...db.products].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0));
  const low = sorted.filter(p => counts.get(p.id) <= p.reorderLevel).sort((a, b) => counts.get(a.id) - counts.get(b.id));
  const total = Math.max(1, m.total);
  const max = Math.max(1, ...counts.values());

  const isWorker = user?.role === 'Worker';
  const headerAction = access().receive
    ? button('Receive stock', 'receive')
    : `<button class="btn primary" data-action="scan-to-sell">${icon('camera')}Scan QR to Sell</button>`;

  const workerHero = isWorker
    ? `<section class="worker-hero-panel">
        <div class="worker-hero-content">
          <div class="worker-hero-icon">${icon('scan')}</div>
          <div class="worker-hero-text">
            <span class="worker-hero-eyebrow">Point of Sale Terminal</span>
            <h2>Scan QR Code to Sell Item</h2>
            <p>Use your camera or handheld barcode scanner to read the thermal sticker on any physical item and complete a sale instantly.</p>
          </div>
        </div>
        <div class="worker-hero-actions">
          <button class="btn btn-hero-sell" data-action="scan-to-sell">
            ${icon('camera')} Scan QR to Sell Item
          </button>
          <button class="btn btn-hero-manual" data-action="manual-lookup">
            ${icon('search')} Enter Code Manually
          </button>
        </div>
      </section>`
    : '';

  const metric = (label, value, foot, symbol, cls = '') =>
    `<article class="metric ${cls}">
      <div class="metric-top"><span>${label}</span>${icon(symbol)}</div>
      <strong>${value}</strong>
      <small>${foot}</small>
    </article>`;

  return (
    header(
      isWorker ? 'Sales & Floor Terminal' : 'Inventory overview',
      isWorker ? 'Scan product QR stickers to record sales and track available stock.' : 'Current stock balance, catalogue valuation, and items requiring attention.',
      headerAction
    ) +
    workerHero +
    `<div class="metric-grid">
      ${metric('Available units', m.Available, '<span class="dot"></span>Ready for dispatch or sale', 'box')}
      ${!isWorker ? metric('Available stock value', money(m.value), 'Current valuation at catalogue prices', 'wallet', 'value') : metric('Total inventory units', m.total, 'Physical units registered', 'layers')}
      ${metric('Sold units', m.Sold, 'Total items marked as sold', 'arrow')}
      ${metric('In repair', m.Repair, 'Awaiting return to available inventory', 'repair')}
    </div>` +
    `<div class="overview-grid">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h3>Stock by product</h3>
            <p>Available units across your catalogue</p>
          </div>
          <a class="text-button" href="#products">View all products ${icon('arrow')}</a>
        </div>
        ${
          sorted.length
            ? sorted
                .slice(0, 6)
                .map(
                  p => `<div class="stock-row">
                    <span class="product-symbol">${icon('box')}</span>
                    <div class="description">
                      <strong>${esc(p.name)}</strong>
                      <span>${esc(p.sku)}</span>
                      <div class="bar-track"><span style="width:${Math.round(((counts.get(p.id) || 0) / max) * 100)}%"></span></div>
                    </div>
                    <div class="row-value">
                      <b>${counts.get(p.id) || 0} units</b><br>
                      <span>${money((counts.get(p.id) || 0) * p.unitValue)}</span>
                    </div>
                  </div>`
                )
                .join('')
            : empty(
                'Your inventory starts here',
                access().catalogue
                  ? 'Add your first product model, then receive its physical units.'
                  : 'An administrator can add products to start receiving inventory.',
                access().catalogue ? button('Add product', 'add-product') : ''
              )
        }
      </section>
      <div class="overview-side">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Stock breakdown</h3>
              <p>${m.total} registered unit${m.total === 1 ? '' : 's'}</p>
            </div>
          </div>
          <div class="distribution">
            <div class="segments" aria-hidden="true">
              ${['Available', 'Sold', 'Repair']
                .map(s => `<span class="segment ${s.toLowerCase()}" style="width:${(m[s] / total) * 100}%"></span>`)
                .join('')}
            </div>
            <div class="legend">
              ${['Available', 'Sold', 'Repair']
                .map(
                  s => `<div>
                    <span><i class="dot ${s.toLowerCase()}"></i>${s === 'Repair' ? 'In repair' : s}</span>
                    <b>${m[s]}</b>
                  </div>`
                )
                .join('')}
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Low stock alerts</h3>
              <p>Items at or below reorder threshold</p>
            </div>
            <span class="badge ${low.length ? 'low' : ''}">${low.length} product${low.length === 1 ? '' : 's'}</span>
          </div>
          ${
            low.length
              ? `<div class="attention-list">
                  ${low
                    .slice(0, 4)
                    .map(
                      p => `<div class="attention-row">
                        <div>
                          <strong>${esc(p.name)}</strong>
                          <p>${counts.get(p.id)} available · Reorder at ${p.reorderLevel}</p>
                        </div>
                        ${
                          access().receive
                            ? `<button class="icon-button" data-action="receive" data-id="${esc(p.id)}" aria-label="Receive ${esc(p.name)}">${icon('plus')}</button>`
                            : badge('Low')
                        }
                      </div>`
                    )
                    .join('')}
                </div>`
              : empty(
                  db.products.length ? 'Stock levels optimal' : 'No stock alerts yet',
                  db.products.length ? 'All catalogue items are above their reorder thresholds.' : 'Alerts appear when a product drops below its reorder level.',
                  '',
                  'check'
                )
          }
        </section>
      </div>
    </div>
    ${
      access().reports
        ? `<section class="panel activity-preview">
            <div class="panel-head">
              <div>
                <h3>Recent movements</h3>
                <p>Latest changes recorded by your team</p>
              </div>
              <a class="text-button" href="#activity">View full activity ${icon('arrow')}</a>
            </div>
            ${
              db.activities.length
                ? `<div class="activity-list">${db.activities.slice(0, 4).map(activityRow).join('')}</div>`
                : empty('No activity recorded', 'Receiving stock, sales, returns, and updates appear here.', '', 'activity')
            }
          </section>`
        : ''
    }`
  );
}

function pagination(result) {
  return `<div class="pagination">
    <span>${result.total ? `${(result.page - 1) * 25 + 1}–${Math.min(result.page * 25, result.total)} of ${result.total}` : '0 results'}</span>
    <div class="pagination-actions">
      <button class="btn secondary" data-action="previous" ${result.page === 1 ? 'disabled' : ''}>Previous</button>
      <span>${result.page} / ${result.pages}</span>
      <button class="btn secondary" data-action="next" ${result.page === result.pages ? 'disabled' : ''}>Next</button>
    </div>
  </div>`;
}

function filterBar(kind, placeholder, extra = '', count = '') {
  return `<div class="table-toolbar">
    <div class="toolbar-filters">
      <label class="search-field">
        ${icon('search')}
        <input data-search="${kind}" type="search" aria-label="${placeholder}" placeholder="${placeholder}" value="${esc(filters[kind])}" />
      </label>
      ${extra}
    </div>
    <span class="count-label">${count}</span>
  </div>`;
}

function renderProductsTable() {
  const q = filters.products.trim().toLowerCase();
  const list = db.products
    .filter(p => `${p.name} ${p.sku} ${p.brand} ${p.model} ${p.category}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const result = paginate(list, pageNumbers.products);
  pageNumbers.products = result.page;
  const counts = new Map();
  db.units.forEach(u => {
    if (u.status === 'Available') counts.set(u.productId, (counts.get(u.productId) || 0) + 1);
  });

  const countText = `${list.length} product${list.length === 1 ? '' : 's'}`;
  const html = list.length
    ? `<div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>SKU / Category</th>
              <th class="numeric">Available</th>
              <th class="numeric">Unit value</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${result.items
              .map(
                p => `<tr>
                  <td data-label="Product">
                    <strong>${esc(p.name)}</strong>
                    <span class="subline">${esc([p.brand, p.model].filter(Boolean).join(' · ') || 'No brand or model')}</span>
                  </td>
                  <td data-label="SKU / Category">
                    <span class="code">${esc(p.sku)}</span>
                    <span class="subline">${esc(p.category)}</span>
                  </td>
                  <td class="numeric" data-label="Available">
                    <b>${counts.get(p.id) || 0}</b> ${(counts.get(p.id) || 0) <= p.reorderLevel ? badge('Low') : ''}
                  </td>
                  <td class="numeric" data-label="Unit value">${money(p.unitValue)}</td>
                  <td class="actions-cell">
                    <div class="table-actions">
                      ${
                        access().catalogue
                          ? `<button class="text-button" data-action="edit-product" data-id="${esc(p.id)}">Edit</button>
                             <button class="text-button danger" data-action="delete-product" data-id="${esc(p.id)}">Delete</button>`
                          : ''
                      }
                      ${
                        access().receive
                          ? `<button class="text-button" data-action="receive" data-id="${esc(p.id)}">Receive ${icon('plus')}</button>`
                          : `<button class="text-button" data-action="product-stock" data-id="${esc(p.id)}">View stock ${icon('arrow')}</button>`
                      }
                    </div>
                  </td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      ${pagination(result)}`
    : empty(
        q ? 'No matching products' : 'Add your first product',
        q ? 'Try a different name, brand, or SKU.' : 'Create a catalogue entry before receiving physical stock units.',
        !q && access().catalogue ? button('Add product', 'add-product') : '',
        'layers'
      );

  return { html, countText };
}

function renderProducts() {
  const { html, countText } = renderProductsTable();
  return (
    header('Products', 'Your catalogue of appliances, furniture, and electronics.', access().catalogue ? button('Add product', 'add-product') : '') +
    `<section class="panel">
      ${filterBar('products', 'Search products, brand, or SKU', '', countText)}
      <div id="products-table-container">${html}</div>
    </section>`
  );
}

function renderStockTable() {
  const q = filters.stock.trim().toLowerCase();
  const list = db.units
    .filter(
      u =>
        (!filters.status || u.status === filters.status) &&
        `${u.code} ${u.serial} ${product(u.productId)?.name} ${product(u.productId)?.sku}`.toLowerCase().includes(q)
    )
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.code.localeCompare(b.code));
  const result = paginate(list, pageNumbers.stock);
  pageNumbers.stock = result.page;

  // Prune any dangling IDs from selectedStockIds that no longer exist in db.units
  for (const id of selectedStockIds) {
    if (!db.units.some(u => u.id === id)) {
      selectedStockIds.delete(id);
    }
  }

  const countText = `${list.length} unit${list.length === 1 ? '' : 's'}`;
  const pageUnits = result.items;
  const allPageSelected = pageUnits.length > 0 && pageUnits.every(u => selectedStockIds.has(u.id));
  const selectedCount = selectedStockIds.size;

  const selectionBarHtml = selectedCount > 0
    ? `<div class="selection-bar">
        <div class="selection-info">
          <span class="selection-count">${selectedCount} item${selectedCount === 1 ? '' : 's'} selected</span>
        </div>
        <div class="selection-actions">
          <button class="btn btn-secondary btn-sm" data-action="clear-stock-selection">Clear</button>
          <button class="btn btn-primary btn-sm" data-action="print-selected-stickers">
            ${icon('printer')} Print stickers (${selectedCount})
          </button>
        </div>
      </div>`
    : '';

  const html = list.length
    ? `${selectionBarHtml}<div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th class="select-cell">
                <input type="checkbox" id="select-all-stock" aria-label="Select all stock units on this page" ${allPageSelected ? 'checked' : ''} />
              </th>
              <th>Product</th>
              <th>Inventory code</th>
              <th>Serial number</th>
              <th>Status</th>
              <th>Received</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${result.items
              .map(
                u => `<tr class="${selectedStockIds.has(u.id) ? 'selected-row' : ''}">
                  <td class="select-cell">
                    <input type="checkbox" class="stock-select-box" data-id="${esc(u.id)}" aria-label="Select unit ${esc(u.code)}" ${selectedStockIds.has(u.id) ? 'checked' : ''} />
                  </td>
                  <td data-label="Product">
                    <strong>${esc(product(u.productId)?.name || 'Unknown product')}</strong>
                    <span class="subline">${esc(product(u.productId)?.sku)}</span>
                  </td>
                  <td data-label="Inventory code" class="code-cell">
                    <span class="code">${esc(u.code)}</span>
                  </td>
                  <td data-label="Serial number"><span class="code">${esc(u.serial || '—')}</span></td>
                  <td data-label="Status">${badge(u.status)}</td>
                  <td data-label="Received">${date(u.receivedAt)}</td>
                  <td class="actions-cell">
                    <div class="table-actions">
                      <button class="icon-button" data-action="print-unit-sticker" data-id="${esc(u.id)}" aria-label="Print sticker for ${esc(u.code)}" title="Print sticker">
                        ${icon('printer')}
                      </button>
                      <button class="text-button" data-action="unit" data-id="${esc(u.id)}" aria-label="View unit ${esc(u.code)}">
                        View ${icon('arrow')}
                      </button>
                    </div>
                  </td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      ${pagination(result)}`
    : empty(
        q || filters.status ? 'No matching stock units' : 'No stock units received yet',
        q || filters.status ? 'Try another search or select a different status filter.' : 'Receive a product to generate an inventory code for every physical item.',
        !q && !filters.status && access().receive ? button('Receive stock', 'receive') : ''
      );

  return { html, countText };
}

function updateStockView() {
  const container = $('#stock-table-container');
  const countLabel = $('.count-label', $('#page-content'));
  if (container) {
    const { html, countText } = renderStockTable();
    container.innerHTML = html;
    if (countLabel) countLabel.textContent = countText;
  }
  const headerMeta = $('.header-meta', $('#page-content'));
  if (headerMeta && location.hash === '#stock') {
    const selectedCount = selectedStockIds.size;
    const printBtn = selectedCount > 0
      ? button(`Print stickers (${selectedCount})`, 'print-selected-stickers', 'primary', 'printer')
      : button('Print stickers', 'print-visible-stickers', 'secondary', 'printer');
    const firstBtn = headerMeta.querySelector('[data-action^="print-"]');
    if (firstBtn) {
      firstBtn.outerHTML = printBtn;
    }
  }
}

function renderStock() {
  const { html, countText } = renderStockTable();
  const selectedCount = selectedStockIds.size;
  const printButton = selectedCount > 0
    ? button(`Print stickers (${selectedCount})`, 'print-selected-stickers', 'primary', 'printer')
    : button('Print stickers', 'print-visible-stickers', 'secondary', 'printer');

  return (
    header(
      'Stock units',
      'Every physical item, from receiving to its next movement.',
      `<div class="header-meta">
        ${printButton}
        ${access().receive ? button('Receive stock', 'receive') : ''}
      </div>`
    ) +
    `<section class="panel">
      ${filterBar(
        'stock',
        'Search code, serial, or product',
        `<select id="stock-status" aria-label="Filter by stock status">
          <option value="">All statuses</option>
          ${['Available', 'Sold', 'Repair'].map(s => `<option ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>`,
        countText
      )}
      <div id="stock-table-container">${html}</div>
    </section>`
  );
}

function renderActivityTable() {
  const q = filters.activity.trim().toLowerCase();
  const list = db.activities.filter(a => `${a.text} ${a.by} ${a.unitCode}`.toLowerCase().includes(q));
  const result = paginate(list, pageNumbers.activity);
  pageNumbers.activity = result.page;

  const countText = `${list.length} event${list.length === 1 ? '' : 's'}`;
  const html = list.length
    ? `<div class="activity-list">${result.items.map(activityRow).join('')}</div>${pagination(result)}`
    : empty(
        q ? 'No matching activity' : 'No activity recorded yet',
        q ? 'Try a different action, inventory code, or team member.' : 'Stock movements and catalogue changes will appear here.',
        '',
        'activity'
      );

  return { html, countText };
}

function renderActivity() {
  const { html, countText } = renderActivityTable();
  return (
    header(
      'Activity log',
      'Immutable audit trail of stock movements, catalogue updates, and staff access changes.',
      button('Export CSV', 'export', 'secondary', 'down', db.activities.length ? '' : 'disabled')
    ) +
    `<section class="panel">
      ${filterBar('activity', 'Search action, code, or team member', '', countText)}
      <div id="activity-table-container">${html}</div>
    </section>`
  );
}

function renderTeam() {
  return (
    header('Team & access', 'Manage staff permissions and workspace roles.') +
    `<div class="provision-note">
      ${icon('info')} Staff accounts are managed by your administrator. In this workspace, you can configure roles and access status.
    </div>
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>Staff directory</h3>
          <p>${db.users.length} registered team members</p>
        </div>
      </div>
      <div class="team-grid">
        ${db.users
          .map(u => {
            const isMe = hosted ? u.id === user.id : u.email === user.email;
            return `<div class="member">
              <span class="avatar">${esc(initials(u.name))}</span>
              <div class="member-info">
                <strong>${esc(u.name)} ${isMe ? '<span class="badge">You</span>' : ''}</strong>
                <span>${esc(u.email)}</span>
              </div>
              <div class="member-badges">
                ${badge(u.role)}
                ${u.active === false ? badge('Inactive') : ''}
                ${
                  !isMe && access().team
                    ? `<button class="text-button" data-action="access" data-id="${esc(u.id || u.email)}">Edit access</button>`
                    : ''
                }
                ${
                  !hosted && !isMe
                    ? `<button class="btn subtle" data-action="switch-user" data-email="${esc(u.email)}">Switch to role</button>`
                    : ''
                }
              </div>
            </div>`;
          })
          .join('')}
      </div>
    </section>
    <div class="role-reference">
      <div>
        <strong>Administrator</strong>
        <p>Full control: manage product catalogue, unit values, receive stock, export audits, and manage staff roles.</p>
      </div>
      <div>
        <strong>Manager</strong>
        <p>Operational control: receive stock batches, process sales and returns, complete repairs, and view activity reports.</p>
      </div>
      <div>
        <strong>Worker</strong>
        <p>Floor staff: view catalogue and stock units, mark items as sold, return items to stock, and report items for repair.</p>
      </div>
    </div>`
  );
}

function renderPage() {
  if (!user) return;
  if (!canView(page)) page = 'overview';
  $('#page-content').innerHTML = {
    overview: renderOverview,
    products: renderProducts,
    stock: renderStock,
    activity: renderActivity,
    team: renderTeam
  }[page]();

  $('#breadcrumb-page').textContent = pages[page][0];
  document.title = `${pages[page][0]} · Maxwell Inventory`;
  $('#navigation').innerHTML = Object.entries(pages)
    .filter(([id]) => canView(id))
    .map(
      ([id, [label, symbol]]) =>
        `<a class="nav-link" href="#${id}" ${page === id ? 'aria-current="page"' : ''}>
          ${icon(symbol)}${label}${id === 'stock' ? `<span class="nav-count">${db.units.length}</span>` : ''}
        </a>`
    )
    .join('');

  $('#account-name').textContent = user.name;
  $('#account-role').textContent = user.role;
  $('#account-avatar').textContent = initials(user.name);
  $('#mode-label').textContent = hosted ? 'Connected workspace' : 'Local demo · Sample data';
  $('#sign-out').hidden = !hosted;
  $('#sync-status').textContent = lastRefresh
    ? `Updated ${lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : '';
  $('#workspace').hidden = false;
  $('#auth-screen').hidden = true;
}

function navigate() {
  const id = location.hash.slice(1);
  page = id in pages && canView(id) ? id : 'overview';
  closeDrawer();
  closeDialog();
  renderPage();
}

function openDrawer() {
  $('#sidebar').classList.add('open');
  $('#drawer-scrim').hidden = false;
  $('#open-menu').setAttribute('aria-expanded', 'true');
  $('#close-menu').focus();
}

function closeDrawer() {
  $('#sidebar').classList.remove('open');
  $('#drawer-scrim').hidden = true;
  $('#open-menu').setAttribute('aria-expanded', 'false');
}

function openDialog(title, kicker, content) {
  stopCamera();
  modalTrigger = document.activeElement;
  $('#dialog-title').textContent = title;
  $('#dialog-kicker').textContent = kicker;
  $('#dialog-body').innerHTML = content;
  if (!dialog.open) dialog.showModal();
  const firstInput = dialog.querySelector('input:not([type=hidden]), select, textarea, button[type=submit]');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

function closeDialog() {
  if (busy) return;
  stopCamera();
  if (dialog.open) dialog.close();
}

function stopCamera() {
  cameraGeneration++;
  clearTimeout(cameraTimer);
  cameraTimer = null;
  cameraStream?.getTracks().forEach(t => t.stop());
  cameraStream = null;
}

function showError(message, root = dialog) {
  const error = $('.form-error', root);
  if (!error) return;
  error.textContent = message;
  error.hidden = false;
  error.focus();
}

const formError = '<p class="form-error" role="alert" tabindex="-1" hidden></p>';
const formActions = (label, kind = 'primary') =>
  `<div class="form-actions"><button type="button" class="btn secondary" data-action="cancel">Cancel</button><button class="btn ${kind}" type="submit">${label}</button></div>`;

function field(label, name, input, full = false, hint = '') {
  return `<div class="field ${full ? 'full' : ''}">
    <label for="field-${name}">${label}</label>
    ${input.replace('<input', `<input id="field-${name}"`).replace('<select', `<select id="field-${name}"`).replace('<textarea', `<textarea id="field-${name}"`)}
    ${hint ? `<small>${hint}</small>` : ''}
  </div>`;
}

async function mutate(action, payload, success) {
  if (busy) return false;
  busy = true;
  const epoch = authEpoch;
  const controls = $$('button,input,select,textarea', dialog);
  const prior = controls.map(c => c.disabled);
  controls.forEach(c => (c.disabled = true));
  const submit = $('button[type=submit]', dialog);
  const oldLabel = submit?.innerHTML;
  if (submit) submit.innerHTML = '<span class="loading-indicator" aria-hidden="true"></span> Saving…';
  dialog.setAttribute('aria-busy', 'true');
  let committed = false;

  try {
    if (hosted) await command(action, payload);
    else {
      const next = demoCommand(db, action, payload, user, localStorage);
      db = next.db;
    }
    committed = true;
    if (epoch !== authEpoch) return false;
    dialog.close();
    stopCamera();
    if (hosted) {
      try {
        await refreshData();
      } catch {
        notice('Your change was saved, but inventory could not be refreshed. Refresh before making another change.');
      }
    } else {
      lastRefresh = new Date();
      renderPage();
    }
    toast(success);
    return true;
  } catch (error) {
    if (epoch !== authEpoch) return false;
    showError(errorMessage(error));
    if (!committed && ['receive', 'create_product'].includes(action) && /fetch|network|load failed/i.test(error.message || '')) {
      showError('The response was interrupted. Your request is safe to retry with this form.');
    }
    return false;
  } finally {
    busy = false;
    dialog.removeAttribute('aria-busy');
    controls.forEach((c, i) => (c.disabled = prior[i]));
    if (submit) submit.innerHTML = oldLabel;
  }
}

async function generateStickerHtml(unit, size = '50x30') {
  const p = product(unit.productId);
  let qrSvg = '';
  try {
    qrSvg = await QRCode.toString(unit.code, {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    });
  } catch {
    qrSvg = `<div style="font-size:9px;text-align:center;padding:4px;">${esc(unit.code)}</div>`;
  }

  return `<div class="sticker-card size-${size}" data-code="${esc(unit.code)}">
    <div class="sticker-qr">${qrSvg}</div>
    <div class="sticker-name" title="${esc(p?.name || '')}">${esc(p?.name || 'Stock Item')}</div>
    <div class="sticker-code">${esc(unit.code)}</div>
  </div>`;
}

async function openStickerPrinter(units, title = 'Print Sticker') {
  if (!units || !units.length) return;
  let currentSize = '50x30';
  const isBatch = units.length > 1;

  let printServerOnline = false;
  let availablePrinters = [];

  const renderPreview = async size => {
    const cards = await Promise.all(units.map(u => generateStickerHtml(u, size)));
    return cards.join('');
  };

  const initialPreview = await renderPreview(currentSize);

  const content = `
    <div style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <span class="eyebrow">Label Output</span>
      <span class="badge" id="print-server-status" style="font-size:11px;">
        ○ Printer server not connected
      </span>
    </div>
    <p class="dialog-description">
      ${isBatch ? `Ready to print labels for <strong>${units.length} physical units</strong>.` : `Standard thermal barcode sticker with scannable QR code for <strong>${esc(units[0].code)}</strong>.`}
      Supports direct thermal ZPL printing (Port 5001) as well as native browser print.
    </p>
    <div id="thermal-printer-choice" class="field" style="display:none;margin:12px 0;">
      <label for="thermal-printer-select">Printer for direct thermal labels</label>
      <select id="thermal-printer-select">
        <option value="">Use Windows default printer</option>
      </select>
    </div>
    <div class="print-preview-box">
      <div class="print-preview-list" id="preview-stickers-list">
        ${initialPreview}
      </div>
    </div>
    <form class="form-grid" id="sticker-print-form">
      ${formError}
      ${field(
        'Label size & format',
        'labelSize',
        `<select name="labelSize" id="sticker-size-select">
          <option value="50x30" selected>50 × 30 mm (Standard Thermal)</option>
          <option value="50x25">50 × 25 mm (Compact)</option>
          <option value="40x30">40 × 30 mm (Small)</option>
        </select>`
      )}
      ${field(
        'Copies per item',
        'copies',
        '<input name="copies" id="sticker-copies-input" type="number" min="1" max="20" value="1" required />',
        false,
        'Number of sticker copies per unit.'
      )}
      <div class="form-actions" style="flex-wrap:wrap;">
        <button type="button" class="btn secondary" data-action="cancel">Close</button>
        <button type="button" class="btn secondary" id="connect-print-server-btn">
          Connect to Printer Server
        </button>
        <button type="button" class="btn secondary" id="send-direct-thermal-btn" style="display:none;">
          ${icon('printer')}Direct Thermal (Port 5001)
        </button>
        <button type="submit" class="btn primary">${icon('printer')}Browser Print / PDF</button>
      </div>
    </form>
  `;

  openDialog(title, 'STICKER & LABEL PRINTER', content);

  const sizeSelect = $('#sticker-size-select', dialog);
  if (sizeSelect) {
    sizeSelect.onchange = async () => {
      currentSize = sizeSelect.value;
      const updated = await renderPreview(currentSize);
      const listEl = $('#preview-stickers-list', dialog);
      if (listEl) listEl.innerHTML = updated;
    };
  }

  const statusBadge = $('#print-server-status', dialog);
  const connectBtn = $('#connect-print-server-btn', dialog);
  const directBtn = $('#send-direct-thermal-btn', dialog);
  const printerChoice = $('#thermal-printer-choice', dialog);
  const printerSelect = $('#thermal-printer-select', dialog);

  if (connectBtn) {
    connectBtn.onclick = async () => {
      connectBtn.disabled = true;
      connectBtn.textContent = 'Connecting…';
      if (statusBadge) statusBadge.textContent = 'Requesting browser access to this PC…';
      try {
        const request = new Request('http://127.0.0.1:5001/printers', {
          method: 'GET',
          mode: 'cors',
          targetAddressSpace: 'loopback',
          signal: AbortSignal.timeout(15000)
        });
        const res = await fetch(request);
        if (!res.ok) throw new Error(`Printer server returned HTTP ${res.status}`);
        const printers = await res.json();
        if (!Array.isArray(printers)) throw new Error('Printer server returned an invalid printer list');
        printServerOnline = true;
        availablePrinters = printers;
        if (statusBadge) {
          statusBadge.className = `badge ${printers.length ? 'available' : 'repair'}`;
          statusBadge.textContent = printers.length
            ? `● Print Server Online (${printers.join(', ')})`
            : '● Print Server Online (no printer detected)';
        }
        if (directBtn) {
          directBtn.style.display = '';
          directBtn.innerHTML = `${icon('printer')}${printers.length ? 'Direct Thermal (Port 5001)' : 'Direct Thermal Test (Virtual)'}`;
        }
        if (printerChoice && printerSelect) {
          printerSelect.replaceChildren(new Option('Use Windows default printer', ''));
          printers.forEach(name => printerSelect.add(new Option(name, name)));
          printerChoice.style.display = printers.length ? '' : 'none';
        }
        connectBtn.textContent = 'Reconnect';
      } catch (err) {
        printServerOnline = false;
        if (statusBadge) {
          statusBadge.className = 'badge repair';
          statusBadge.textContent = 'Connection failed. Check that the server is running and allow Local network access for this site.';
        }
        connectBtn.textContent = 'Retry Connection';
        showError(`Could not reach the printer server. Start it, allow Local network access for maxwell-ims.vercel.app in browser site settings, then retry. (${err.message})`);
      } finally {
        connectBtn.disabled = false;
      }
    };
  }

  if (directBtn) {
    directBtn.onclick = async () => {
      directBtn.disabled = true;
      const origText = directBtn.innerHTML;
      directBtn.innerHTML = '<span class="loading-indicator"></span> Sending…';
      try {
        const labels = units.map(u => ({
          name: product(u.productId)?.name || 'Stock item',
          barcode: u.code
        }));
        const payload = {
          labels,
          printer: printerSelect?.value || '',
          virtual: availablePrinters.length === 0
        };
        const request = new Request('http://127.0.0.1:5001/print', {
          method: 'POST',
          mode: 'cors',
          targetAddressSpace: 'loopback',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const res = await fetch(request);
        const text = await res.text();
        if (res.ok) {
          toast(text || 'ZPL print job processed.');
          closeDialog();
        } else {
          showError(text);
        }
      } catch (err) {
        showError(`Could not reach print server: ${err.message}`);
      } finally {
        directBtn.disabled = false;
        directBtn.innerHTML = origText;
      }
    };
  }

  const formEl = $('#sticker-print-form', dialog);
  if (formEl) {
    formEl.onsubmit = async e => {
      e.preventDefault();
      const copies = Math.max(1, Math.min(20, Number($('#sticker-copies-input', dialog).value) || 1));
      const printArea = $('#print-area');
      if (!printArea) return;

      const singleCards = await Promise.all(units.map(u => generateStickerHtml(u, currentSize)));
      const allCards = [];
      for (let i = 0; i < copies; i++) {
        allCards.push(...singleCards);
      }
      printArea.innerHTML = allCards.join('');

      window.print();
      toast(`Sent ${allCards.length} label${allCards.length === 1 ? '' : 's'} to printer.`);
    };
  }
}

function addProduct() {
  if (!access().catalogue) return;
  openDialog(
    'Add a product',
    'Product Catalogue',
    `<p class="dialog-description">Define a product model. You can receive physical stock units separately afterwards.</p>
    <form class="form-grid">${formError}
      ${field('Product name *', 'name', '<input name="name" maxlength="200" required placeholder="e.g. Samsung 55-inch TV" />', true)}
      ${field('SKU *', 'sku', '<input name="sku" maxlength="100" required placeholder="e.g. SAM-TV-55" />')}
      ${field('Category', 'category', '<select name="category"><option>Appliances</option><option>Electronics</option><option>Furniture</option><option>Other</option></select>')}
      ${field('Brand', 'brand', '<input name="brand" maxlength="120" placeholder="Optional" />')}
      ${field('Model', 'model', '<input name="model" maxlength="120" placeholder="Optional" />')}
      ${field('Unit value (LKR) *', 'unitValue', '<input name="unitValue" type="number" min="0" max="999999999999.99" step="0.01" required value="0" />')}
      ${field('Reorder level *', 'reorderLevel', '<input name="reorderLevel" type="number" min="0" max="2147483647" step="1" required value="2" />', false, 'Trigger an alert when available stock drops to this level.')}
      ${formActions('Add product')}
    </form>`
  );
  const requestId = crypto.randomUUID();
  $('form', dialog).onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const p = {
      name: f.get('name').trim(),
      sku: f.get('sku').trim().toUpperCase(),
      category: f.get('category'),
      brand: f.get('brand').trim(),
      model: f.get('model').trim(),
      unitValue: Number(f.get('unitValue')),
      reorderLevel: Number(f.get('reorderLevel')),
      requestId
    };
    const error = validateProduct(p, db.products);
    if (error) return showError(error);
    mutate('create_product', p, 'Product added to catalogue.');
  };
}

function valueModal(id) {
  if (!access().catalogue) return;
  const p = product(id);
  if (!p) return;
  openDialog(
    'Edit unit value',
    'Product Valuation',
    `<p class="dialog-description"><strong>${esc(p.name)}</strong> (${esc(p.sku)})<br>This updated value applies to all available stock units of this product.</p>
    <form class="form-grid">${formError}
      ${field('Unit value (LKR) *', 'value', `<input name="value" type="number" min="0" max="999999999999.99" step="0.01" required value="${Number(p.unitValue)}" />`, true)}
      ${formActions('Save value')}
    </form>`
  );
  $('form', dialog).onsubmit = e => {
    e.preventDefault();
    const value = Number(new FormData(e.target).get('value'));
    const error = validateValue(value);
    if (error) return showError(error);
    mutate('set_value', { id, value }, 'Product value updated.');
  };
}

function editProduct(id) {
  if (!access().catalogue) return;
  const p = product(id);
  if (!p) return;
  const categories = ['Appliances', 'Electronics', 'Furniture', 'Other'];
  openDialog(
    'Edit product',
    'Product Catalogue',
    `<p class="dialog-description">Update product name, SKU, category, or valuation.</p>
    <form class="form-grid">${formError}
      ${field('Product name *', 'name', `<input name="name" maxlength="200" required value="${esc(p.name)}" placeholder="e.g. Samsung 55-inch TV" />`, true)}
      ${field('SKU *', 'sku', `<input name="sku" maxlength="100" required value="${esc(p.sku)}" placeholder="e.g. SAM-TV-55" />`)}
      ${field('Category', 'category', `<select name="category">${categories.map(c => `<option ${p.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
      ${field('Brand', 'brand', `<input name="brand" maxlength="120" value="${esc(p.brand || '')}" placeholder="Optional" />`)}
      ${field('Model', 'model', `<input name="model" maxlength="120" value="${esc(p.model || '')}" placeholder="Optional" />`)}
      ${field('Unit value (LKR) *', 'unitValue', `<input name="unitValue" type="number" min="0" max="999999999999.99" step="0.01" required value="${Number(p.unitValue)}" />`)}
      ${field('Reorder level *', 'reorderLevel', `<input name="reorderLevel" type="number" min="0" max="2147483647" step="1" required value="${Number(p.reorderLevel)}" />`, false, 'Trigger an alert when available stock drops to this level.')}
      ${formActions('Save changes')}
    </form>`
  );
  $('form', dialog).onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const updated = {
      id,
      name: f.get('name').trim(),
      sku: f.get('sku').trim().toUpperCase(),
      category: f.get('category'),
      brand: f.get('brand').trim(),
      model: f.get('model').trim(),
      unitValue: Number(f.get('unitValue')),
      reorderLevel: Number(f.get('reorderLevel'))
    };
    const error = validateProduct(updated, db.products, id);
    if (error) return showError(error);
    mutate('update_product', updated, 'Product updated successfully.');
  };
}

function deleteProduct(id) {
  if (!access().catalogue) return;
  const p = product(id);
  if (!p) return;
  const unitCount = db.units.filter(u => u.productId === id).length;
  if (unitCount > 0) {
    openDialog(
      'Cannot delete product',
      'Catalogue Protection',
      `<p class="dialog-description">
        <strong>${esc(p.name)}</strong> (${esc(p.sku)}) cannot be deleted because it has <strong>${unitCount}</strong> associated stock unit${unitCount === 1 ? '' : 's'}.
      </p>
      <p class="notice" style="margin:0;">Products with stock history or active inventory units cannot be deleted to maintain audit integrity. You can edit the product name or mark stock units as sold.</p>
      <div class="form-actions" style="margin-top:20px;">
        <button type="button" class="btn secondary" data-action="cancel">Close</button>
      </div>`
    );
    return;
  }

  openDialog(
    'Delete product',
    'Confirm Deletion',
    `<p class="dialog-description">Are you sure you want to delete <strong>${esc(p.name)}</strong> (${esc(p.sku)}) from the catalogue?</p>
    <p class="dialog-description" style="color:var(--muted);">This action cannot be undone. All catalogue details for this item will be permanently removed.</p>
    <form class="form-grid">
      ${formError}
      ${formActions('Delete product', 'danger')}
    </form>`
  );
  $('form', dialog).onsubmit = async e => {
    e.preventDefault();
    mutate('delete_product', { id: p.id, name: `${p.name} (${p.sku})` }, 'Product deleted from catalogue.');
  };
}

function receiveModal(id = '') {
  if (!access().receive) return;
  if (!db.products.length) {
    openDialog(
      'Add a product first',
      'Stock Intake',
      empty(
        'Catalogue is empty',
        access().catalogue ? 'Create a product before receiving physical stock.' : 'Ask an administrator to add a product to the catalogue.',
        access().catalogue ? button('Add product', 'add-product') : button('Close', 'cancel', 'secondary', '')
      )
    );
    return;
  }
  openDialog(
    'Receive stock',
    'Stock Intake',
    `<p class="dialog-description">Each received item receives a unique inventory code. Receive up to 100 units per batch.</p>
    <form class="form-grid">${formError}
      ${field(
        'Product *',
        'productId',
        `<select name="productId" required>
          <option value="">Select a product</option>
          ${[...db.products]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(p => `<option value="${esc(p.id)}" ${p.id === id ? 'selected' : ''}>${esc(p.name)} · ${esc(p.sku)}</option>`)
            .join('')}
        </select>`,
        true
      )}
      ${field('Quantity *', 'quantity', '<input name="quantity" type="number" min="1" max="100" step="1" value="1" required />')}
      ${field('Supplier / PO reference', 'reference', '<input name="reference" maxlength="200" placeholder="Optional PO or supplier ref" />')}
      ${field('Serial numbers', 'serials', '<textarea name="serials" rows="3" placeholder="SN-001&#10;SN-002"></textarea>', true, 'Optional. Enter one serial per line. Remaining units will be recorded without serials.')}
      ${formActions('Receive stock')}
    </form>`
  );
  const requestId = crypto.randomUUID();
  $('form', dialog).onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const p = {
      productId: f.get('productId'),
      quantity: Number(f.get('quantity')),
      serials: f
        .get('serials')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean),
      reference: f.get('reference').trim(),
      requestId
    };
    const error = validateReceipt(p, db);
    if (error) return showError(error);
    const ok = await mutate('receive', p, `${p.quantity} stock unit${p.quantity === 1 ? '' : 's'} received.`);
    if (ok) {
      const newlyReceived = db.units.filter(u => u.productId === p.productId && u.reference === p.reference).slice(-p.quantity);
      if (newlyReceived.length) {
        openStickerPrinter(newlyReceived, `Print Stickers · ${newlyReceived.length} Units`);
      }
    }
  };
}

function unitModal(id) {
  const u = db.units.find(u => u.id === id);
  if (!u) return;
  const p = product(u.productId);
  const actions = transitions(u.status, user.role);

  openDialog(
    'Stock unit',
    'Item Details',
    `<p class="detail-product">${esc(p?.name || 'Unknown product')}</p>
    <p class="dialog-description">${esc(p?.sku || '')}</p>
    <div class="detail-code">
      <code>${esc(u.code)}</code>
      <button class="icon-button" data-action="copy" data-code="${esc(u.code)}" aria-label="Copy inventory code" title="Copy code">${icon('copy')}</button>
      <button class="icon-button" data-action="print-unit-sticker" data-id="${esc(u.id)}" aria-label="Print sticker" title="Print sticker">${icon('printer')}</button>
    </div>
    <dl class="details">
      <div><dt>Status</dt><dd>${badge(u.status)}</dd></div>
      <div><dt>Serial number</dt><dd>${esc(u.serial || 'Not recorded')}</dd></div>
      <div><dt>Received</dt><dd>${date(u.receivedAt)}</dd></div>
      <div><dt>Reference</dt><dd>${esc(u.reference || 'Not recorded')}</dd></div>
      <div><dt>Unit value</dt><dd>${money(p?.unitValue)}</dd></div>
    </dl>
    ${formError}
    <div class="unit-actions">
      ${button('Print sticker', 'print-unit-sticker', 'secondary', 'printer', `data-id="${esc(u.id)}"`)}
      ${
        actions.length
          ? actions
              .map((a, i) =>
                button(
                  a.label,
                  'confirm-transition',
                  i === 0 ? 'primary' : 'secondary',
                  a.status === 'Repair' ? 'repair' : a.status === 'Sold' ? 'arrow' : 'refresh',
                  `data-id="${esc(u.id)}" data-status="${a.status}"`
                )
              )
              .join('')
          : '<p class="notice" style="margin:0;width:100%;">This item is currently undergoing repair. A manager or administrator can return it to stock when ready.</p>'
      }
    </div>`
  );
}

function confirmTransition(id, status) {
  const u = db.units.find(u => u.id === id);
  const a = u && transitions(u.status, user.role).find(a => a.status === status);
  if (!a) return;
  openDialog(
    a.label,
    'Confirm Stock Change',
    `<p class="dialog-description">
      <strong>${esc(product(u.productId)?.name)}</strong><br>
      <span class="code">${esc(u.code)}</span>
    </p>
    <dl class="details">
      <div><dt>Current status</dt><dd>${badge(u.status)}</dd></div>
      <div><dt>New status</dt><dd>${badge(status)}</dd></div>
    </dl>
    <form class="form-grid">${formError}${formActions(a.label)}</form>`
  );
  $('form', dialog).onsubmit = e => {
    e.preventDefault();
    mutate('transition', { id, status, version: u.version }, `Item updated to ${status.toLowerCase()}.`);
  };
}

function accessModal(id) {
  if (!access().team) return;
  const u = db.users.find(u => (u.id || u.email) === id);
  if (!u || id === (user.id || user.email)) return;
  openDialog(
    'Edit staff access',
    'Team Permissions',
    `<p class="dialog-description"><strong>${esc(u.name)}</strong><br>${esc(u.email)}</p>
    <form class="form-grid">${formError}
      ${field('Role', 'role', `<select name="role">${ROLES.map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>`, true)}
      <label class="check-field field full">
        <input name="active" type="checkbox" ${u.active !== false ? 'checked' : ''} /> Account has active staff access
      </label>
      <p class="dialog-description field full">Deactivating an account suspends access immediately without erasing past audit history.</p>
      ${formActions('Save access')}
    </form>`
  );
  $('form', dialog).onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    mutate('set_access', { id, role: f.get('role'), active: f.get('active') === 'on' }, 'Staff access updated.');
  };
}

function sellItemModal(id) {
  const u = db.units.find(u => u.id === id);
  if (!u) return;
  const p = product(u.productId);

  if (u.status === 'Sold') {
    openDialog(
      'Item Already Sold',
      'Stock Status',
      `<div class="sell-item-banner">
        <span class="badge sold" style="font-size:12px;margin-bottom:8px;">Already Sold</span>
        <h3 style="margin:0 0 4px 0;font-size:18px;">${esc(p?.name || 'Stock Item')}</h3>
        <p style="margin:0 0 8px 0;color:var(--muted);">${esc([p?.brand, p?.model, p?.category].filter(Boolean).join(' · '))}</p>
        <div class="detail-code" style="justify-content:center;margin-bottom:12px;">
          <code>${esc(u.code)}</code>
        </div>
        <p class="notice" style="margin:0;width:100%;">This unit was marked as SOLD${u.soldAt ? ` on ${date(u.soldAt)}` : ''}.</p>
      </div>
      <div class="form-actions" style="margin-top:20px;display:flex;justify-content:space-between;width:100%;">
        <button type="button" class="btn secondary" data-action="scan-to-sell">${icon('camera')} Scan Next Item</button>
        <button type="button" class="btn subtle" data-action="confirm-transition" data-id="${esc(u.id)}" data-status="Available">${icon('refresh')} Return to Stock</button>
      </div>`
    );
    return;
  }

  if (u.status === 'Repair') {
    openDialog(
      'Item Under Repair',
      'Stock Status',
      `<div class="sell-item-banner">
        <span class="badge repair" style="font-size:12px;margin-bottom:8px;">In Repair</span>
        <h3 style="margin:0 0 4px 0;font-size:18px;">${esc(p?.name || 'Stock Item')}</h3>
        <p style="margin:0 0 8px 0;color:var(--muted);">${esc([p?.brand, p?.model, p?.category].filter(Boolean).join(' · '))}</p>
        <div class="detail-code" style="justify-content:center;margin-bottom:12px;">
          <code>${esc(u.code)}</code>
        </div>
        <p class="notice warning" style="margin:0;width:100%;">This item is currently undergoing repair and cannot be sold.</p>
      </div>
      <div class="form-actions" style="margin-top:20px;display:flex;justify-content:flex-end;width:100%;">
        <button type="button" class="btn primary" data-action="scan-to-sell">${icon('camera')} Scan Next Item</button>
      </div>`
    );
    return;
  }

  // Unit is Available -> Show high-impact SELL confirmation
  openDialog(
    'Confirm Sale',
    'Point of Sale',
    `<div class="sell-item-banner">
      <span class="badge available" style="font-size:12px;margin-bottom:8px;">Ready to Sell</span>
      <h3 style="margin:0 0 4px 0;font-size:20px;font-weight:700;">${esc(p?.name || 'Stock Item')}</h3>
      <p style="margin:0 0 10px 0;color:var(--muted);font-size:14px;">${esc([p?.brand, p?.model, p?.category].filter(Boolean).join(' · '))}</p>
      <div class="detail-code" style="justify-content:center;margin-bottom:14px;">
        <code style="font-size:14px;font-weight:700;letter-spacing:0.02em;">${esc(u.code)}</code>
        <button class="icon-button" data-action="copy" data-code="${esc(u.code)}" aria-label="Copy code" title="Copy code">${icon('copy')}</button>
      </div>
      <div class="sell-price-box">
        <span class="sell-price-label">Catalogue Price</span>
        <strong class="sell-price-value">${money(p?.unitValue)}</strong>
      </div>
      ${u.serial ? `<p style="margin:10px 0 0 0;font-size:12px;color:var(--muted);">Serial Number: <strong>${esc(u.serial)}</strong></p>` : ''}
    </div>
    <form class="form-grid" style="margin-top:18px;">
      ${formError}
      <div class="form-actions" style="width:100%;display:flex;justify-content:space-between;gap:12px;">
        <button type="button" class="btn secondary" data-action="scan-to-sell">Cancel / Scan Another</button>
        <button class="btn primary" type="submit" style="background:var(--green);border-color:var(--green);font-size:16px;font-weight:700;padding:12px 24px;">
          ${icon('check')} Complete Sale (Mark as Sold)
        </button>
      </div>
    </form>`
  );

  $('form', dialog).onsubmit = async e => {
    e.preventDefault();
    const ok = await mutate('transition', { id: u.id, status: 'Sold', version: u.version }, `Item ${u.code} marked as SOLD.`);
    if (ok) {
      openDialog(
        'Sale Completed',
        'Success',
        `<div class="sell-item-banner" style="border-color:var(--green-border);background:var(--green-bg);">
          <span class="badge sold" style="font-size:13px;margin-bottom:8px;">✓ Item Marked as Sold</span>
          <h3 style="margin:0 0 4px 0;font-size:20px;font-weight:700;color:var(--green-text);">${esc(p?.name || 'Stock Item')}</h3>
          <p style="margin:0 0 10px 0;color:var(--muted);">${esc(u.code)}</p>
          <div class="sell-price-box" style="background:#ffffff;border-color:var(--green-border);">
            <span class="sell-price-label">Sold Value</span>
            <strong class="sell-price-value">${money(p?.unitValue)}</strong>
          </div>
        </div>
        <div class="form-actions" style="margin-top:20px;display:flex;justify-content:space-between;width:100%;">
          <button type="button" class="btn secondary" data-action="cancel">Done</button>
          <button type="button" class="btn-hero-sell" data-action="scan-to-sell" style="font-size:15px;padding:12px 24px;">
            ${icon('camera')} Scan Next Item
          </button>
        </div>`
      );
    }
  };
}

function lookupSellResult(value) {
  const unit = findUnit(db.units, value);
  if (!unit) {
    showError(`No stock unit found matching “${value}”. Verify the code or barcode, or refresh inventory.`);
    return false;
  }
  stopCamera();
  sellItemModal(unit.id);
  return true;
}

function lookup(mode = 'find', autoStartCamera = false) {
  const isSelling = mode === 'sell';
  openDialog(
    isSelling ? 'Scan QR to Sell' : 'Find or scan an item',
    isSelling ? 'Point of Sale' : 'Lookup & Scanner',
    `<p class="dialog-description">
      ${isSelling ? 'Point your camera or barcode scanner gun at the sticker QR code to sell the item.' : 'Enter an inventory code or manufacturer serial number. You can also scan with a handheld scanner or camera.'}
    </p>
    <div class="scanner-area" ${autoStartCamera ? '' : 'hidden'}>
      <video class="scanner-video" playsinline muted></video>
      <p class="scanner-hint" role="status">Starting camera…</p>
    </div>
    <form class="lookup-form" style="margin-top:14px;">
      <div class="field">
        <label for="lookup-code">${isSelling ? 'Scanned Code or Serial Number' : 'Inventory code or serial number'}</label>
        <input id="lookup-code" name="code" autocomplete="off" required placeholder="e.g. MSM-8F4A7C or scan with barcode gun" />
      </div>
      <button class="btn primary" type="submit">${isSelling ? 'Find & Sell' : 'Find item'}</button>
    </form>
    <div style="margin-top:14px">${formError}</div>
    <div class="scan-buttons" style="margin-top:12px;">
      ${button(autoStartCamera ? 'Restart camera' : 'Scan with camera', 'camera', 'secondary', 'camera')}
    </div>`
  );
  $('form', dialog).onsubmit = e => {
    e.preventDefault();
    const val = new FormData(e.target).get('code');
    if (isSelling) lookupSellResult(val);
    else lookupResult(val);
  };
  if (autoStartCamera) {
    startCamera();
  }
  $('#lookup-code')?.focus();
}

function lookupResult(value) {
  const unit = findUnit(db.units, value);
  if (!unit) {
    showError('No matching stock item found. Verify the code or serial number, or refresh inventory.');
    return false;
  }
  unitModal(unit.id);
  return true;
}

async function startCamera() {
  const area = $('.scanner-area', dialog);
  if (!area || cameraStream) return;
  area.hidden = false;
  const hint = $('.scanner-hint', dialog);
  const video = $('video', dialog);
  const trigger = $('[data-action=camera]', dialog);

  if (!navigator.mediaDevices?.getUserMedia) {
    hint.textContent = 'Camera hardware access is unavailable. Please type or paste the code above.';
    return;
  }
  stopCamera();
  const generation = cameraGeneration;
  if (trigger) trigger.disabled = true;

  try {
    let detector = null;
    let decode = null;
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {}
    }
    if (!detector) decode = (await import('jsqr')).default;
    if (generation !== cameraGeneration || !dialog.open) return;

    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if (generation !== cameraGeneration || !dialog.open) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    cameraStream = stream;
    video.srcObject = stream;
    await video.play();
    hint.textContent = 'Hold barcode or QR code in front of camera.';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let lastCode = '';

    const scan = async () => {
      if (generation !== cameraGeneration || !dialog.open) return;
      try {
        let code = '';
        if (video.readyState >= 2) {
          if (detector) {
            code = (await detector.detect(video))[0]?.rawValue || '';
          } else {
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
            code = decode(data.data, data.width, data.height)?.data || '';
          }
        }
        if (generation !== cameraGeneration || !dialog.open) return;
        if (code && code !== lastCode) {
          lastCode = code;
          const isSelling = $('#dialog-title')?.textContent?.includes('Sell');
          if (isSelling) {
            if (lookupSellResult(code)) return;
          } else {
            if (lookupResult(code)) return;
          }
        }
      } catch {
        hint.textContent = 'Scanning frame… Hold steady, or type the code above.';
      }
      if (generation === cameraGeneration) cameraTimer = setTimeout(scan, 250);
    };
    scan();
  } catch {
    if (generation === cameraGeneration) {
      stopCamera();
      hint.textContent = 'Camera access was denied or unavailable. Enter the code manually above.';
    }
  } finally {
    if (trigger?.isConnected) trigger.disabled = false;
  }
}

function exportActivity() {
  if (!access().reports) return;
  const records = db.activities.filter(a => `${a.text} ${a.by} ${a.unitCode}`.toLowerCase().includes(filters.activity.trim().toLowerCase()));
  const lines = [
    ['Date', 'Action', 'Unit code', 'Performed by'],
    ...records.map(a => [a.at, a.text, a.unitCode, a.by])
  ];
  const blob = new Blob(['\uFEFF' + lines.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'maxwell-inventory-activity.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${records.length} activity records exported.`);
}

async function refreshData() {
  if (refreshing) return;
  refreshing = true;
  const epoch = authEpoch;
  $('#refresh-data').disabled = true;

  try {
    if (hosted) {
      const next = await snapshot();
      if (epoch !== authEpoch) return;
      db = next.db;
      user = next.profile;
    } else {
      const next = loadDemo(localStorage);
      db = next.db;
      if (next.warning) notice(next.warning);
    }
    if (epoch !== authEpoch) return;
    lastRefresh = new Date();
    notice();
    renderPage();
  } catch (error) {
    if (epoch !== authEpoch) return;
    if (['NO_ACCESS', 'SIGNED_OUT'].includes(error.code) || error.status === 401 || error.status === 403) {
      lock(errorMessage(error));
    } else if (user) {
      notice('Inventory could not be refreshed. Displayed data may be out of date. ' + errorMessage(error));
    }
    throw error;
  } finally {
    refreshing = false;
    $('#refresh-data').disabled = false;
  }
}

function lock(message = '', isError = false) {
  authEpoch++;
  stopCamera();
  dialog.close();
  closeDrawer();
  user = null;
  db = emptyDatabase();
  selectedStockIds.clear();
  lastRefresh = null;
  filters = { products: '', stock: '', status: '', activity: '' };
  pageNumbers = { products: 1, stock: 1, activity: 1 };
  $('#workspace').hidden = true;
  $('#auth-screen').hidden = false;
  $('#page-content').replaceChildren();
  $('#navigation').replaceChildren();
  $('#dialog-body').replaceChildren();
  $('#account-name').textContent = '';
  $('#account-role').textContent = '';
  $('#account-avatar').textContent = '';
  $('#auth-message').textContent = message;
  $('#auth-message').hidden = !message;
  $('#auth-message').classList.toggle('error', isError);
  $('#clear-session').hidden = !hosted;
  document.title = 'Sign in · Maxwell Inventory';
}

async function logout() {
  if (busy) return;
  lock('Signing out…');
  const { error } = await client.auth.signOut({ scope: 'local' });
  lock(error ? 'Sign-out could not finish. Try “Sign out of this session” again.' : 'You have been signed out.', Boolean(error));
}

async function onAction(event) {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const { action, id, status, email } = target.dataset;
  if (busy) return;

  if (action === 'cancel') return closeDialog();
  if (!user) return;

  if (action === 'add-product') addProduct();
  if (action === 'edit-product') editProduct(id);
  if (action === 'delete-product') deleteProduct(id);
  if (action === 'scan-to-sell') lookup('sell', true);
  if (action === 'manual-lookup') lookup('sell', false);
  if (action === 'receive') receiveModal(id);
  if (action === 'value') valueModal(id);
  if (action === 'unit') unitModal(id);
  if (action === 'confirm-transition') confirmTransition(id, status);
  if (action === 'access') accessModal(id);
  if (action === 'camera') startCamera();
  if (action === 'export') exportActivity();
  if (action === 'print-unit-sticker' && id) {
    const u = db.units.find(x => x.id === id);
    if (u) openStickerPrinter([u], `Print Sticker · ${u.code}`);
  }
  if (action === 'clear-stock-selection') {
    selectedStockIds.clear();
    updateStockView();
  }
  if (action === 'print-selected-stickers') {
    const selected = db.units.filter(u => selectedStockIds.has(u.id));
    if (selected.length) {
      openStickerPrinter(selected, `Print Stickers (${selected.length})`);
    } else {
      toast('No units selected.');
    }
  }
  if (action === 'print-visible-stickers') {
    const q = filters.stock.trim().toLowerCase();
    const list = db.units.filter(
      u =>
        (!filters.status || u.status === filters.status) &&
        `${u.code} ${u.serial} ${product(u.productId)?.name} ${product(u.productId)?.sku}`.toLowerCase().includes(q)
    );
    if (list.length) {
      openStickerPrinter(list.slice(0, 100), `Print Stickers (${Math.min(list.length, 100)})`);
    } else {
      toast('No stock units to print.');
    }
  }
  if (action === 'product-stock') {
    filters.stock = product(id)?.sku || '';
    pageNumbers.stock = 1;
    location.hash = 'stock';
    navigate();
  }
  if (action === 'switch-user' && email) {
    const targetUser = db.users.find(u => u.email === email);
    if (targetUser) {
      user = { ...targetUser };
      renderPage();
      toast(`Switched to ${user.name} (${user.role})`);
    }
  }
  if (action === 'previous' || action === 'next') {
    pageNumbers[page] += action === 'next' ? 1 : -1;
    renderPage();
  }
  if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(target.dataset.code);
      toast('Inventory code copied to clipboard.');
    } catch {
      showError('Clipboard unavailable. Select and copy the inventory code above.');
    }
  }
}

function bind() {
  $('#open-menu').innerHTML = icon('menu');
  $('#close-menu').innerHTML = icon('close');
  $('#close-dialog').innerHTML = icon('close');
  $('#sign-out').innerHTML = icon('logout');
  $('#refresh-data').innerHTML = icon('refresh');
  $('#find-item').innerHTML = icon('scan') + 'Find / Scan';
  $('#find-item').setAttribute('aria-label', 'Find or scan an item');

  $('#find-item').onclick = () => lookup(user?.role === 'Worker' ? 'sell' : 'find', false);
  $('#open-menu').onclick = openDrawer;
  $('#close-menu').onclick = closeDrawer;
  $('#drawer-scrim').onclick = closeDrawer;
  $('#close-dialog').onclick = closeDialog;

  // Dialog backdrop click closes modal
  dialog.addEventListener('click', e => {
    if (e.target === dialog && !busy) closeDialog();
  });

  dialog.addEventListener('cancel', e => {
    if (busy) e.preventDefault();
  });

  dialog.addEventListener('close', () => {
    stopCamera();
    modalTrigger?.isConnected && modalTrigger.focus();
  });

  document.addEventListener('keydown', e => {
    if ($('#sidebar').classList.contains('open')) {
      if (e.key === 'Escape') {
        closeDrawer();
        $('#open-menu').focus();
      }
      if (e.key === 'Tab') {
        const controls = $$('a,button:not([hidden])', $('#sidebar')).filter(el => el.getClientRects().length);
        const first = controls[0];
        const last = controls.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  });

  document.addEventListener('click', onAction);

  // Smooth inline search updates without destroying the input DOM element
  $('#page-content').addEventListener('input', e => {
    const key = e.target.dataset.search;
    if (!key) return;
    filters[key] = e.target.value;
    pageNumbers[key] = 1;

    if (key === 'products') {
      const container = $('#products-table-container');
      const countLabel = $('.count-label', $('#page-content'));
      if (container) {
        const { html, countText } = renderProductsTable();
        container.innerHTML = html;
        if (countLabel) countLabel.textContent = countText;
      }
    } else if (key === 'stock') {
      updateStockView();
    } else if (key === 'activity') {
      const container = $('#activity-table-container');
      const countLabel = $('.count-label', $('#page-content'));
      if (container) {
        const { html, countText } = renderActivityTable();
        container.innerHTML = html;
        if (countLabel) countLabel.textContent = countText;
      }
    }
  });

  $('#page-content').addEventListener('change', e => {
    if (e.target.id === 'select-all-stock') {
      const q = filters.stock.trim().toLowerCase();
      const list = db.units
        .filter(
          u =>
            (!filters.status || u.status === filters.status) &&
            `${u.code} ${u.serial} ${product(u.productId)?.name} ${product(u.productId)?.sku}`.toLowerCase().includes(q)
        )
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.code.localeCompare(b.code));
      const result = paginate(list, pageNumbers.stock);
      if (e.target.checked) {
        result.items.forEach(u => selectedStockIds.add(u.id));
      } else {
        result.items.forEach(u => selectedStockIds.delete(u.id));
      }
      updateStockView();
      return;
    }

    if (e.target.classList.contains('stock-select-box')) {
      const id = e.target.dataset.id;
      if (e.target.checked) {
        selectedStockIds.add(id);
      } else {
        selectedStockIds.delete(id);
      }
      updateStockView();
      return;
    }

    if (e.target.id === 'stock-status') {
      filters.status = e.target.value;
      pageNumbers.stock = 1;
      updateStockView();
    }
  });

  window.addEventListener('hashchange', navigate);
  window.addEventListener('offline', () => {
    if (user) notice('You are offline. Inventory data may be stale; reconnect before making changes.');
  });
  window.addEventListener('online', () => {
    if (user) notice('Connection restored. Refresh inventory to load the latest changes.');
  });

  $('#refresh-data').onclick = async () => {
    if (busy) return;
    try {
      await refreshData();
      toast('Inventory updated.');
    } catch {}
  };

  $('#sign-out').onclick = logout;
  $('#clear-session').onclick = logout;

  $('#show-password').onclick = () => {
    const p = $('#login-password');
    const show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    $('#show-password').textContent = show ? 'Hide' : 'Show';
    $('#show-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  };

  $('#login-form').onsubmit = async e => {
    e.preventDefault();
    if (!client || $('#login-submit').disabled) return;
    $('#login-submit').disabled = true;
    $('#login-submit').innerHTML = '<span class="loading-indicator" aria-hidden="true"></span> Signing in…';
    $('#auth-message').hidden = true;
    try {
      const f = new FormData(e.target);
      const { error } = await client.auth.signInWithPassword({
        email: f.get('email').trim(),
        password: f.get('password')
      });
      if (error) throw error;
      await refreshData();
      e.target.reset();
      page = 'overview';
      navigate();
    } catch (error) {
      lock(errorMessage(error), true);
    } finally {
      $('#login-submit').disabled = false;
      $('#login-submit').textContent = 'Sign in';
    }
  };
}

async function initialize() {
  bind();
  if (configurationError) {
    lock(configurationError, true);
    $('#clear-session').hidden = true;
    return;
  }

  if (!hosted) {
    const initial = loadDemo(localStorage);
    db = initial.db;
    user = { ...db.users.find(u => u.role === 'Administrator'), role: 'Administrator' };
    if (!user.name) user = { name: 'Demo Administrator', email: 'demo@maxwell.example', role: 'Administrator' };
    lastRefresh = new Date();
    navigate();
    if (initial.warning) notice(initial.warning);
    return;
  }

  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') lock('You have been signed out.');
  });

  try {
    await refreshData();
    navigate();
  } catch (error) {
    lock(error.code === 'SIGNED_OUT' ? '' : errorMessage(error), error.code !== 'SIGNED_OUT');
  } finally {
    $('#login-submit').disabled = false;
  }
}

initialize();
