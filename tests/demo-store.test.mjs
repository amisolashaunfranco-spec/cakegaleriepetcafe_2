import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DemoStore } from '../public/demo-store.js';

// The GitHub Pages demo deliberately has browser-local, inspectable accounts.
// These tests exercise functional parity, not a browser storage security boundary.
const seed = JSON.parse(await readFile(new URL('../public/seed.json', import.meta.url), 'utf8'));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Z8S8AAAAASUVORK5CYII=';
class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(String(key)) ?? null; }
  setItem(key, value) { this.data.set(String(key), String(value)); }
  removeItem(key) { this.data.delete(String(key)); }
  clear() { this.data.clear(); }
}
async function createStore() {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true });
  globalThis.fetch = async input => {
    assert.ok(String(input).endsWith('/seed.json'), `Unexpected network request: ${input}`);
    return { ok: true, json: async () => structuredClone(seed) };
  };
  return DemoStore.create();
}
const login = (store, role = 'customer') => store.request('POST', '/auth/login', {
  email: role === 'customer' ? 'guest@cakegalerie.test' : `${role}@cakegalerie.test`,
  password: ({ customer: 'Guest123!', staff: 'Staff123!', admin: 'Admin123!' })[role],
});
const nextOpenDate = () => {
  const date = new Date(Date.now() + 14 * 86400000);
  while (date.getUTCDay() !== 3) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
const product = (overrides = {}) => ({ name: 'Tiny cloud cake', category: 'Cakes', description: 'A little slice of joy.', price: 185.25, stock: 30, image: 'assets/menu-cake.jpg', available: true, ...overrides });
const pet = (overrides = {}) => ({ name: 'Clover', species: 'Cat', breed: 'Domestic shorthair', age: '2 years', personality: 'Gentle and curious', description: 'A lovely café companion.', image: 'assets/pet-cat.jpg', available: true, ...overrides });
const pickup = (productId, quantity = 2, overrides = {}) => ({ items: [{ productId, quantity }], fulfillment: 'pickup', phone: '09123456789', notes: '', ...overrides });

test('static demo initializes sample accounts, public data, and browser persistence', async () => {
  const store = await createStore();
  assert.equal(store.data.users.length, 3);
  assert.equal((await store.request('GET', '/auth/me')).user, null);
  assert.equal((await store.request('GET', '/config')).capacity, 16);
  assert.ok((await store.request('GET', '/products')).length >= 1);
  assert.ok((await store.request('GET', '/pets')).length >= 1);
  await assert.rejects(store.request('GET', '/reports'), /sign in/i);
  await assert.rejects(store.request('GET', '/orders'), /sign in/i);
  const again = await DemoStore.create();
  assert.equal(again.data.users.length, 3);
});

test('registration always creates a customer, login omits passwords, and role restrictions apply', async () => {
  const store = await createStore();
  const { user } = await store.request('POST', '/auth/register', { name: 'New Friend', email: 'new@example.test', password: 'Friendly123!', role: 'admin' });
  assert.equal(user.role, 'customer');
  assert.equal(user.password, undefined);
  await assert.rejects(store.request('POST', '/auth/register', { name: 'Duplicate', email: 'NEW@example.test', password: 'Friendly123!' }), /already/i);
  await assert.rejects(store.request('POST', '/products', product()), /access/i);
  await assert.rejects(store.request('GET', '/users'), /access/i);
  await assert.rejects(store.request('POST', '/uploads', { filename: 'tiny.png', type: 'image/png', data: PNG }), /access/i);
  await store.request('POST', '/auth/logout');
  await assert.rejects(store.request('POST', '/auth/login', { email: 'new@example.test', password: 'wrong' }), /incorrect/i);
  const signedIn = await store.request('POST', '/auth/login', { email: 'NEW@example.test', password: 'Friendly123!' });
  assert.equal(signedIn.user.id, user.id);
  assert.equal(signedIn.user.password, undefined);
  await login(store, 'staff');
  assert.equal(typeof (await store.request('GET', '/reports')).revenue, 'number');
  await assert.rejects(store.request('POST', '/pets', pet()), /access/i);
  await assert.rejects(store.request('GET', '/users'), /access/i);
});

test('bookings share 16-seat capacity, completed bookings keep seats, cancellation releases them', async () => {
  const store = await createStore();
  await login(store);
  const date = nextOpenDate();
  const first = await store.request('POST', '/reservations', { date, time: '12:00', guests: 6 });
  const second = await store.request('POST', '/reservations', { date, time: '12:00', guests: 6 });
  await store.request('POST', '/reservations', { date, time: '12:00', guests: 4 });
  const remaining = async () => (await store.request('GET', `/availability?date=${date}`)).slots.find(s => s.time === '12:00').remaining;
  assert.equal(await remaining(), 0);
  await assert.rejects(store.request('POST', '/reservations', { date, time: '12:00', guests: 1 }), /seats|enough|remaining/i);
  await login(store, 'staff');
  await store.request('PUT', `/reservations/${first.id}`, { status: 'completed' });
  assert.equal(await remaining(), 0);
  await store.request('PUT', `/reservations/${second.id}`, { status: 'cancelled' });
  assert.equal(await remaining(), 6);
  await assert.rejects(store.request('PUT', `/reservations/${first.id}`, { status: 'cancelled' }), /closed/i);
  await login(store);
  await store.request('POST', '/reservations', { date, time: '12:00', guests: 5 });
  assert.equal(await remaining(), 1);
});

test('customers only see and cancel their own reservations and placed orders', async () => {
  const store = await createStore();
  await login(store);
  const item = (await store.request('GET', '/products'))[0];
  const reservation = await store.request('POST', '/reservations', { date: nextOpenDate(), time: '13:00', guests: 2 });
  const order = await store.request('POST', '/orders', pickup(item.id));
  await store.request('POST', '/auth/register', { name: 'Another Friend', email: 'other@example.test', password: 'Friendly123!' });
  assert.deepEqual(await store.request('GET', '/orders'), []);
  assert.deepEqual(await store.request('GET', '/reservations'), []);
  await assert.rejects(store.request('PUT', `/orders/${order.id}`, { status: 'cancelled' }), /own/i);
  await assert.rejects(store.request('PUT', `/reservations/${reservation.id}`, { status: 'cancelled' }), /own/i);
});

test('order prices come from the catalog, stock decrements atomically, and cancellation restores once', async () => {
  const store = await createStore();
  await login(store);
  const [item] = await store.request('GET', '/products');
  const initial = item.stock;
  const order = await store.request('POST', '/orders', pickup(item.id, 2, { items: [{ productId: item.id, quantity: 1, price: 0 }, { productId: item.id, quantity: 2, price: 0 }], total: 0 }));
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].quantity, 3);
  assert.equal(order.total, item.price * 3);
  assert.equal((await store.request('GET', '/products')).find(p => p.id === item.id).stock, initial - 3);
  await assert.rejects(store.request('POST', '/orders', pickup(item.id, 1, { items: [{ productId: item.id, quantity: 1 }, { productId: 'missing-product', quantity: 1 }] })), /unavailable|stock/i);
  assert.equal((await store.request('GET', '/products')).find(p => p.id === item.id).stock, initial - 3);
  await store.request('PUT', `/orders/${order.id}`, { status: 'cancelled' });
  assert.equal((await store.request('GET', '/products')).find(p => p.id === item.id).stock, initial);
  await assert.rejects(store.request('PUT', `/orders/${order.id}`, { status: 'cancelled' }), /closed|newly placed/i);
  assert.equal((await store.request('GET', '/products')).find(p => p.id === item.id).stock, initial);
});

