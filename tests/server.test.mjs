import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createApp } from '../server.mjs';

const ADMIN = { email: 'owner@example.test', password: 'UniqueAdminPass123!' };
const IMAGE = 'assets/test.jpg';
const product = { id: 'cake', name: 'Forest cake', category: 'Cake', description: 'A slice', price: 150, stock: 5, image: IMAGE, available: true };
const pet = { id: 'cat', name: 'Mochi', species: 'Cat', breed: 'Domestic', age: '2 years', personality: 'Gentle', description: 'Resident cat', image: IMAGE, available: true };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6i0AAAAASUVORK5CYII=';

async function fixture(t, settings = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'pet-cafe-test-'));
  await mkdir(path.join(rootDir, 'public', 'assets'), { recursive: true });
  await writeFile(path.join(rootDir, 'public', 'index.html'), '<!doctype html><title>Test café</title>');
  await writeFile(path.join(rootDir, 'public', 'seed.json'), JSON.stringify({ products: [product, { ...product, id: 'tea', name: 'Tea', price: 60, stock: 2 }], pets: [pet] }));
  const app = createApp({ rootDir, dataDir: path.join(rootDir, 'data'), now: () => new Date('2026-10-16T00:00:00Z'), ...settings, env: { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ...settings.env } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(rootDir, { recursive: true, force: true }); });
  // Optional test transport for environments that prohibit even loopback TCP.
  // npm test defaults to real HTTP. Both paths call the identical request handler.
  const httpFetch = process.env.CAFE_TEST_IN_PROCESS === '1' ? async (url, options = {}) => new Promise((resolve, reject) => {
    const parsed = new URL(url); const req = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    req.method = options.method ?? 'GET'; req.url = parsed.pathname + parsed.search;
    req.headers = { host: parsed.host, ...Object.fromEntries(Object.entries(options.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])) };
    req.socket = { remoteAddress: '127.0.0.1', encrypted: false };
    const headers = new Headers();
    const res = { statusCode: 200, headersSent: false, setHeader(name, value) { headers.set(name, String(value)); }, end(body) { this.headersSent = true; resolve(new Response(this.statusCode === 204 ? null : body, { status: this.statusCode, headers })); }, destroy() { reject(new Error('Response destroyed.')); } };
    Promise.resolve(app.server.listeners('request')[0](req, res)).catch(reject);
  }) : globalThis.fetch;
  const client = () => {
    let cookie = '';
    return {
      get cookie() { return cookie; },
      async request(route, method = 'GET', data, extraHeaders = {}) {
        const headers = { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders };
        const response = await httpFetch(`${base}/api${route}`, { method, headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
        if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        const text = await response.text();
        return { status: response.status, data: text ? JSON.parse(text) : null, headers: response.headers };
      },
      async register(email = 'customer@example.test') { const result = await this.request('/auth/register', 'POST', { name: 'Test Customer', email, password: 'CustomerPass123!' }); assert.equal(result.status, 201); return result.data.user; },
      async login(email = ADMIN.email, password = ADMIN.password) { const result = await this.request('/auth/login', 'POST', { email, password }); assert.equal(result.status, 201); return result.data.user; }
    };
  };
  const admin = client(); await admin.login();
  return { app, base, rootDir, client, admin, httpFetch };
}

test('passwords are salted, sessions opaque and logout invalidates them', async t => {
  const { app, client } = await fixture(t); const customer = client(); const user = await customer.register();
  assert.equal(user.role, 'customer'); assert.equal(user.password, undefined);
  const stored = app.db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id).password_hash;
  assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]{128}$/); assert.equal(stored.includes('CustomerPass123!'), false);
  assert.match(customer.cookie, /^cafe_session=[A-Za-z0-9_-]{43}$/);
  assert.equal((await customer.request('/auth/me')).data.user.id, user.id);
  assert.equal((await customer.request('/auth/login', 'POST', { email: user.email, password: 'incorrect' })).status, 401);
  await customer.request('/auth/logout', 'POST', {});
  assert.equal((await customer.request('/auth/me')).data.user, null);
  assert.equal((await customer.request('/orders')).status, 401);
});

