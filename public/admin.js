import { api, money, esc } from './api.js';
import './motion.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const E = value => esc(String(value ?? ''));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const labels = { overview: 'Overview', orders: 'Orders', reservations: 'Reservations', products: 'Menu & shop', pets: 'Our companions', users: 'People & access' };
const statusLabels = { placed: 'Placed', preparing: 'Preparing', out_for_delivery: 'Out for delivery', delivered: 'Delivered', ready_for_pickup: 'Ready for pickup', collected: 'Collected', cancelled: 'Cancelled', confirmed: 'Confirmed', completed: 'Completed', available: 'Available', unavailable: 'Unavailable', admin: 'Admin', staff: 'Staff', customer: 'Customer' };
const state = { view: 'overview', user: null, data: {}, filter: { search: '', status: '', date: '' }, loadId: 0, editor: null };
const isAdmin = () => state.user?.role === 'admin';
const imagePath = value => { const path = /^(?:(?:\.\/|\/)?(?:assets|uploads)\/[a-zA-Z0-9_./-]+|data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+)$/.test(String(value || '')) ? value : './assets/hero.jpg'; return typeof api.image === 'function' ? api.image(path) : path; };
const image = (src, name, className = '') => `<img src="${E(imagePath(src))}" alt="${E(name)}" class="${E(className)}" loading="lazy">`;
const badge = status => `<span class="status ${E(status)}">${E(statusLabels[status] || status)}</span>`;
const idShort = id => `#${String(id).replace(/[^a-zA-Z0-9]/g, '').slice(-7).toUpperCase()}`;
const dateFormat = (value, options = {}) => {
  if (!value) return '—';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+08:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', ...options }).format(date);
};
const timeFormat = time => { const [hours, minutes] = String(time || '').split(':'); const h = Number(hours); return Number.isFinite(h) && hours !== '' ? `${h % 12 || 12}:${minutes || '00'} ${h >= 12 ? 'PM' : 'AM'}` : '—'; };
const empty = (title, text, symbol = 'leaf') => `<div class="empty-state">${icon(symbol)}<h3>${E(title)}</h3><p>${E(text)}</p></div>`;

function toast(message, error = false) {
  const node = document.createElement('div');
  node.className = `toast${error ? ' error' : ''}`;
  node.innerHTML = `${icon(error ? 'close' : 'check')}<span>${E(message)}</span>`;
  $('#toast-region').append(node);
  setTimeout(() => node.remove(), 5500);
}

function setBusy(form, busy) {
  const button = $('button[type="submit"]', form);
  if (!button) return;
  if (busy) { button.dataset.original = button.innerHTML; button.disabled = true; button.innerHTML = '<span class="spinner"></span> Saving…'; }
  else { button.disabled = false; button.innerHTML = button.dataset.original || 'Save changes'; }
}

function setSidebar(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#sidebar-shade').hidden = !open;
  $('#mobile-toggle').setAttribute('aria-expanded', String(open));
}

async function init() {
  try {
    await api.init();
    const { user } = await api.get('/auth/me');
    state.user = user;
    $('#startup').hidden = true;
    document.body.classList.toggle('is-demo', api.mode === 'demo');
    $('#demo-banner').hidden = api.mode !== 'demo';
    $('#demo-credentials').hidden = api.mode !== 'demo';
    if (user && ['admin', 'staff'].includes(user.role)) await enterWorkspace();
    else showGate(user ? 'This account is a customer account. Sign in with an administrator or staff account to open the café desk.' : '');
  } catch (error) {
    $('#startup').innerHTML = `<div class="empty-state">${icon('leaf')}<h3>The café desk is unavailable.</h3><p>${E(error.message || 'Please check your server connection and try again.')}</p><button type="button" class="button primary" data-action="reload" style="margin-top:20px">Try again</button><p style="margin-top:15px"><a href="./index.html">Return to café</a></p></div>`;
  }
}

function showGate(message = '') {
  $('#management').hidden = true;
  $('#auth-gate').hidden = false;
  $('#auth-notice').innerHTML = message ? `<p class="notice">${E(message)}</p>` : '';
}

async function enterWorkspace() {
  $('#auth-gate').hidden = true;
  $('#management').hidden = false;
  $('#users-nav').hidden = !isAdmin();
  $('#account-name').textContent = state.user.name;
  $('#account-role').textContent = state.user.role.toUpperCase();
  $('#account-avatar').textContent = (state.user.name || 'T').charAt(0).toUpperCase();
  if (state.view === 'users' && !isAdmin()) state.view = 'overview';
  await loadView();
}