test('admin uploads photo data and completes menu and pet CRUD without photo URLs', async () => {
  const store = await createStore();
  await login(store, 'admin');
  const upload = await store.request('POST', '/uploads', { filename: 'tiny.png', type: 'image/png', data: PNG });
  assert.ok(upload.image.startsWith('data:image/png;base64,'));
  const item = await store.request('POST', '/products', product({ image: upload.image }));
  assert.equal(item.image, upload.image);
  const updated = await store.request('PUT', `/products/${item.id}`, product({ image: upload.image, name: 'Updated cloud cake', stock: 4 }));
  assert.equal(updated.name, 'Updated cloud cake');
  await store.request('DELETE', `/products/${item.id}`);
  assert.ok(!(await store.request('GET', '/products')).some(p => p.id === item.id));
  const companion = await store.request('POST', '/pets', pet({ image: upload.image }));
  const newPet = await store.request('PUT', `/pets/${companion.id}`, pet({ name: 'Clover II', image: upload.image, available: false }));
  assert.equal(newPet.age, '2 years');
  assert.equal(newPet.available, false);
  await store.request('DELETE', `/pets/${companion.id}`);
  assert.ok(!(await store.request('GET', '/pets')).some(p => p.id === companion.id));
});

test('delivery transitions preserve rider coordinates, allow same-status staff saves, and arrive at destination', async () => {
  const store = await createStore();
  await login(store);
  const config = await store.request('GET', '/config');
  const [item] = await store.request('GET', '/products');
  const order = await store.request('POST', '/orders', pickup(item.id, 1, { fulfillment: 'delivery', address: 'Test Street, Matina, Davao City', lat: config.cafe.lat + 0.001, lng: config.cafe.lng + 0.001 }));
  await login(store, 'staff');
  await store.request('PUT', `/orders/${order.id}`, { status: 'preparing' });
  const outgoing = await store.request('PUT', `/orders/${order.id}`, { status: 'out_for_delivery', driverLat: config.cafe.lat, driverLng: config.cafe.lng });
  assert.equal(outgoing.driverLat, config.cafe.lat);
  assert.equal(outgoing.driverLng, config.cafe.lng);
  const same = await store.request('PUT', `/orders/${order.id}`, { status: 'out_for_delivery' });
  assert.equal(same.history.length, 3);
  const delivered = await store.request('PUT', `/orders/${order.id}`, { status: 'delivered' });
  assert.equal(delivered.driverLat, order.lat);
  assert.equal(delivered.driverLng, order.lng);
});