test('cross-site writes and non-JSON writes are rejected', async t => {
  const { client, admin, base, httpFetch } = await fixture(t); const anonymous = client();
  assert.equal((await anonymous.request('/auth/register', 'POST', { name: 'Attacker', email: 'evil@example.test', password: 'Password123!' }, { Origin: 'https://evil.test' })).status, 403);
  const response = await httpFetch(`${base}/api/auth/login`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'text/plain' }, body: '{}' }); assert.equal(response.status, 415);
  const unauthorized = await anonymous.request('/users'); assert.equal(unauthorized.status, 401);
  const headers = (await admin.request('/users')).headers;
  assert.match(headers.get('content-security-policy'), /object-src 'none'/);
  assert.equal(headers.get('access-control-allow-origin'), base);
});

test('configured frontend origin receives credentialed CORS and secure cross-site cookies', async t => {
  const { base, client, httpFetch } = await fixture(t, { env: { FRONTEND_ORIGIN: 'https://student.github.io', NODE_ENV: 'production' } });
  const publicClient = client();
  const preflight = await httpFetch(`${base}/api/orders`, { method: 'OPTIONS', headers: { Origin: 'https://student.github.io', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://student.github.io'); assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  const login = await publicClient.request('/auth/login', 'POST', ADMIN, { Origin: 'https://student.github.io' }); assert.equal(login.status, 201); assert.match(login.headers.get('set-cookie'), /SameSite=None/); assert.match(login.headers.get('set-cookie'), /; Secure/);
  const rejected = await httpFetch(`${base}/api/orders`, { method: 'OPTIONS', headers: { Origin: 'https://attacker.github.io' } }); assert.equal(rejected.status, 403);
  assert.equal((await httpFetch(base)).headers.get('cache-control'), 'no-cache');
});

test('customer and staff roles cannot edit the catalog or manage accounts', async t => {
  const { client, admin } = await fixture(t); const customer = client(); const u = await customer.register();
  assert.equal((await customer.request('/products', 'POST', product)).status, 403);
  assert.equal((await customer.request('/users')).status, 403);
  assert.equal((await admin.request(`/users/${u.id}`, 'PUT', { role: 'staff' })).status, 200);
  assert.equal((await customer.request('/auth/me')).data.user, null, 'role changes invalidate existing sessions');
  await customer.login(u.email, 'CustomerPass123!');
  assert.equal((await customer.request('/reservations')).status, 200);
  assert.equal((await customer.request('/products/cake', 'PUT', { stock: 100 })).status, 403);
  assert.equal((await customer.request('/reports')).status, 200);
  const owner = (await admin.request('/auth/me')).data.user;
  assert.equal((await admin.request(`/users/${owner.id}`, 'PUT', { role: 'customer' })).status, 409);
  assert.equal((await admin.request(`/users/${owner.id}`, 'DELETE')).status, 409);
  assert.equal((await admin.request('/products/cake', 'PUT', { price: 0 })).status, 400);
});

test('concurrent reservations respect shared capacity and cancellation releases seats', async t => {
  const { client } = await fixture(t); const first = client(), second = client(), third = client(); await first.register('first@example.test'); await second.register('second@example.test'); await third.register('third@example.test');
  const booking = { date: '2026-10-17', time: '12:00', guests: 6, petId: 'cat', notes: '' };
  const clients = [first, second, third]; const results = await Promise.all(clients.map(customer => customer.request('/reservations', 'POST', booking)));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 201, 409]);
  assert.equal((await first.request('/availability?date=2026-10-17')).data.slots[0].remaining, 4);
  const winners = results.map((result, index) => ({ ...result, customer: clients[index] })).filter(result => result.status === 201);
  assert.equal((await winners[0].customer.request(`/reservations/${winners[0].data.id}`, 'PUT', { status: 'cancelled' })).status, 200);
  assert.equal((await first.request('/availability?date=2026-10-17')).data.slots[0].remaining, 10);
  assert.equal((await winners[1].customer.request(`/reservations/${winners[1].data.id}`, 'PUT', { status: 'cancelled' })).status, 200);
  assert.equal((await first.request('/availability?date=2026-10-17')).data.slots[0].remaining, 16);
  assert.equal((await first.request('/reservations', 'POST', { ...booking, guests: 7 })).status, 400);
  assert.equal((await first.request('/availability?date=2026-10-18')).data.slots.length, 0);
  assert.equal((await first.request('/reservations', 'POST', { ...booking, date: '2026-02-30' })).status, 400);
  assert.equal((await first.request('/reservations', 'POST', { ...booking, date: '2026-10-18' })).status, 400);
  assert.equal((await first.request('/reservations', 'POST', { ...booking, time: '19:00' })).status, 400);
});

const order = (overrides = {}) => ({ items: [{ productId: 'cake', quantity: 3 }], fulfillment: 'pickup', phone: '09171234567', notes: '', ...overrides });

test('concurrent orders cannot oversell and failed multi-item orders roll back stock', async t => {
  const { client, admin } = await fixture(t); const a = client(), b = client(); await a.register('a@example.test'); await b.register('b@example.test');
  const results = await Promise.all([a.request('/orders', 'POST', order()), b.request('/orders', 'POST', order())]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  let products = (await admin.request('/products')).data; assert.equal(products.find(p => p.id === 'cake').stock, 2);
  const rollback = await a.request('/orders', 'POST', order({ items: [{ productId: 'cake', quantity: 1 }, { productId: 'tea', quantity: 3 }] })); assert.equal(rollback.status, 409);
  products = (await admin.request('/products')).data; assert.equal(products.find(p => p.id === 'cake').stock, 2);
  assert.equal((await a.request('/orders', 'POST', order({ items: [{ productId: 'tea', quantity: 2 }, { productId: 'tea', quantity: 1 }] }))).status, 409, 'duplicate product lines are aggregated');
});

test('order ownership, server totals and one-time stock restoration are enforced', async t => {
  const { client, admin } = await fixture(t); const a = client(), b = client(); const aUser = await a.register('a@example.test'); await b.register('b@example.test');
  const placed = await a.request('/orders', 'POST', order({ items: [{ productId: 'cake', quantity: 1 }], total: 1, subtotal: 1, deliveryFee: 0 }));
  assert.equal(placed.data.total, 150); assert.equal(placed.data.items[0].price, 150); assert.match(placed.data.address, /Tulip Drive/);
  assert.equal((await b.request(`/orders/${placed.data.id}`, 'PUT', { status: 'cancelled' })).status, 403);
  assert.equal((await b.request('/orders')).data.length, 0);
  assert.equal((await a.request(`/orders/${placed.data.id}`, 'PUT', { status: 'cancelled' })).status, 200);
  assert.equal((await a.request(`/orders/${placed.data.id}`, 'PUT', { status: 'cancelled' })).status, 409);
  assert.equal((await a.request('/products')).data.find(p => p.id === 'cake').stock, 5);
  assert.equal((await admin.request(`/users/${aUser.id}`, 'DELETE')).status, 409, 'accounts with records are retained');
});

test('delivery status follows valid transitions and only team members update rider location', async t => {
  const { client, admin } = await fixture(t); const customer = client(); await customer.register();
  const placed = await customer.request('/orders', 'POST', order({ fulfillment: 'delivery', address: 'Tulip Drive, Davao City', lat: 7.058, lng: 125.594 }));
  assert.equal(placed.status, 201); assert.equal(placed.data.total, 510); assert.equal(placed.data.driverLat, null); assert.equal(placed.data.driverLng, null);
  const endpoint = `/orders/${placed.data.id}`;
  assert.equal((await admin.request(endpoint, 'PUT', { status: 'delivered' })).status, 409);
  assert.equal((await admin.request(endpoint, 'PUT', { status: 'preparing' })).status, 200);
  assert.equal((await customer.request(endpoint, 'PUT', { status: 'cancelled' })).status, 403);
  assert.equal((await admin.request(endpoint, 'PUT', { status: 'out_for_delivery', driverLat: 7.055, driverLng: 125.591 })).status, 200);
  assert.equal((await customer.request(endpoint, 'PUT', { status: 'out_for_delivery', driverLat: 7.056, driverLng: 125.592 })).status, 403);
  const delivered = await admin.request(endpoint, 'PUT', { status: 'delivered' }); assert.equal(delivered.data.driverLat, 7.058); assert.equal(delivered.data.history.length, 4);
  assert.equal((await admin.request(endpoint, 'PUT', { status: 'cancelled' })).status, 409);
  assert.equal((await admin.request('/reports')).data.revenue, 510);
  assert.equal((await customer.request('/orders', 'POST', order({ fulfillment: 'delivery', address: 'Far away address', lat: 8, lng: 125 }))).status, 400);
});

test('reservations are private and unavailable pets cannot be booked', async t => {
  const { client, admin } = await fixture(t); const a = client(), b = client(); await a.register('a@example.test'); await b.register('b@example.test');
  const booking = { date: '2026-10-17', time: '15:00', guests: 2, petId: 'cat' }; const created = await a.request('/reservations', 'POST', booking);
  assert.equal((await b.request(`/reservations/${created.data.id}`, 'PUT', { status: 'cancelled' })).status, 403);
  assert.equal((await b.request('/reservations')).data.length, 0);
  assert.equal((await a.request(`/reservations/${created.data.id}`, 'PUT', { status: 'completed' })).status, 403);
  assert.equal((await admin.request('/pets/cat', 'DELETE')).status, 409);
  assert.equal((await admin.request('/pets/cat', 'PUT', { available: false })).status, 200);
  assert.equal((await a.request('/reservations', 'POST', booking)).status, 400);
});

test('upload file content, MIME and size are validated and filenames are generated', async t => {
  const { client, admin, base, httpFetch } = await fixture(t); const customer = client(); await customer.register();
  const payload = { filename: '../../evil.png', type: 'image/png', data: PNG };
  assert.equal((await customer.request('/uploads', 'POST', payload)).status, 403);
  const uploaded = await admin.request('/uploads', 'POST', payload); assert.equal(uploaded.status, 201); assert.match(uploaded.data.image, /^uploads\/[a-f0-9-]+\.png$/);
  const served = await httpFetch(`${base}/${uploaded.data.image}`); assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal((await admin.request('/uploads', 'POST', { ...payload, type: 'image/jpeg' })).status, 400);
  assert.equal((await admin.request('/uploads', 'POST', { ...payload, data: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64') })).status, 400);
  assert.equal((await admin.request('/uploads', 'POST', { ...payload, data: Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64') })).status, 413);
  assert.equal((await admin.request('/products/cake', 'PUT', { image: 'https://example.test/cake.jpg' })).status, 400);
  const created = await admin.request('/pets', 'POST', { ...pet, name: 'New friend', image: uploaded.data.image }); assert.equal(created.status, 201); assert.equal(created.data.image, uploaded.data.image);
});

test('map proxy limits destinations and converts OSRM coordinates without external calls', async t => {
  const seen = [];
  const { client } = await fixture(t, { fetch: async url => { seen.push(url); return { ok: true, json: async () => url.includes('nominatim') ? [{ display_name: 'Tulip Drive, Davao City', lat: '7.054', lon: '125.59' }] : { routes: [{ geometry: { coordinates: [[125.58987, 7.05372], [125.59, 7.054]] }, distance: 523, duration: 131 }] } }; } });
  const publicClient = client(); const search = await publicClient.request('/geocode?q=Tulip'); assert.equal(search.status, 200); assert.equal(search.data[0].displayName, 'Tulip Drive, Davao City');
  assert.equal((await publicClient.request('/geocode?q=Tulip')).status, 200, 'identical search is cached');
  const routed = await publicClient.request('/route?lat=7.054&lng=125.59'); assert.deepEqual(routed.data.coordinates[0], [7.05372, 125.58987]); assert.equal(routed.data.durationMinutes, 3);
  assert.equal((await publicClient.request('/route?lat=9&lng=125')).status, 400); assert.equal((await publicClient.request('/route?lng=125')).status, 400); assert.equal(seen.length, 2);
});

test('static server never exposes database, environment or server source', async t => {
  const { base, httpFetch } = await fixture(t);
  for (const url of ['/server.mjs', '/.env', '/data/cafe.sqlite', '/%2e%2e/server.mjs', '/uploads/%2e%2e%2fserver.mjs']) { const response = await httpFetch(base + url); assert.equal(response.status, 404, url); }
  const page = await httpFetch(base); assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store'); assert.match(await page.text(), /Test café/);
});
