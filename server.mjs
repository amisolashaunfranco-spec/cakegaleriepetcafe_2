import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = Object.freeze({ name: 'Cake Galerie / Pet Café', capacity: 16, openDays: [3, 4, 5, 6], openTime: '12:00', closeTime: '19:00', cafe: { lat: 7.05372, lng: 125.58987, address: '1st Avenue, Tulip Drive, Juna Subdivision, Matina, Davao City' }, deliveryRadiusKm: 15, deliveryFee: 60 });
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const SLOTS = Array.from({ length: 7 }, (_, i) => `${12 + i}:00`);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const hashToken = token => createHash('sha256').update(token).digest('hex');
const passwordHash = password => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; };
const passwordMatches = (password, stored) => { try { const [salt, key] = stored.split(':'); const actual = scryptSync(password, salt, 64); const expected = Buffer.from(key, 'hex'); return expected.length === actual.length && timingSafeEqual(actual, expected); } catch { return false; } };
const userResource = u => u ? ({ id: u.id, name: u.name, email: u.email, role: u.role }) : null;
const num = (v, label, min, max, integer = false) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) fail(400, `${label} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`); return v; };
const str = (v, label, min = 1, max = 250) => { if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) fail(400, `${label} must contain ${min}–${max} characters.`); return v.trim(); };
const optionalStr = (v, label, max = 1000) => v == null ? '' : str(v, label, 0, max);
const bool = (v, fallback = true) => { if (v === undefined) return fallback; if (typeof v !== 'boolean') fail(400, 'Availability must be true or false.'); return v; };
const emailValue = v => { const email = str(v, 'Email', 3, 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.'); return email; };
const coords = (lat, lng) => ({ lat: num(lat, 'Latitude', -90, 90), lng: num(lng, 'Longitude', -180, 180) });
function distanceKm(a, b) { const r = Math.PI / 180; const dlat = (b.lat - a.lat) * r, dlng = (b.lng - a.lng) * r; return 6371 * 2 * Math.asin(Math.sqrt(Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlng / 2) ** 2)); }
const withinDelivery = c => { if (distanceKm(CONFIG.cafe, c) > CONFIG.deliveryRadiusKm) fail(400, `Delivery is available within ${CONFIG.deliveryRadiusKm} km of the café.`); return c; };
const safeImage = value => { const v = str(value, 'Uploaded image', 1, 300); if (!/^(assets|uploads)\/[a-zA-Z0-9_./-]+\.(jpg|jpeg|png|webp)$/i.test(v) || v.includes('..') || v.includes('//')) fail(400, 'Choose an uploaded image file. Photo URLs are not accepted.'); return v; };

export function createApp(options = {}) {
  const env = options.env ?? process.env;
  const rootDir = path.resolve(options.rootDir ?? ROOT);
  const publicDir = path.join(rootDir, 'public');
  const dataDir = path.resolve(options.dataDir ?? env.DATA_DIR ?? path.join(rootDir, 'data'));
  const uploadDir = path.join(dataDir, 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  const db = new DatabaseSync(options.databasePath ?? path.join(dataDir, 'cafe.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','staff','customer')), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, price REAL NOT NULL CHECK(price>=0), stock INTEGER NOT NULL CHECK(stock>=0), image TEXT NOT NULL, available INTEGER NOT NULL CHECK(available IN (0,1)));
    CREATE TABLE IF NOT EXISTS pets(id TEXT PRIMARY KEY, name TEXT NOT NULL, species TEXT NOT NULL, breed TEXT NOT NULL, age TEXT NOT NULL, personality TEXT NOT NULL, description TEXT NOT NULL, image TEXT NOT NULL, available INTEGER NOT NULL CHECK(available IN (0,1)));
    CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), date TEXT NOT NULL, time TEXT NOT NULL, guests INTEGER NOT NULL CHECK(guests BETWEEN 1 AND 16), pet_id TEXT REFERENCES pets(id), notes TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('confirmed','completed','cancelled')), created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS reservations_slot ON reservations(date,time,status);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), items TEXT NOT NULL, subtotal REAL NOT NULL, delivery_fee REAL NOT NULL, total REAL NOT NULL, fulfillment TEXT NOT NULL CHECK(fulfillment IN ('delivery','pickup')), address TEXT NOT NULL, lat REAL, lng REAL, status TEXT NOT NULL, created_at TEXT NOT NULL, history TEXT NOT NULL, driver_lat REAL, driver_lng REAL, phone TEXT NOT NULL, notes TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const now = () => options.now ? new Date(options.now()) : new Date();
  const instant = () => now().toISOString();
  const stmt = sql => db.prepare(sql);
  function atomic(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }

  if (!stmt("SELECT value FROM settings WHERE key='seeded'").get()) {
    const seedFile = path.join(publicDir, 'seed.json');
    if (existsSync(seedFile)) {
      const seed = JSON.parse(readFileSync(seedFile, 'utf8'));
      atomic(() => {
        for (const p of seed.products ?? []) stmt('INSERT OR IGNORE INTO products VALUES(?,?,?,?,?,?,?,?)').run(String(p.id), p.name, p.category, p.description ?? '', p.price, p.stock, safeImage(p.image), Number(p.available !== false));
        for (const p of seed.pets ?? []) stmt('INSERT OR IGNORE INTO pets VALUES(?,?,?,?,?,?,?,?,?)').run(String(p.id), p.name, p.species, p.breed ?? '', String(p.age ?? ''), p.personality ?? '', p.description ?? '', safeImage(p.image), Number(p.available !== false));
        stmt("INSERT INTO settings VALUES('seeded','1')").run();
      });
    }
  }
  if (!stmt("SELECT id FROM users WHERE role='admin' LIMIT 1").get() && env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    const email = emailValue(env.ADMIN_EMAIL);
    if (env.ADMIN_PASSWORD.length < 12 || env.ADMIN_PASSWORD === 'replace-with-a-unique-16-character-password') throw new Error('Set ADMIN_PASSWORD to a unique password with at least 12 characters.');
    if (stmt('SELECT id FROM users WHERE email=?').get(email)) throw new Error('ADMIN_EMAIL belongs to an existing customer. Choose a different bootstrap email.');
    stmt('INSERT INTO users VALUES(?,?,?,?,?,?)').run(randomUUID(), str(env.ADMIN_NAME ?? 'Cafe administrator', 'Admin name', 1, 100), email, passwordHash(env.ADMIN_PASSWORD), 'admin', instant());
  }
  const frontendOrigin = env.FRONTEND_ORIGIN?.trim() || '';
  if (frontendOrigin && new URL(frontendOrigin).origin !== frontendOrigin) throw new Error('FRONTEND_ORIGIN must be an exact origin without a path or trailing slash.');
  const secureCookie = env.NODE_ENV === 'production' || Boolean(frontendOrigin);
  const sessionAge = 7 * 24 * 60 * 60 * 1000;
  const rateLimits = new Map();
  const fetcher = options.fetch ?? globalThis.fetch;
  let lastGeocode = 0;
  const geocodeCache = new Map();

  function cookie(res, token = '', maxAge = 0) { res.setHeader('Set-Cookie', `cafe_session=${token}; HttpOnly; Path=/; SameSite=${frontendOrigin ? 'None' : 'Lax'}; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`); }
  function newSession(res, user) { const token = randomBytes(32).toString('base64url'); stmt('INSERT INTO sessions VALUES(?,?,?)').run(hashToken(token), user.id, now().getTime() + sessionAge); cookie(res, token, sessionAge / 1000); }
  function session(req) { const raw = (req.headers.cookie ?? '').split(';').map(c => c.trim()).find(c => c.startsWith('cafe_session='))?.slice(13); if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null; return stmt('SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').get(hashToken(raw), now().getTime()) ?? null; }
  const requireUser = user => { if (!user) fail(401, 'Sign in to continue.'); return user; };
  const requireRole = (user, roles = ['admin']) => { requireUser(user); if (!roles.includes(user.role)) fail(403, 'Your account does not have permission for this action.'); };
  const ownerOrTeam = (user, row) => { requireUser(user); if (user.role === 'customer' && row.user_id !== user.id) fail(403, 'This record belongs to another customer.'); };
  function throttle(req, suffix, maximum = 18) { const key = `${req.socket.remoteAddress}:${suffix}`; const time = now().getTime(); const recent = (rateLimits.get(key) ?? []).filter(t => t > time - 15 * 60 * 1000); if (recent.length >= maximum) fail(429, 'Too many attempts. Please try again in 15 minutes.'); recent.push(time); rateLimits.set(key, recent); if (rateLimits.size > 5000) { for (const [k, values] of rateLimits) if (values.every(t => t <= time - 15 * 60 * 1000)) rateLimits.delete(k); } }
  function dateValue(value, future = true) { const date = str(value, 'Date', 10, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) fail(400, 'Choose a valid date.'); const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now()); if (future && date < today) fail(400, 'Choose today or a future date.'); if (date > `${Number(today.slice(0, 4)) + 2}${today.slice(4)}`) fail(400, 'Reservations can be made up to two years in advance.'); return date; }
  const openDate = date => CONFIG.openDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  const usedSeats = (date, time) => stmt("SELECT COALESCE(SUM(guests),0) AS used FROM reservations WHERE date=? AND time=? AND status!='cancelled'").get(date, time).used;
  const productResource = p => ({ ...p, available: Boolean(p.available) });
  const petResource = p => ({ ...p, available: Boolean(p.available) });
  const reservationResource = r => ({ id: r.id, userId: r.user_id, date: r.date, time: r.time, guests: r.guests, petId: r.pet_id, notes: r.notes, status: r.status, createdAt: r.created_at, customerName: r.customer_name, petName: r.pet_name ?? '' });
  const reservationSelect = 'SELECT r.*,u.name AS customer_name,p.name AS pet_name FROM reservations r JOIN users u ON u.id=r.user_id LEFT JOIN pets p ON p.id=r.pet_id';
  const readReservation = id => { const r = stmt(`${reservationSelect} WHERE r.id=?`).get(id); if (!r) fail(404, 'Reservation not found.'); return r; };
  const orderResource = r => ({ id: r.id, userId: r.user_id, items: JSON.parse(r.items), subtotal: r.subtotal, deliveryFee: r.delivery_fee, total: r.total, fulfillment: r.fulfillment, address: r.address, lat: r.lat, lng: r.lng, status: r.status, createdAt: r.created_at, history: JSON.parse(r.history), driverLat: r.driver_lat, driverLng: r.driver_lng, customerName: r.customer_name, phone: r.phone, notes: r.notes });
  const orderSelect = 'SELECT o.*,u.name AS customer_name FROM orders o JOIN users u ON u.id=o.user_id';
  const readOrder = id => { const r = stmt(`${orderSelect} WHERE o.id=?`).get(id); if (!r) fail(404, 'Order not found.'); return r; };
  const send = (res, status, value) => { res.statusCode = status; if (status === 204) return res.end(); res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
  async function body(req, max = 128 * 1024) { if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) fail(415, 'Send JSON with Content-Type: application/json.'); if (Number(req.headers['content-length']) > max) fail(413, 'The request is too large.'); const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > max) fail(413, 'The request is too large.'); chunks.push(chunk); } try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, 'Send a JSON object.'); return data; } catch (e) { if (e.status) throw e; fail(400, 'The request contains invalid JSON.'); } }
  async function remoteJSON(url, headers = {}) { try { const response = await fetcher(url, { headers, signal: AbortSignal.timeout(8000) }); if (!response.ok) fail(502, 'The map service is temporarily unavailable.'); return await response.json(); } catch (error) { if (error.status) throw error; fail(502, 'The map service did not respond. Please try again.'); } }

  async function api(req, res, url) {
    const route = url.pathname.slice(4).replace(/\/$/, '') || '/';
    const user = session(req);
    const method = req.method;
    if (method === 'GET' && route === '/health') return send(res, 200, { ok: true });
    if (method === 'GET' && route === '/config') return send(res, 200, CONFIG);
    if (method === 'GET' && route === '/auth/me') return send(res, 200, { user: userResource(user) });
    if (method === 'POST' && route === '/auth/register') {
      throttle(req, 'register', 12); const data = await body(req); const name = str(data.name, 'Name', 2, 100), email = emailValue(data.email), password = str(data.password, 'Password', 10, 128);
      if (stmt('SELECT id FROM users WHERE email=?').get(email)) fail(409, 'An account with that email already exists.');
      const account = { id: randomUUID(), name, email, role: 'customer' }; stmt('INSERT INTO users VALUES(?,?,?,?,?,?)').run(account.id, name, email, passwordHash(password), account.role, instant()); newSession(res, account); return send(res, 201, { user: account });
    }
    if (method === 'POST' && route === '/auth/login') {
      throttle(req, 'login'); const data = await body(req); const email = emailValue(data.email), password = str(data.password, 'Password', 1, 128); const account = stmt('SELECT * FROM users WHERE email=?').get(email);
      // Always perform a password derivation so unknown emails do not return immediately.
      const stored = account?.password_hash ?? '00000000000000000000000000000000:'.concat('00'.repeat(64));
      if (!passwordMatches(password, stored) || !account) fail(401, 'Email or password is incorrect.');
      const old = (req.headers.cookie ?? '').match(/(?:^|;\s*)cafe_session=([A-Za-z0-9_-]+)/)?.[1]; if (old) stmt('DELETE FROM sessions WHERE token_hash=?').run(hashToken(old)); newSession(res, account); return send(res, 201, { user: userResource(account) });
    }
    if (method === 'POST' && route === '/auth/logout') { const token = (req.headers.cookie ?? '').match(/(?:^|;\s*)cafe_session=([A-Za-z0-9_-]+)/)?.[1]; if (token) stmt('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token)); cookie(res); return send(res, 201, { user: null }); }
    if (method === 'GET' && (route === '/products' || route === '/pets')) { const table = route.slice(1); return send(res, 200, stmt(`SELECT * FROM ${table} ORDER BY rowid`).all().map(table === 'products' ? productResource : petResource)); }
    const catalog = route.match(/^\/(products|pets)(?:\/([^/]+))?$/);
    if (catalog && ['POST', 'PUT', 'DELETE'].includes(method)) {
      requireRole(user); const [, table, id] = catalog;
      if (method !== 'POST' && (!id || !stmt(`SELECT id FROM ${table} WHERE id=?`).get(id))) fail(404, 'Item not found.');
      if (method === 'POST' && id) fail(404, 'Route not found.');
      if (method === 'DELETE') { if (table === 'products' && stmt("SELECT id FROM orders WHERE EXISTS(SELECT 1 FROM json_each(orders.items) AS line WHERE json_extract(line.value,'$.productId')=?) LIMIT 1").get(id)) fail(409, 'This item has order records. Mark it unavailable instead.'); try { stmt(`DELETE FROM ${table} WHERE id=?`).run(id); } catch (e) { if (e.code?.startsWith('ERR_SQLITE')) fail(409, 'This pet has reservations. Mark it unavailable instead.'); throw e; } return send(res, 204); }
      const data = await body(req); const key = method === 'POST' ? randomUUID() : id; const current = id ? stmt(`SELECT * FROM ${table} WHERE id=?`).get(id) : {};
      const d = { ...current, ...data }; const name = str(d.name, 'Name', 1, 100), description = optionalStr(d.description, 'Description'), image = safeImage(d.image), available = Number(bool(data.available, current.available == null ? true : Boolean(current.available)));
      if (table === 'products') { const category = str(d.category, 'Category', 1, 50), price = Math.round(num(d.price, 'Price', 1, 100000) * 100) / 100, stock = num(d.stock, 'Stock', 0, 100000, true); stmt('INSERT INTO products VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,description=excluded.description,price=excluded.price,stock=excluded.stock,image=excluded.image,available=excluded.available').run(key, name, category, description, price, stock, image, available); }
      else { stmt('INSERT INTO pets VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,species=excluded.species,breed=excluded.breed,age=excluded.age,personality=excluded.personality,description=excluded.description,image=excluded.image,available=excluded.available').run(key, name, str(d.species, 'Species', 1, 50), optionalStr(d.breed, 'Breed', 80), str(String(d.age ?? ''), 'Age', 1, 40), optionalStr(d.personality, 'Personality', 250), description, image, available); }
      const item = stmt(`SELECT * FROM ${table} WHERE id=?`).get(key); return send(res, method === 'POST' ? 201 : 200, table === 'products' ? productResource(item) : petResource(item));
    }
    if (method === 'GET' && route === '/availability') { const date = dateValue(url.searchParams.get('date')); return send(res, 200, { slots: openDate(date) ? SLOTS.map(time => ({ time, remaining: new Date(`${date}T${time}:00+08:00`).getTime() <= now().getTime() ? 0 : Math.max(0, CONFIG.capacity - usedSeats(date, time)) })) : [] }); }
    if (method === 'GET' && route === '/reservations') { requireUser(user); const rows = user.role === 'customer' ? stmt(`${reservationSelect} WHERE r.user_id=? ORDER BY r.created_at DESC`).all(user.id) : stmt(`${reservationSelect} ORDER BY r.created_at DESC`).all(); return send(res, 200, rows.map(reservationResource)); }
    if (method === 'POST' && route === '/reservations') {
      requireUser(user); const data = await body(req); const date = dateValue(data.date), time = str(data.time, 'Time', 5, 5), guests = num(data.guests, 'Guests', 1, 6, true), notes = optionalStr(data.notes, 'Notes');
      if (!openDate(date) || !SLOTS.includes(time)) fail(400, 'Choose a Wednesday–Saturday session between 12:00 and 18:00.');
      if (new Date(`${date}T${time}:00+08:00`).getTime() <= now().getTime()) fail(400, 'Choose a future reservation time.');
      const petId = data.petId ? str(data.petId, 'Pet', 1, 100) : null;
      const id = randomUUID();
      atomic(() => { if (petId && !stmt('SELECT id FROM pets WHERE id=? AND available=1').get(petId)) fail(400, 'This pet is unavailable.'); if (usedSeats(date, time) + guests > CONFIG.capacity) fail(409, 'This session has too few remaining seats. Choose another time.'); stmt('INSERT INTO reservations VALUES(?,?,?,?,?,?,?,?,?)').run(id, user.id, date, time, guests, petId, notes, 'confirmed', instant()); });
      return send(res, 201, reservationResource(readReservation(id)));
    }
    const reservationMatch = route.match(/^\/reservations\/([^/]+)$/);
    if (method === 'PUT' && reservationMatch) { const r = readReservation(reservationMatch[1]); ownerOrTeam(user, r); const data = await body(req); const status = data.status; if (!['completed', 'cancelled'].includes(status)) fail(400, 'Choose completed or cancelled.'); if (user.role === 'customer' && status !== 'cancelled') fail(403, 'Customers may only cancel their own reservation.'); if (r.status !== 'confirmed') fail(409, 'This reservation is already closed.'); stmt('UPDATE reservations SET status=? WHERE id=?').run(status, r.id); return send(res, 200, reservationResource(readReservation(r.id))); }
    if (method === 'GET' && route === '/orders') { requireUser(user); const rows = user.role === 'customer' ? stmt(`${orderSelect} WHERE o.user_id=? ORDER BY o.created_at DESC`).all(user.id) : stmt(`${orderSelect} ORDER BY o.created_at DESC`).all(); return send(res, 200, rows.map(orderResource)); }
    if (method === 'POST' && route === '/orders') {
      requireUser(user); const data = await body(req);
      if (!['delivery', 'pickup'].includes(data.fulfillment)) fail(400, 'Choose delivery or pickup.');
      if (!Array.isArray(data.items) || !data.items.length || data.items.length > 50) fail(400, 'Add between 1 and 50 items to your order.');
      const aggregated = new Map(); for (const item of data.items) { if (!item || typeof item !== 'object') fail(400, 'Invalid order item.'); const productId = str(item.productId, 'Product', 1, 100), quantity = num(item.quantity, 'Quantity', 1, 100, true); aggregated.set(productId, (aggregated.get(productId) ?? 0) + quantity); if (aggregated.get(productId) > 100) fail(400, 'Order at most 100 of one product.'); }
      const delivery = data.fulfillment === 'delivery'; const destination = delivery ? withinDelivery(coords(data.lat, data.lng)) : CONFIG.cafe; const address = delivery ? str(data.address, 'Delivery address', 8, 500) : CONFIG.cafe.address; const phone = str(data.phone, 'Phone', 7, 30); if (!/^[+\d() .-]+$/.test(phone)) fail(400, 'Enter a valid phone number.'); const notes = optionalStr(data.notes, 'Notes'); const id = randomUUID(), createdAt = instant();
      atomic(() => { const items = []; for (const [productId, quantity] of aggregated) { const p = stmt('SELECT * FROM products WHERE id=? AND available=1').get(productId); if (!p || p.stock < quantity) fail(409, `An item is unavailable or has insufficient stock${p ? `: ${p.name}` : ''}.`); items.push({ productId: p.id, name: p.name, price: p.price, quantity }); const result = stmt('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').run(quantity, p.id, quantity); if (!result.changes) fail(409, 'Stock changed. Please refresh your cart.'); } const subtotal = Math.round(items.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100) / 100, fee = delivery ? CONFIG.deliveryFee : 0; stmt('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, user.id, JSON.stringify(items), subtotal, fee, subtotal + fee, data.fulfillment, address, destination.lat, destination.lng, 'placed', createdAt, JSON.stringify([{ status: 'placed', at: createdAt }]), null, null, phone, notes); });
      return send(res, 201, orderResource(readOrder(id)));
    }
    const orderMatch = route.match(/^\/orders\/([^/]+)$/);
    if (method === 'PUT' && orderMatch) {
      requireUser(user); const data = await body(req); const id = orderMatch[1];
      atomic(() => { const r = readOrder(id); ownerOrTeam(user, r); const status = data.status; const flow = r.fulfillment === 'delivery' ? ['placed', 'preparing', 'out_for_delivery', 'delivered'] : ['placed', 'preparing', 'ready_for_pickup', 'collected']; if (!['cancelled', ...flow].includes(status)) fail(400, 'Invalid order status.'); if (['delivered', 'collected', 'cancelled'].includes(r.status)) fail(409, 'This order is already closed.'); if (user.role === 'customer' && !(status === 'cancelled' && r.status === 'placed')) fail(403, 'Customers may only cancel their own newly placed order.'); if (status !== 'cancelled' && status !== r.status && flow.indexOf(status) !== flow.indexOf(r.status) + 1) fail(409, 'Advance the order one step at a time.'); if (status === r.status && user.role === 'customer') fail(403, 'Only staff can update tracking.');
        let driverLat = r.driver_lat, driverLng = r.driver_lng;
        if (data.driverLat !== undefined || data.driverLng !== undefined) { if (user.role === 'customer') fail(403, 'Only staff can update the rider location.'); if (r.fulfillment !== 'delivery' || status !== 'out_for_delivery') fail(400, 'Rider location can be updated only while out for delivery.'); const c = withinDelivery(coords(data.driverLat, data.driverLng)); driverLat = c.lat; driverLng = c.lng; }
        if (status === 'delivered') { driverLat = r.lat; driverLng = r.lng; }
        if (status === 'cancelled') for (const item of JSON.parse(r.items)) stmt('UPDATE products SET stock=stock+? WHERE id=?').run(item.quantity, item.productId);
        const history = JSON.parse(r.history); if (status !== r.status) history.push({ status, at: instant() }); stmt('UPDATE orders SET status=?,history=?,driver_lat=?,driver_lng=? WHERE id=?').run(status, JSON.stringify(history), driverLat, driverLng, id);
      }); return send(res, 200, orderResource(readOrder(id)));
    }
    if (method === 'GET' && route === '/users') { requireRole(user); return send(res, 200, stmt('SELECT id,name,email,role FROM users ORDER BY created_at').all()); }
    const userMatch = route.match(/^\/users\/([^/]+)$/);
    if (userMatch && ['PUT', 'DELETE'].includes(method)) {
      requireRole(user); const id = userMatch[1], target = stmt('SELECT * FROM users WHERE id=?').get(id); if (!target) fail(404, 'User not found.');
      if (method === 'DELETE') { if (target.id === user.id) fail(409, 'You cannot delete your own account.'); if (target.role === 'admin' && stmt("SELECT COUNT(*) AS count FROM users WHERE role='admin'").get().count <= 1) fail(409, 'Keep at least one administrator.'); if (stmt('SELECT id FROM orders WHERE user_id=? LIMIT 1').get(id) || stmt('SELECT id FROM reservations WHERE user_id=? LIMIT 1').get(id)) fail(409, 'This account has transaction records and cannot be deleted.'); stmt('DELETE FROM users WHERE id=?').run(id); return send(res, 204); }
      const data = await body(req); const name = data.name === undefined ? target.name : str(data.name, 'Name', 2, 100), role = data.role ?? target.role; if (!['admin', 'staff', 'customer'].includes(role)) fail(400, 'Choose a valid role.'); if (role !== 'admin' && target.role === 'admin' && (target.id === user.id || stmt("SELECT COUNT(*) AS count FROM users WHERE role='admin'").get().count <= 1)) fail(409, 'You cannot demote yourself or the last administrator.'); stmt('UPDATE users SET name=?,role=? WHERE id=?').run(name, role, id); if (role !== target.role) stmt('DELETE FROM sessions WHERE user_id=?').run(id); return send(res, 200, userResource(stmt('SELECT * FROM users WHERE id=?').get(id)));
    }
    if (method === 'POST' && route === '/uploads') {
      requireRole(user); throttle(req, 'upload', 60); const data = await body(req, 4.1 * 1024 * 1024 + 4096); str(data.filename, 'Filename', 1, 255); const contentType = str(data.type, 'File type', 1, 50); const base64 = str(data.data, 'Image data', 1, 4.1 * 1024 * 1024); if (base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) fail(400, 'Invalid image encoding.'); const buffer = Buffer.from(base64, 'base64'); if (buffer.toString('base64') !== base64) fail(400, 'Invalid image encoding.'); if (buffer.length > 3 * 1024 * 1024) fail(413, 'Images must be 3 MB or smaller.');
      let extension; if (buffer.length >= 12 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && buffer.at(-2) === 0xff && buffer.at(-1) === 0xd9) extension = 'jpg'; else if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.subarray(12,16).toString() === 'IHDR') extension = 'png'; else if (buffer.length >= 20 && buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.subarray(12,16).toString())) extension = 'webp'; else fail(400, 'This file is not a valid JPEG, PNG or WebP image.');
      if (contentType !== ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[extension])) fail(400, 'The file type does not match its image content.'); const filename = `${randomUUID()}.${extension}`; await writeFile(path.join(uploadDir, filename), buffer, { flag: 'wx' }); return send(res, 201, { image: `uploads/${filename}` });
    }
    if (method === 'GET' && route === '/reports') { requireRole(user, ['admin', 'staff']); const revenue = stmt("SELECT COALESCE(SUM(total),0) AS value FROM orders WHERE status IN ('delivered','collected')").get().value; return send(res, 200, { revenue, orders: stmt('SELECT COUNT(*) AS count FROM orders').get().count, reservations: stmt('SELECT COUNT(*) AS count FROM reservations').get().count, customers: stmt("SELECT COUNT(*) AS count FROM users WHERE role='customer'").get().count, lowStock: stmt('SELECT * FROM products WHERE stock<=5 ORDER BY stock').all().map(productResource) }); }
    if (method === 'GET' && route === '/geocode') { throttle(req, 'maps', 60); const q = str(url.searchParams.get('q'), 'Address search', 3, 200); const cached = geocodeCache.get(q.toLowerCase()); if (cached && cached.expires > now().getTime()) return send(res, 200, cached.data); if (now().getTime() - lastGeocode < 1100) fail(429, 'Please wait a moment before searching another address.'); lastGeocode = now().getTime(); const params = new URLSearchParams({ q: `${q}, Davao City, Philippines`, format: 'jsonv2', limit: '5', countrycodes: 'ph', viewbox: '125.44,7.20,125.75,6.91', bounded: '1' }); const result = await remoteJSON(`https://nominatim.openstreetmap.org/search?${params}`, { 'User-Agent': env.GEOCODE_USER_AGENT ?? 'CakeGalerieStudentProject/1.0', Accept: 'application/json' }); const found = result.map(item => ({ name: item.display_name, displayName: item.display_name, lat: Number(item.lat), lng: Number(item.lon) })).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng) && distanceKm(CONFIG.cafe, item) <= CONFIG.deliveryRadiusKm); geocodeCache.set(q.toLowerCase(), { data: found, expires: now().getTime() + 24 * 60 * 60 * 1000 }); if (geocodeCache.size > 500) geocodeCache.delete(geocodeCache.keys().next().value); return send(res, 200, found); }
    if (method === 'GET' && route === '/route') { throttle(req, 'maps', 60); const latText = url.searchParams.get('lat'), lngText = url.searchParams.get('lng'); if (!latText || !lngText) fail(400, 'Latitude and longitude are required.'); const destination = withinDelivery(coords(Number(latText), Number(lngText))); const result = await remoteJSON(`https://router.project-osrm.org/route/v1/driving/${CONFIG.cafe.lng},${CONFIG.cafe.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`); const route = result.routes?.[0]; if (!route?.geometry?.coordinates?.length) fail(502, 'No road route was found for this location.'); return send(res, 200, { coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]), distanceKm: Math.round(route.distance / 10) / 100, durationMinutes: Math.ceil(route.duration / 60) }); }
    fail(404, 'API route not found.');
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://www.ghibli.jp https://images.unsplash.com; connect-src 'self' https://nominatim.openstreetmap.org https://router.project-osrm.org; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    try {
      const host = req.headers.host ?? 'localhost'; const protocol = req.socket.encrypted || (env.TRUST_PROXY === 'true' && req.headers['x-forwarded-proto'] === 'https') ? 'https' : 'http';
      const url = new URL(req.url, `${protocol}://${host}`);
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        const origin = req.headers.origin; const sameOrigin = `${protocol}://${host}`; const allowedOrigin = origin === sameOrigin || (frontendOrigin && origin === frontendOrigin);
        if (origin && allowedOrigin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); }
        if (req.method === 'OPTIONS') { if (!origin || !allowedOrigin) fail(403, 'This origin is not allowed.'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return send(res, 204); }
        if (!['GET', 'HEAD'].includes(req.method) && ((origin && !allowedOrigin) || (!origin && req.headers['sec-fetch-site'] === 'cross-site'))) fail(403, 'Cross-site requests are not allowed.');
        return await api(req, res, url);
      }
      if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Method not allowed.');
      let decoded; try { decoded = decodeURIComponent(url.pathname); } catch { fail(400, 'Invalid path.'); }
      if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part === '..' || part.startsWith('.'))) fail(404, 'File not found.');
      const upload = decoded.startsWith('/uploads/'); if (upload && !/^\/uploads\/[a-f0-9-]+\.(jpg|png|webp)$/.test(decoded)) fail(404, 'File not found.');
      const base = upload ? uploadDir : publicDir; const relative = upload ? decoded.slice('/uploads/'.length) : decoded === '/' ? 'index.html' : decoded.slice(1); const target = path.resolve(base, relative);
      if (!target.startsWith(base + path.sep)) fail(404, 'File not found.');
      let info; try { info = await stat(target); } catch { fail(404, 'File not found.'); } if (!info.isFile()) fail(404, 'File not found.');
      const type = MIME[path.extname(target).toLowerCase()]; if (!type) fail(404, 'File not found.');
      const extension = path.extname(target).toLowerCase();
      const cacheControl = upload ? 'public, max-age=31536000, immutable' : env.NODE_ENV !== 'production' ? 'no-store' : ['.html', '.js', '.mjs', '.css', '.json', '.svg'].includes(extension) ? 'no-cache' : 'public, max-age=3600';
      res.setHeader('Content-Type', type); res.setHeader('Content-Length', info.size); res.setHeader('Cache-Control', cacheControl); if (req.method === 'HEAD') return res.end(); res.end(await readFile(target));
    } catch (error) { if (res.headersSent) { res.destroy(); return; } if (!error.status) console.error('Server error:', error); send(res, error.status ?? 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' }); }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  return { server, db, config: CONFIG, dataDir, close: async () => { await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }); db.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp(); const port = Number(process.env.PORT ?? 3000), host = process.env.HOST ?? '127.0.0.1';
  app.server.listen(port, host, () => { console.log(`Cake Galerie is ready at http://${host}:${app.server.address().port}`); if (!app.db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()) console.log('No administrator exists. Set ADMIN_EMAIL and a unique ADMIN_PASSWORD in .env, then restart.'); });
  const shutdown = async () => { try { await app.close(); process.exit(0); } catch { process.exit(1); } }; process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