test('catalog rejects URLs, path traversal, incorrect types, over-limit values, and incomplete pets', async t => {
  const store = await createStore();
  await login(store, 'admin');
  const invalidProducts = [
    ['remote image', { image: 'https://example.test/photo.jpg' }],
    ['path traversal', { image: 'assets/../photo.jpg' }],
    ['name limit', { name: 'x'.repeat(101) }],
    ['category limit', { category: 'x'.repeat(51) }],
    ['description limit', { description: 'x'.repeat(1001) }],
    ['price limit', { price: 100001 }],
    ['stock limit', { stock: 100001 }],
    ['availability type', { available: 'true' }],
    ['price type', { price: '100' }],
    ['stock type', { stock: '100' }],
  ];
  for (const [label, value] of invalidProducts) await t.test(label, () => assert.rejects(store.request('POST', '/products', product(value))));
  await t.test('required pet species', () => assert.rejects(store.request('POST', '/pets', pet({ species: '' }))));
  await t.test('required pet age', () => assert.rejects(store.request('POST', '/pets', pet({ age: '' }))));
});

test('catalog prices are rounded to centavos and prices below PHP1 are rejected', async () => {
  const store = await createStore();
  await login(store, 'admin');
  const priced = await store.request('POST', '/products', product({ price: 12.345 }));
  assert.equal(priced.price, 12.35);
  await assert.rejects(store.request('POST', '/products', product({ price: 0 })));
});

test('catalog paths reject missing IDs, extra path segments, and IDs on POST', async t => {
  const store = await createStore();
  await login(store, 'admin');
  const [item] = await store.request('GET', '/products');
  await t.test('missing item', () => assert.rejects(store.request('PUT', '/products/not-a-real-id', product())));
  await t.test('POST with item ID', () => assert.rejects(store.request('POST', `/products/${item.id}`, product())));
  await t.test('extra URL segment', () => assert.rejects(store.request('PUT', `/products/${item.id}/extra`, product())));
});

test('catalog records linked to order or reservation history are protected from deletion', async t => {
  const store = await createStore();
  await login(store);
  const [item] = await store.request('GET', '/products');
  const [companion] = await store.request('GET', '/pets');
  const order = await store.request('POST', '/orders', pickup(item.id));
  const reservation = await store.request('POST', '/reservations', { date: nextOpenDate(), time: '14:00', guests: 2, petId: companion.id });
  await store.request('PUT', `/orders/${order.id}`, { status: 'cancelled' });
  await store.request('PUT', `/reservations/${reservation.id}`, { status: 'cancelled' });
  await login(store, 'admin');
  await t.test('product with cancelled order', () => assert.rejects(store.request('DELETE', `/products/${item.id}`)));
  await t.test('pet with cancelled booking', () => assert.rejects(store.request('DELETE', `/pets/${companion.id}`)));
});

test('photo upload rejects invalid base64 and bytes that do not match an image type', async t => {
  const store = await createStore();
  await login(store, 'admin');
  await t.test('invalid encoding', () => assert.rejects(store.request('POST', '/uploads', { filename: 'bad.png', type: 'image/png', data: 'not base64!' })));
  await t.test('non-image content', () => assert.rejects(store.request('POST', '/uploads', { filename: 'bad.png', type: 'image/png', data: Buffer.from('plain text, not a PNG image').toString('base64') })));
  await t.test('type mismatch', () => assert.rejects(store.request('POST', '/uploads', { filename: 'tiny.jpg', type: 'image/jpeg', data: PNG })));
});