function heading(title, subtitle, actions = '', eyebrow = 'A LITTLE CARE, EVERY DAY') {
  return `<div class="page-heading"><div><span class="eyebrow">${E(eyebrow)}</span><h1>${E(title)}</h1><p>${E(subtitle)}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function exportButton() { return `<button class="button" data-action="export">${icon('download')} Export CSV</button>`; }
function refreshButton() { return `<button class="button" data-action="refresh">${icon('refresh')} Refresh</button>`; }

async function loadView() {
  const loadId = ++state.loadId;
  const view = state.view;
  $('#breadcrumb-current').textContent = labels[view];
  for (const button of document.querySelectorAll('[data-view]')) button.classList.toggle('active', button.dataset.view === view);
  $('#page-content').innerHTML = `<div class="page-loader" role="status"><span class="spinner"></span> Gathering your café details…</div>`;
  try {
    if (view === 'overview') {
      const [reports, orders, reservations] = await Promise.all([api.get('/reports'), api.get('/orders'), api.get('/reservations')]);
      if (loadId !== state.loadId) return;
      Object.assign(state.data, { reports, orders, reservations });
      renderOverview();
    } else {
      const records = await api.get(`/${view}`);
      if (loadId !== state.loadId) return;
      state.data[view] = records;
      renderListPage();
    }
    const activeOrders = (state.data.orders || []).filter(order => !['delivered', 'collected', 'cancelled'].includes(order.status)).length;
    $('#order-count').textContent = activeOrders ? String(activeOrders) : '';
  } catch (error) {
    if (loadId !== state.loadId) return;
    $('#page-content').innerHTML = heading('A small pause.', 'We could not load this part of the café desk.') + `<div class="panel">${empty('Please try again', error.message || 'Something went wrong while loading your data.')}<div style="text-align:center;padding:0 0 30px"><button class="button primary" data-action="refresh">${icon('refresh')} Try again</button></div></div>`;
  }
}

function renderOverview() {
  const { reports, orders, reservations } = state.data;
  const recent = [...orders].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const upcoming = reservations.filter(r => r.status === 'confirmed' && r.date >= today).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 4);
  const firstName = (state.user.name || 'friend').split(' ')[0];
  const metrics = [['Completed revenue', money(reports.revenue || 0), 'Delivered & collected orders', 'bag'], ['Total orders', reports.orders ?? orders.length, 'Every little craving', 'cup'], ['Reservations', reports.reservations ?? reservations.length, 'Moments with our companions', 'calendar'], ['Customers', reports.customers ?? 0, 'Friends of the café', 'users']];
  $('#page-content').innerHTML = heading('A lovely day at the café.', dateFormat(new Date().toISOString(), { weekday: 'long' }), exportButton() + refreshButton(), 'YOUR CAFÉ, AT A GLANCE') + `<section class="welcome-strip"><div><span class="eyebrow">WELCOME BACK, ${E(firstName.toUpperCase())}</span><h2>A little joy is on the menu.</h2><p>Keep an eye on today’s orders, make room for our guests, and help every visit feel a little special.</p></div><button class="button" data-action="navigate" data-target="orders">See all orders ${icon('arrow')}</button></section><section class="metrics-grid" aria-label="Café statistics">${metrics.map(([label, value, note, symbol]) => `<article class="metric"><div class="metric-top"><span>${E(label)}</span><span class="metric-icon">${icon(symbol)}</span></div><strong>${E(value)}</strong><small>${E(note)}</small></article>`).join('')}</section><div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h2>Fresh from the counter</h2><p>Your most recent orders, all in one place.</p></div><button class="text-button" data-action="navigate" data-target="orders">View all ${icon('arrow')}</button></div>${recent.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th><span class="muted">Details</span></th></tr></thead><tbody>${recent.map(order => `<tr><td><strong>${E(idShort(order.id))}</strong><span class="sub">${E(dateFormat(order.createdAt, { year: undefined }))}</span></td><td>${E(order.customerName || 'Guest')}<span class="sub">${order.fulfillment === 'delivery' ? 'Delivery' : 'Café pickup'}</span></td><td><strong>${E(money(order.total))}</strong></td><td>${badge(order.status)}</td><td><button class="icon-button" data-action="order-detail" data-id="${E(order.id)}" aria-label="View order ${E(idShort(order.id))}">${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>` : empty('A quiet moment.', 'New café orders will appear here.', 'bag')}</section><div class="dashboard-aside"><section class="panel"><div class="panel-header"><div><h2>Coming to visit</h2><p>The next little gatherings.</p></div><button class="text-button" data-action="navigate" data-target="reservations">${icon('arrow')}<span class="sr-only">View reservations</span></button></div>${upcoming.length ? `<div class="mini-reservations">${upcoming.map(r => `<div class="mini-reservation"><span class="date-square"><small>${E(dateFormat(r.date, { month: 'short', day: undefined, year: undefined }).toUpperCase())}</small>${E(r.date.slice(8))}</span><div><strong>${E(r.customerName || 'Guest')}</strong><p>${E(timeFormat(r.time))} · ${E(r.guests)} ${Number(r.guests) === 1 ? 'guest' : 'guests'} · ${E(r.petName || 'Any companion')}</p></div></div>`).join('')}</div>` : empty('Room for a little joy', 'Upcoming confirmed reservations will appear here.', 'calendar')}</section><section class="panel"><div class="panel-header"><div><h2>A little restock?</h2><p>Menu items with five or fewer left.</p></div><button class="text-button" data-action="navigate" data-target="products">${icon('arrow')}<span class="sr-only">View menu stock</span></button></div>${reports.lowStock?.length ? `<div class="stock-list">${reports.lowStock.slice(0, 5).map(p => `<div class="stock-row">${image(p.image, p.name)}<div><strong>${E(p.name)}</strong><small>${E(p.category)}</small></div><span class="stock-qty">${E(p.stock)} left</span></div>`).join('')}</div>` : empty('All stocked with love', 'There are no low stock items at the moment.', 'cup')}</section></div></div>`;
}

function toolbar(options = [], withDate = false) {
  return `<div class="toolbar"><label class="searchbox"><span class="sr-only">Search ${E(labels[state.view])}</span>${icon('search')}<input id="record-search" type="search" placeholder="${state.view === 'orders' ? 'Search order, customer or phone…' : state.view === 'reservations' ? 'Search guest, companion or booking…' : 'Find a little something…'}" value="${E(state.filter.search)}"></label><div class="filter-group">${options.length ? `<label><span class="sr-only">Filter by ${state.view === 'users' ? 'role' : 'status'}</span><select id="record-status"><option value="">${state.view === 'users' ? 'All roles' : state.view === 'products' ? 'All availability' : 'All statuses'}</option>${options.map(([value, label]) => `<option value="${E(value)}" ${state.filter.status === value ? 'selected' : ''}>${E(label)}</option>`).join('')}</select></label>` : ''}${withDate ? `<label><span class="sr-only">Reservation date</span><input type="date" id="record-date" value="${E(state.filter.date)}" aria-label="Filter reservation date"></label>` : ''}<span id="result-count" class="result-count"></span></div></div>`;
}

function renderListPage() {
  const view = state.view;
  const intros = { orders: ['Every order, a little happiness.', 'From the first craving to the doorstep. Keep every order moving.'], reservations: ['Make room for lovely moments.', 'Welcome your guests and keep each café visit running smoothly.'], products: ['Made with a little love.', 'Care for the menu, keep the treats stocked, and add something lovely.'], pets: ['The heart of our little café.', 'Meet the companions who make every visit feel like home.'], users: ['Good company, shared care.', 'Manage your café team and customer accounts.'] };
  let actions = exportButton();
  if (isAdmin() && ['products', 'pets'].includes(view)) actions += `<button class="button primary" data-action="create">${icon('plus')} Add ${view === 'products' ? 'menu item' : 'companion'}</button>`;
  else actions += refreshButton();
  const options = view === 'orders' ? ['placed', 'preparing', 'out_for_delivery', 'ready_for_pickup', 'delivered', 'collected', 'cancelled'].map(v => [v, statusLabels[v]]) : view === 'reservations' ? ['confirmed', 'completed', 'cancelled'].map(v => [v, statusLabels[v]]) : view === 'products' || view === 'pets' ? [['available', 'Available'], ['unavailable', 'Unavailable']] : [['admin', 'Admin'], ['staff', 'Staff'], ['customer', 'Customer']];
  $('#page-content').innerHTML = heading(...intros[view], actions, view === 'pets' ? 'OUR LITTLE COMPANIONS' : 'THE CAFÉ DESK') + (!isAdmin() && ['products', 'pets'].includes(view) ? '<p class="staff-note">Staff can view the catalog. An administrator can add, edit, and remove items or companions.</p>' : '') + (view === 'users' ? '<p class="catalog-hint">Customers create accounts through the café sign-up form. Update roles here to give your team access.</p>' : '') + `<section class="panel${view === 'pets' ? ' pets-toolbar' : ''}">${toolbar(options, view === 'reservations')}${view === 'pets' ? '' : '<div id="record-list"></div>'}</section>${view === 'pets' ? '<div id="record-list"></div>' : ''}`;
  renderRecords();
}

function filteredRecords() {
  const view = state.view;
  const search = state.filter.search.toLowerCase().trim();
  return (state.data[view] || []).filter(record => {
    const fields = view === 'orders' ? [record.id, idShort(record.id), record.customerName, record.phone, record.address] : view === 'reservations' ? [record.id, idShort(record.id), record.customerName, record.petName] : view === 'users' ? [record.name, record.email, record.role] : [record.name, record.category, record.species, record.breed, record.personality];
    const status = ['products', 'pets'].includes(view) ? (record.available ? 'available' : 'unavailable') : view === 'users' ? record.role : record.status;
    return (!search || fields.some(value => String(value || '').toLowerCase().includes(search))) && (!state.filter.status || status === state.filter.status) && (!state.filter.date || record.date === state.filter.date);
  }).sort((a, b) => ['orders', 'reservations'].includes(view) ? String(b.createdAt).localeCompare(String(a.createdAt)) : String(a.name).localeCompare(String(b.name)));
}

function table(headers, rows, count) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${E(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div><div class="table-footer"><span>${count} ${count === 1 ? 'record' : 'records'} shown</span><span>Little details, thoughtfully managed.</span></div>`;
}

function editActions(record, kind) {
  if (kind === 'users' && record.id === state.user.id) return '<span class="muted">Protected account</span>';
  return isAdmin() ? `<div class="actions"><button class="icon-button" data-action="edit" data-kind="${kind}" data-id="${E(record.id)}" aria-label="Edit ${E(record.name)}">${icon('edit')}</button><button class="icon-button danger" data-action="delete" data-kind="${kind}" data-id="${E(record.id)}" aria-label="Delete ${E(record.name)}">${icon('trash')}</button></div>` : '—';
}

function renderRecords() {
  const records = filteredRecords();
  const count = $('#result-count');
  if (count) count.textContent = `${records.length} ${records.length === 1 ? 'result' : 'results'}`;
  const target = $('#record-list');
  if (!target) return;
  if (!records.length) { target.innerHTML = empty('Nothing here just yet.', 'Try another search or filter. New records will appear here.', state.view === 'pets' ? 'paw' : 'leaf'); return; }
  if (state.view === 'orders') target.innerHTML = table(['Order / placed', 'Customer', 'Fulfillment', 'Total', 'Status', 'Details'], records.map(r => `<tr><td><strong>${E(idShort(r.id))}</strong><span class="sub">${E(dateFormat(r.createdAt))}</span></td><td><strong>${E(r.customerName || 'Guest')}</strong><span class="sub">${E(r.phone || '')}</span></td><td>${r.fulfillment === 'delivery' ? 'Delivery' : 'Café pickup'}<span class="sub">${r.items.reduce((sum, item) => sum + Number(item.quantity), 0)} items</span></td><td><strong>${E(money(r.total))}</strong></td><td>${badge(r.status)}</td><td><button class="button small" data-action="order-detail" data-id="${E(r.id)}">Manage ${icon('arrow')}</button></td></tr>`), records.length);
  if (state.view === 'reservations') target.innerHTML = table(['Reservation', 'Guest', 'Visit', 'Companion', 'Status', 'Manage'], records.map(r => `<tr><td><strong>${E(idShort(r.id))}</strong><span class="sub">${E(dateFormat(r.createdAt))}</span></td><td><strong>${E(r.customerName || 'Guest')}</strong><span class="sub">${E(r.guests)} ${Number(r.guests) === 1 ? 'guest' : 'guests'}</span></td><td><strong>${E(dateFormat(r.date))}</strong><span class="sub">${E(timeFormat(r.time))} · 1 hour</span></td><td>${E(r.petName || 'Any companion')}</td><td>${badge(r.status)}</td><td><button class="button small" data-action="reservation-detail" data-id="${E(r.id)}">View ${icon('arrow')}</button></td></tr>`), records.length);
  if (state.view === 'products') target.innerHTML = table(['Menu item', 'Category', 'Price', 'Stock', 'Availability', 'Manage'], records.map(r => `<tr><td><div class="photo-cell">${image(r.image, r.name)}<div><strong>${E(r.name)}</strong><span class="sub">${E(String(r.description || '').slice(0, 65))}${String(r.description || '').length > 65 ? '…' : ''}</span></div></div></td><td>${E(r.category)}</td><td><strong>${E(money(r.price))}</strong></td><td>${Number(r.stock) <= 5 ? `<span class="stock-qty">${E(r.stock)} left</span>` : `${E(r.stock)} left`}</td><td>${badge(r.available ? 'available' : 'unavailable')}</td><td>${editActions(r, 'products')}</td></tr>`), records.length);
  if (state.view === 'pets') target.innerHTML = `<div class="pet-grid">${records.map(r => `<article class="pet-card"><div class="pet-photo">${image(r.image, r.name)}${badge(r.available ? 'available' : 'unavailable')}</div><div class="pet-card-body"><div class="pet-card-top"><h2>${E(r.name)}</h2><span class="pet-species">${E(r.species)}</span></div><p class="pet-meta">${E(r.breed || 'Our café companion')} · ${E(r.age || 'Age unknown')}</p><p>${E(r.description)}</p><div class="pet-actions"><span class="pet-trait">${E(r.personality || 'A lovely little soul')}</span>${editActions(r, 'pets')}</div></div></article>`).join('')}</div>`;
  if (state.view === 'users') target.innerHTML = table(['Name', 'Email', 'Role', 'Manage'], records.map(r => `<tr><td><strong>${E(r.name)}</strong>${r.id === state.user.id ? '<span class="sub">Your account</span>' : ''}</td><td>${E(r.email)}</td><td>${badge(r.role)}</td><td>${editActions(r, 'users')}</td></tr>`), records.length);
}

function openDialog(title, body, eyebrow = 'A LITTLE CARE, EVERY DAY') {
  cleanupEditor();
  $('#dialog-title').textContent = title;
  $('#dialog-eyebrow').textContent = eyebrow;
  $('#dialog-body').innerHTML = body;
  $('#editor-dialog').showModal();
}

function closeDialog() { $('#editor-dialog').close(); }
function cleanupEditor() { if (state.editor?.objectUrl) URL.revokeObjectURL(state.editor.objectUrl); state.editor = null; }
function formError(form, message) { $('.form-error', form).textContent = message; }
function formActions(text = 'Save changes') { return `<p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">${icon('check')} ${E(text)}</button></div>`; }

function editor(kind, id) {
  if (!isAdmin()) return;
  const record = id ? (state.data[kind] || []).find(r => r.id === id) : {};
  if (!record) return;
  if (kind === 'users') {
    openDialog('Care for your café team.', `<form id="user-form" class="editor-form" data-id="${E(record.id)}"><p class="muted">${E(record.email)}</p><label>Full name<input name="name" required minlength="2" maxlength="100" value="${E(record.name)}"></label><label>Access role<select name="role">${['customer', 'staff', 'admin'].map(role => `<option value="${role}" ${record.role === role ? 'selected' : ''}>${role.charAt(0).toUpperCase() + role.slice(1)}</option>`).join('')}</select><small class="field-help">Staff manage orders and bookings. Admins also manage the menu, companions, and accounts.</small></label>${record.id === state.user.id ? '<p class="notice">Your current administrator account is protected from deletion and role changes.</p>' : ''}${formActions()}</form>`, 'PEOPLE & ACCESS');
    if (record.id === state.user.id) $('[name="role"]', $('#user-form')).disabled = true;
    return;
  }
  const upload = `<div class="upload-row">${image(record.image, 'Selected photo preview', 'upload-preview')}<label class="upload-label">${id ? 'Choose a new photo' : 'Upload a photo'}<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" ${id ? '' : 'required'}><small>JPEG, PNG, or WebP · maximum 3 MB.<br>Choose a file from your device.</small></label></div>`;
  const availability = `<label>Availability<select name="available"><option value="true" ${record.available !== false ? 'selected' : ''}>Available</option><option value="false" ${record.available === false ? 'selected' : ''}>Unavailable</option></select></label>`;
  const fields = kind === 'products' ? `<div class="form-grid"><label class="span-2">Item name<input name="name" required maxlength="100" value="${E(record.name)}" placeholder="A little treat for the menu"></label><label>Category<input name="category" list="categories" required maxlength="50" value="${E(record.category)}" placeholder="Cakes"><datalist id="categories"><option>Cakes</option><option>Pastries</option><option>Drinks</option><option>Pet treats</option><option>Merchandise</option></datalist></label><label>Price (PHP)<input type="number" name="price" min="1" max="100000" step="0.01" required value="${E(record.price)}" placeholder="180.00"></label><label>Stock available<input type="number" name="stock" min="0" max="100000" step="1" required value="${E(record.stock ?? 0)}"></label>${availability}<label class="span-2">Description<textarea name="description" maxlength="1000" required placeholder="What makes this little treat special?">${E(record.description)}</textarea></label></div>` : `<div class="form-grid"><label class="span-2">Companion’s name<input name="name" required maxlength="100" value="${E(record.name)}" placeholder="Meet our newest friend"></label><label>Species<input name="species" list="species-list" required maxlength="50" value="${E(record.species)}" placeholder="Cat"><datalist id="species-list"><option>Cat</option><option>Dog</option></datalist></label><label>Breed<input name="breed" required maxlength="80" value="${E(record.breed)}" placeholder="Domestic shorthair"></label><label>Age<input name="age" required maxlength="40" value="${E(record.age)}" placeholder="2 years"></label>${availability}<label class="span-2">Personality<input name="personality" required maxlength="250" value="${E(record.personality)}" placeholder="Gentle, curious, and fond of afternoon naps"></label><label class="span-2">A little introduction<textarea name="description" required maxlength="1000" placeholder="Help guests get to know this companion.">${E(record.description)}</textarea></label></div>`;
  openDialog(id ? `A little update for ${record.name}.` : kind === 'products' ? 'Something lovely for the menu.' : 'Welcome a little companion.', `<form id="catalog-form" class="editor-form" data-kind="${kind}" data-id="${E(id || '')}">${upload}${fields}${formActions(id ? 'Save changes' : kind === 'products' ? 'Add menu item' : 'Add companion')}</form>`, kind === 'products' ? 'MENU & SHOP' : 'OUR LITTLE COMPANIONS');
  state.editor = { kind, id, image: record.image || '', file: null, objectUrl: null };
}

function orderTransitions(order) {
  const route = order.fulfillment === 'delivery' ? ['placed', 'preparing', 'out_for_delivery', 'delivered'] : ['placed', 'preparing', 'ready_for_pickup', 'collected'];
  const index = route.indexOf(order.status);
  if (index < 0 || index === route.length - 1) return [];
  return [order.status, route[index + 1], 'cancelled'];
}

function orderDetail(id) {
  const order = (state.data.orders || []).find(r => r.id === id);
  if (!order) return;
  const transitions = orderTransitions(order);
  const coordinateLink = Number.isFinite(Number(order.lat)) && Number.isFinite(Number(order.lng)) && order.lat != null && order.lng != null ? `<a class="map-link" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(order.lat)}&mlon=${encodeURIComponent(order.lng)}#map=17/${encodeURIComponent(order.lat)}/${encodeURIComponent(order.lng)}" target="_blank" rel="noopener noreferrer">${icon('pin')} View delivery pin on map ↗</a>` : '';
  openDialog(`A little order, ${idShort(order.id)}.`, `<div class="detail-summary"><strong>${E(money(order.total))}</strong>${badge(order.status)}</div><dl class="detail-grid"><div><dt>Customer</dt><dd>${E(order.customerName || 'Guest')}</dd></div><div><dt>Phone</dt><dd>${E(order.phone || '—')}</dd></div><div><dt>Placed</dt><dd>${E(dateFormat(order.createdAt, { hour: 'numeric', minute: '2-digit' }))}</dd></div><div><dt>Fulfillment</dt><dd>${order.fulfillment === 'delivery' ? 'Delivery · cash on delivery' : 'Café pickup · pay at counter'}</dd></div>${order.fulfillment === 'delivery' ? `<div class="wide"><dt>Delivery address</dt><dd>${E(order.address || 'No address provided')}${coordinateLink}</dd></div>` : ''}${order.notes ? `<div class="wide"><dt>Customer notes</dt><dd>${E(order.notes)}</dd></div>` : ''}</dl><p class="section-label">A bag of lovely things</p><table class="order-lines"><tbody>${order.items.map(item => `<tr><td>${E(item.quantity)} × ${E(item.name)}<span class="sub">${E(money(item.price))} each</span></td><td>${E(money(Number(item.quantity) * Number(item.price)))}</td></tr>`).join('')}</tbody><tfoot><tr><td>Subtotal</td><td>${E(money(order.subtotal))}</td></tr><tr><td>Delivery fee</td><td>${E(money(order.deliveryFee || 0))}</td></tr><tr><td>Total · payment at fulfillment</td><td>${E(money(order.total))}</td></tr></tfoot></table><p class="section-label">Order journey</p><div class="timeline">${(order.history || []).map(h => `<div class="timeline-item"><strong>${E(statusLabels[h.status] || h.status)}</strong><small>${E(dateFormat(h.at, { year: undefined, hour: 'numeric', minute: '2-digit' }))}</small></div>`).join('')}</div>${transitions.length ? `<form id="order-form" class="order-status-form" data-id="${E(order.id)}"><label>Move this order along<select name="status" id="order-status">${transitions.map(status => `<option value="${status}" ${order.status === status ? 'selected' : ''}>${E(statusLabels[status])}${order.status === status ? ' · current status' : ''}</option>`).join('')}</select></label><div id="driver-fields" ${order.status === 'out_for_delivery' ? '' : 'hidden'}><p class="section-label">Rider location · manual updates</p><div class="form-grid"><label>Rider latitude<input type="number" name="driverLat" step="any" min="-90" max="90" value="${E(order.driverLat ?? '')}" placeholder="7.05372"></label><label>Rider longitude<input type="number" name="driverLng" step="any" min="-180" max="180" value="${E(order.driverLng ?? '')}" placeholder="125.58987"></label></div><p class="field-help" style="margin-top:8px">Enter both coordinates while out for delivery. Tracking uses your manual location updates.</p></div><p class="form-error" role="alert"></p><button class="button primary" type="submit">${icon('check')} Update order</button></form>` : '<p class="notice">This order has reached its final status.</p>'}`, 'FROM OUR CAFÉ TO YOUR DAY');
}

function reservationDetail(id) {
  const reservation = (state.data.reservations || []).find(r => r.id === id);
  if (!reservation) return;
  openDialog(`A lovely visit, ${idShort(reservation.id)}.`, `<div class="detail-summary"><strong>${E(reservation.customerName || 'Guest')}</strong>${badge(reservation.status)}</div><dl class="detail-grid"><div><dt>Visit date</dt><dd>${E(dateFormat(reservation.date))}</dd></div><div><dt>Time</dt><dd>${E(timeFormat(reservation.time))} · 1 hour</dd></div><div><dt>Guests</dt><dd>${E(reservation.guests)} ${Number(reservation.guests) === 1 ? 'person' : 'people'}</dd></div><div><dt>Companion</dt><dd>${E(reservation.petName || 'Any available companion')}</dd></div><div class="wide"><dt>Guest notes</dt><dd>${E(reservation.notes || 'No special requests.')}</dd></div></dl>${reservation.status === 'confirmed' ? `<form id="reservation-form" class="editor-form" data-id="${E(reservation.id)}"><label>Visit status<select name="status" required><option value="" disabled selected>Choose a status update</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>${formActions('Update reservation')}</form>` : '<p class="notice">This reservation has reached its final status.</p>'}`, 'MAKE ROOM FOR A LITTLE JOY');
}

function confirmDelete(kind, id) {
  if (!isAdmin()) return;
  const record = (state.data[kind] || []).find(r => r.id === id);
  if (!record) return;
  if (kind === 'users' && id === state.user.id) { toast('Your current account is protected from deletion.', true); return; }
  openDialog('A little room for change.', `<form id="delete-form" class="editor-form" data-kind="${E(kind)}" data-id="${E(id)}"><div><p class="confirm-title">Delete ${E(record.name)}?</p><p class="confirm-text">${kind === 'users' ? 'This removes this account. Accounts with existing orders or reservations cannot be deleted. Consider changing the role instead.' : 'This removes the item from the public café. Existing orders and reservations keep their original details. You can mark it unavailable instead if you plan to bring it back.'}</p></div><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button" type="button" data-action="close">Keep it</button><button class="button danger" type="submit">${icon('trash')} Delete ${kind === 'products' ? 'item' : kind === 'pets' ? 'companion' : 'account'}</button></div></form>`, 'PLEASE REVIEW');
}

function csvCell(value) { let text = String(value ?? ''); if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; }
function exportCSV() {
  let headers, rows;
  const records = state.view === 'overview' ? [] : filteredRecords();
  if (state.view === 'overview') { headers = ['Metric', 'Value']; rows = [['Completed revenue (PHP)', state.data.reports.revenue], ['Orders', state.data.reports.orders], ['Reservations', state.data.reports.reservations], ['Customers', state.data.reports.customers]]; }
  if (state.view === 'orders') { headers = ['Order ID', 'Customer', 'Phone', 'Fulfillment', 'Address', 'Subtotal (PHP)', 'Delivery fee (PHP)', 'Total (PHP)', 'Status', 'Created']; rows = records.map(r => [r.id, r.customerName, r.phone, r.fulfillment, r.address, r.subtotal, r.deliveryFee, r.total, r.status, r.createdAt]); }
  if (state.view === 'reservations') { headers = ['Reservation ID', 'Guest', 'Date', 'Time', 'Guests', 'Companion', 'Status', 'Notes']; rows = records.map(r => [r.id, r.customerName, r.date, r.time, r.guests, r.petName, r.status, r.notes]); }
  if (state.view === 'products') { headers = ['Item ID', 'Name', 'Category', 'Price (PHP)', 'Stock', 'Available']; rows = records.map(r => [r.id, r.name, r.category, r.price, r.stock, r.available]); }
  if (state.view === 'pets') { headers = ['Companion ID', 'Name', 'Species', 'Breed', 'Age', 'Personality', 'Available']; rows = records.map(r => [r.id, r.name, r.species, r.breed, r.age, r.personality, r.available]); }
  if (state.view === 'users') { headers = ['Account ID', 'Name', 'Email', 'Role']; rows = records.map(r => [r.id, r.name, r.email, r.role]); }
  if (!headers) return;
  const contents = '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `cake-galerie-${state.view}-${new Date().toISOString().slice(0, 10)}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Your café report is ready.');
}

document.addEventListener('click', async event => {
  const navigation = event.target.closest('[data-view]');
  if (navigation) { state.view = navigation.dataset.view; state.filter = { search: '', status: '', date: '' }; setSidebar(false); await loadView(); return; }
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const { action, id, kind, target } = control.dataset;
  if (action === 'reload') location.reload();
  if (action === 'refresh') await loadView();
  if (action === 'navigate') { state.view = target; state.filter = { search: '', status: '', date: '' }; await loadView(); }
  if (action === 'create') editor(state.view);
  if (action === 'edit') editor(kind, id);
  if (action === 'delete') confirmDelete(kind, id);
  if (action === 'close') closeDialog();
  if (action === 'order-detail') orderDetail(id);
  if (action === 'reservation-detail') reservationDetail(id);
  if (action === 'export') exportCSV();
});

document.addEventListener('input', event => {
  if (event.target.id === 'record-search') { state.filter.search = event.target.value; renderRecords(); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'record-status') { state.filter.status = event.target.value; renderRecords(); }
  if (event.target.id === 'record-date') { state.filter.date = event.target.value; renderRecords(); }
  if (event.target.id === 'order-status') $('#driver-fields').hidden = event.target.value !== 'out_for_delivery';
  if (event.target.name === 'photo' && state.editor) {
    const file = event.target.files[0];
    const form = event.target.form;
    const clearPreview = () => { state.editor.file = null; if (state.editor.objectUrl) URL.revokeObjectURL(state.editor.objectUrl); state.editor.objectUrl = null; $('.upload-preview', form).src = imagePath(state.editor.image); };
    if (!file) { clearPreview(); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) { formError(form, 'Choose a JPEG, PNG, or WebP image smaller than 3 MB.'); event.target.value = ''; clearPreview(); return; }
    formError(form, '');
    if (state.editor.objectUrl) URL.revokeObjectURL(state.editor.objectUrl);
    state.editor.file = file;
    state.editor.objectUrl = URL.createObjectURL(file);
    $('.upload-preview', form).src = state.editor.objectUrl;
  }
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['login-form', 'catalog-form', 'user-form', 'order-form', 'reservation-form', 'delete-form'].includes(form.id)) return;
  event.preventDefault();
  const values = new FormData(form);
  formError(form, '');
  setBusy(form, true);
  try {
    if (form.id === 'login-form') {
      const { user } = await api.post('/auth/login', { email: values.get('email').trim(), password: values.get('password') });
      state.user = user;
      if (!['admin', 'staff'].includes(user.role)) { showGate('This is a customer account. Use a café team account to open management.'); return; }
      form.reset(); await enterWorkspace(); return;
    }
    if (form.id === 'catalog-form') {
      const current = state.editor;
      if (!current) throw new Error('Please reopen this editor and try again.');
      let uploaded = current.image;
      if (current.file) uploaded = await api.upload(current.file);
      if (!uploaded) throw new Error('Please choose a photo file for this item.');
      const data = { name: values.get('name').trim(), description: values.get('description').trim(), available: values.get('available') === 'true', image: uploaded };
      if (current.kind === 'products') Object.assign(data, { category: values.get('category').trim(), price: Number(values.get('price')), stock: Number(values.get('stock')) });
      else Object.assign(data, { species: values.get('species').trim(), breed: values.get('breed').trim(), age: values.get('age').trim(), personality: values.get('personality').trim() });
      if (current.id) await api.put(`/${current.kind}/${encodeURIComponent(current.id)}`, data);
      else await api.post(`/${current.kind}`, data);
      toast(current.id ? 'A little update, saved with care.' : current.kind === 'pets' ? 'A new companion has joined the café.' : 'A lovely new item is on the menu.');
    }
    if (form.id === 'user-form') {
      const data = { name: values.get('name').trim() };
      if (values.get('role')) data.role = values.get('role');
      const updated = await api.put(`/users/${encodeURIComponent(form.dataset.id)}`, data);
      if (form.dataset.id === state.user.id) { state.user = { ...state.user, ...updated }; $('#account-name').textContent = state.user.name; $('#account-avatar').textContent = state.user.name.charAt(0).toUpperCase(); }
      toast('Account details updated.');
    }
    if (form.id === 'order-form') {
      const data = { status: values.get('status') };
      if (data.status === 'out_for_delivery') {
        const lat = values.get('driverLat').trim(), lng = values.get('driverLng').trim();
        if (Boolean(lat) !== Boolean(lng)) throw new Error('Enter both rider coordinates, or leave both empty.');
        if (lat && lng) { data.driverLat = Number(lat); data.driverLng = Number(lng); if (!Number.isFinite(data.driverLat) || !Number.isFinite(data.driverLng) || Math.abs(data.driverLat) > 90 || Math.abs(data.driverLng) > 180) throw new Error('Please enter valid rider coordinates.'); }
      }
      await api.put(`/orders/${encodeURIComponent(form.dataset.id)}`, data); toast('Order journey updated.');
    }
    if (form.id === 'reservation-form') { await api.put(`/reservations/${encodeURIComponent(form.dataset.id)}`, { status: values.get('status') }); toast('Reservation updated with care.'); }
    if (form.id === 'delete-form') { await api.delete(`/${form.dataset.kind}/${encodeURIComponent(form.dataset.id)}`); toast('Record removed.'); }
    closeDialog();
    await loadView();
  } catch (error) { formError(form, error.message || 'We could not save this change. Please try again.'); }
  finally { setBusy(form, false); }
});

$('#mobile-toggle').addEventListener('click', () => setSidebar(!$('#sidebar').classList.contains('open')));
$('#sidebar-shade').addEventListener('click', () => setSidebar(false));
$('#close-dialog').addEventListener('click', closeDialog);
$('#editor-dialog').addEventListener('close', cleanupEditor);
$('#editor-dialog').addEventListener('click', event => { if (event.target === $('#editor-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape') setSidebar(false); });
document.addEventListener('error', event => { if (event.target.tagName === 'IMG' && !event.target.dataset.fallback) { event.target.dataset.fallback = 'true'; event.target.src = './assets/hero.jpg'; } }, true);
$('#logout').addEventListener('click', async () => { const button = $('#logout'); button.disabled = true; try { await api.post('/auth/logout', {}); state.user = null; state.loadId++; state.view = 'overview'; state.data = {}; showGate(); setSidebar(false); toast('You’re signed out. See you soon.'); } catch (error) { toast(error.message || 'Could not sign out. Please try again.', true); } finally { button.disabled = false; } });
if ('ResizeObserver' in window) new ResizeObserver(() => document.documentElement.style.setProperty('--banner-height', `${$('#demo-banner').offsetHeight}px`)).observe($('#demo-banner'));

init();
