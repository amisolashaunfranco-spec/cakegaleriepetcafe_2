import { DemoStore } from './demo-store.js';

export const money = value => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

class CafeAPI {
  mode = 'server';
  user = null;
  ready = null;
  async init() {
    if (this.ready) return this.ready;
    this.ready = this.initialize();
    return this.ready;
  }
  async initialize() {
    this.base = (window.CAFE_CONFIG?.apiBase || '').replace(/\/$/, '');
    if (window.CAFE_CONFIG?.mode === 'demo') return this.startDemo();
    let response;
    try { response = await fetch(`${this.base}/api/health`, { credentials: 'include', signal: AbortSignal.timeout(7000) }); }
    catch { throw new Error('The café server could not be reached. Check your connection and try again.'); }
    if (response.status === 404 && !this.base) return this.startDemo();
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('The café server is unavailable. Please try again shortly.');
    const health = await response.json();
    if (!health.ok) throw new Error('The café server is not ready.');
    this.user = (await this.get('/auth/me')).user;
    return this;
  }
  async startDemo() {
    this.mode = 'demo';
    this.demo = await DemoStore.create();
    this.user = (await this.demo.request('GET', '/auth/me')).user;
    return this;
  }
  async request(method, path, body) {
    let data;
    if (this.mode === 'demo') data = await this.demo.request(method, path, body);
    else {
      let response;
      try {
        response = await fetch(`${this.base}/api${path}`, { method, credentials:'include', headers:body === undefined ? {} : {'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(20000) });
      } catch { throw new Error('Connection interrupted. Please check your connection and try again.'); }
      if (response.status === 204) return null;
      try { data = await response.json(); } catch { throw new Error('The server returned an unreadable response.'); }
      if (!response.ok) { const error = new Error(data.error || 'This request could not be completed.'); error.status = response.status; throw error; }
    }
    if (path.startsWith('/auth/')) this.user = data?.user || null;
    return data;
  }
  get(path) { return this.request('GET', path); }
  post(path, body) { return this.request('POST', path, body); }
  put(path, body) { return this.request('PUT', path, body); }
  delete(path) { return this.request('DELETE', path); }
  async upload(file) {
    if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.');
    if (file.size > 3 * 1024 * 1024) throw new Error('Images must be 3 MB or smaller.');
    const data = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(reader.result.split(',')[1]); reader.onerror=()=>reject(new Error('The image could not be read.')); reader.readAsDataURL(file); });
    const result = await this.post('/uploads', {filename:file.name,type:file.type,data});
    return result.image;
  }
  image(src) { return src?.startsWith('uploads/') && this.base ? `${this.base}/${src}` : src; }
}
export const api = new CafeAPI();
