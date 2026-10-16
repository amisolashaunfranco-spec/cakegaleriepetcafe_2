// Browser-local preview only. Real authentication, authorization, SQL and uploads
// are implemented by server.mjs. This store is intentionally not a security boundary.
const KEY = 'cake-galerie-demo-v1';
const SESSION = 'cake-galerie-demo-session-v1';
const CONFIG = {name:'Cake Galerie Pet Café',capacity:16,openDays:[3,4,5,6],openTime:'12:00',closeTime:'19:00',cafe:{lat:7.05372,lng:125.58987,address:'1st Avenue, Tulip Drive, Juna Subdivision, Matina, Davao City'},deliveryRadiusKm:15,deliveryFee:60};
const ID = prefix => `${prefix}-${crypto.randomUUID().slice(0,8)}`;
const fail = message => { throw new Error(message); };
const textField = (value,label,min=1,max=1000) => {if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)fail(`${label} must contain ${min}–${max} characters.`);return value.trim();};
const numberField = (value,label,min,max,integer=false) => {if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))fail(`${label} must be ${integer?'a whole number':'a number'} between ${min} and ${max}.`);return value;};
const optionalText = (value,label,max=1000) => value==null?'':textField(value,label,0,max);
const imageField = value => {if(typeof value!=='string'||!(/^(assets|uploads)\/[a-zA-Z0-9_./-]+\.(jpg|jpeg|png|webp)$/i.test(value)||/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(value))||value.includes('..'))fail('Choose an uploaded image file. Photo URLs are not accepted.');return value;};
const safeUser = ({password,...user}) => user;
const now = () => new Date().toISOString();
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const distance = (lat,lng) => { const rad=x=>x*Math.PI/180; const a=Math.sin(rad(lat-CONFIG.cafe.lat)/2)**2+Math.cos(rad(lat))*Math.cos(rad(CONFIG.cafe.lat))*Math.sin(rad(lng-CONFIG.cafe.lng)/2)**2; return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); };

export class DemoStore {
  static async create() {
    const store = new DemoStore();
    try { store.data = JSON.parse(localStorage.getItem(KEY)); } catch {}
    if (!store.data?.version) {
      const response = await fetch(new URL('./seed.json',import.meta.url));
      if (!response.ok) fail('Could not load the café sample data.');
      const seed = await response.json();
      store.data = {version:1,products:seed.products,pets:seed.pets,reservations:[],orders:[],users:[
        {id:'demo-admin',name:'Café Manager',email:'admin@cakegalerie.test',password:'Admin123!',role:'admin'},
        {id:'demo-staff',name:'Café Staff',email:'staff@cakegalerie.test',password:'Staff123!',role:'staff'},
        {id:'demo-customer',name:'Café Guest',email:'guest@cakegalerie.test',password:'Guest123!',role:'customer'}]};
      store.save();
    }
    return store;
  }
  save() {
    try { localStorage.setItem(KEY,JSON.stringify(this.data)); }
    catch { fail('Browser storage is full or unavailable. Use a smaller image or run the server version.'); }
  }
  user() { return this.data.users.find(u=>u.id===sessionStorage.getItem(SESSION)); }
  auth(roles) { const user=this.user(); if (!user) fail('Please sign in to continue.'); if(roles && !roles.includes(user.role)) fail('Your account does not have access to this feature.'); return user; }
  availability(date) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||Number.isNaN(Date.parse(`${date}T00:00:00Z`))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date) fail('Choose a valid visit date.');
    if(date>`${Number(today().slice(0,4))+2}${today().slice(4)}`)fail('Reservations can be made up to two years in advance.');
    if(!CONFIG.openDays.includes(new Date(`${date}T12:00:00+08:00`).getUTCDay()) || date<today()) return {slots:[]};
    return {slots:Array.from({length:7},(_,i)=>{const time=`${i+12}:00`;const expired=new Date(`${date}T${time}:00+08:00`)<=new Date();return {time,remaining:expired?0:CONFIG.capacity-this.data.reservations.filter(r=>r.date===date&&r.time===time&&r.status!=='cancelled').reduce((n,r)=>n+r.guests,0)};})};
  }
  async request(method,path,body={}) {
    // Read fresh data so changes from another same-browser tab are reflected.
    try { const saved=JSON.parse(localStorage.getItem(KEY));if(saved?.version)this.data=saved; } catch {}
    const [route,query='']=path.split('?');const params=new URLSearchParams(query);const parts=route.split('/').filter(Boolean);const [resource,id]=parts;
    if(parts.length>2||!['GET','POST','PUT','DELETE'].includes(method))fail('This feature is unavailable.');
    const permitted={health:['GET'],config:['GET'],availability:['GET'],reports:['GET'],uploads:['POST'],geocode:['GET'],route:['GET'],auth:id==='me'?['GET']:['POST'],products:['GET','POST','PUT','DELETE'],pets:['GET','POST','PUT','DELETE'],users:['GET','PUT','DELETE'],orders:['GET','POST','PUT'],reservations:['GET','POST','PUT']};
    if(!permitted[resource]?.includes(method)||(['PUT','DELETE'].includes(method)&&!id)||(method==='POST'&&id&&resource!=='auth'))fail('This feature is unavailable.');
    if(resource==='health')return {ok:true};
    if(resource==='config')return structuredClone(CONFIG);
    if(resource==='auth') {
      if(id==='me')return {user:this.user()?safeUser(this.user()):null};
      if(id==='logout'){sessionStorage.removeItem(SESSION);return {user:null};}
      if(id==='login') {const user=this.data.users.find(u=>u.email===body.email?.trim().toLowerCase()&&u.password===body.password);if(!user)fail('Email or password is incorrect.');sessionStorage.setItem(SESSION,user.id);return {user:safeUser(user)};}
      if(id==='register') {const name=textField(body.name,'Name',2,100);const email=textField(body.email,'Email',3,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Enter a valid email address.');if(typeof body.password!=='string'||body.password.length<10||body.password.length>128)fail('Passwords must contain 10–128 characters.');if(this.data.users.some(u=>u.email===email))fail('That email is already registered.');const user={id:ID('usr'),name,email,password:body.password,role:'customer'};this.data.users.push(user);this.save();sessionStorage.setItem(SESSION,user.id);return {user:safeUser(user)};}
    }
    if(resource==='availability')return this.availability(params.get('date'));
    if(resource==='uploads'){
      this.auth(['admin']);textField(body.filename,'Filename',1,255);
      if(!['image/jpeg','image/png','image/webp'].includes(body.type)||typeof body.data!=='string'||!body.data||body.data.length>4194304)fail('Choose a JPG, PNG, or WebP image under 3 MB.');
      let raw;try{if(body.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data))throw new Error();raw=atob(body.data);if(btoa(raw)!==body.data)throw new Error();}catch{fail('Invalid image encoding.');}
      const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));let type;
      if(bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)type='image/jpeg';
      else if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)&&raw.slice(12,16)==='IHDR')type='image/png';
      else if(bytes.length>=20&&raw.slice(0,4)==='RIFF'&&raw.slice(8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(raw.slice(12,16)))type='image/webp';
      if(!type)fail('Choose a valid JPEG, PNG, or WebP image.');if(type!==body.type)fail('The file type does not match its image content.');
      return {image:`data:${body.type};base64,${body.data}`};
    }
    if(resource==='geocode'||resource==='route')return this.external(resource,params);
    if(resource==='reports') {this.auth(['admin','staff']);const paid=this.data.orders.filter(o=>['delivered','collected'].includes(o.status));return {revenue:paid.reduce((sum,o)=>sum+o.total,0),orders:this.data.orders.length,reservations:this.data.reservations.length,customers:this.data.users.filter(u=>u.role==='customer').length,lowStock:this.data.products.filter(p=>p.stock<6)};}
    if(['products','pets'].includes(resource)) {
      const list=this.data[resource];let item=list.find(p=>String(p.id)===id);
      if(method==='GET')return structuredClone(id?(item||fail('Record not found.')):list);
      this.auth(['admin']);
      if(method==='DELETE'){if(!item)fail('Record not found.');if(resource==='pets'&&this.data.reservations.some(r=>r.petId===id))fail('This pet has reservations. Mark it unavailable instead.');if(resource==='products'&&this.data.orders.some(o=>o.items.some(i=>i.productId===id)))fail('This item has order records. Mark it unavailable instead.');this.data[resource]=list.filter(p=>p.id!==id);this.save();return null;}
      if(method==='PUT'&&!item)fail('Record not found.');const data={...item,...body};
      if(data.available!==undefined&&typeof data.available!=='boolean')fail('Availability must be true or false.');
      const value={id:method==='POST'?ID(resource==='pets'?'pet':'prd'):id,name:textField(data.name,'Name',1,100),description:optionalText(data.description,'Description'),image:imageField(data.image),available:data.available!==false};
      if(resource==='products')Object.assign(value,{category:textField(data.category,'Category',1,50),price:Math.round(numberField(data.price,'Price',1,100000)*100)/100,stock:numberField(data.stock,'Stock',0,100000,true)});
      else Object.assign(value,{species:textField(data.species,'Species',1,50),breed:optionalText(data.breed,'Breed',80),age:textField(String(data.age??''),'Age',1,40),personality:optionalText(data.personality,'Personality',250)});
      if(method==='POST')list.push(value);else Object.assign(item,value);
      this.save();return structuredClone(value);
    }
    if(resource==='users'){
      const self=this.auth(['admin']);const item=this.data.users.find(u=>u.id===id);
      if(method==='GET')return this.data.users.map(safeUser);
      if(!item)fail('Account not found.');if(item.id===self.id)fail('You cannot change your own role or delete your own account.');
      if(method==='DELETE'){if(this.data.orders.some(o=>o.userId===id)||this.data.reservations.some(r=>r.userId===id))fail('This account has transaction records and cannot be deleted.');this.data.users=this.data.users.filter(u=>u.id!==id);this.save();return null;}
      if(!['admin','staff','customer'].includes(body.role))fail('Choose a valid role.');item.role=body.role;if(body.name?.trim())item.name=body.name.trim();this.save();return safeUser(item);
    }
    if(resource==='reservations') {
      const user=this.auth();const list=this.data.reservations;
      if(method==='GET')return structuredClone(list.filter(r=>user.role!=='customer'||r.userId===user.id));
      if(method==='POST'){
        const slots=this.availability(body.date).slots;const slot=slots.find(s=>s.time===body.time);const guests=numberField(body.guests,'Guests',1,6,true);const pet=this.data.pets.find(p=>p.id===body.petId&&p.available);
        if(!Number.isInteger(guests)||guests<1||guests>6)fail('Choose 1–6 guests.');if(!slot||slot.remaining<guests)fail('That time does not have enough seats. Choose another slot.');if(body.petId&&!pet)fail('That pet is not available.');
        const value={id:ID('RES'),userId:user.id,customerName:user.name,date:body.date,time:body.time,guests,petId:pet?.id||'',petName:pet?.name||'Any furry friend',notes:optionalText(body.notes,'Notes'),status:'confirmed',createdAt:now()};list.push(value);this.save();return structuredClone(value);
      }
      const item=list.find(r=>r.id===id);if(!item)fail('Reservation not found.');if(user.role==='customer'&&(item.userId!==user.id||body.status!=='cancelled'))fail('You can only cancel your own reservation.');if(item.status!=='confirmed')fail('This reservation is already closed.');if(!['cancelled','completed'].includes(body.status))fail('Choose a valid reservation status.');item.status=body.status;this.save();return structuredClone(item);
    }
    if(resource==='orders') {
      const user=this.auth();const list=this.data.orders;
      if(method==='GET')return structuredClone(id?(list.find(o=>o.id===id&&(user.role!=='customer'||o.userId===user.id))||fail('Order not found.')):list.filter(o=>user.role!=='customer'||o.userId===user.id));
      if(method==='POST') {
        if(!Array.isArray(body.items)||!body.items.length||body.items.length>50)fail('Add between 1 and 50 items to your order.');if(!['delivery','pickup'].includes(body.fulfillment))fail('Choose delivery or pickup.');
        if(!/^[+\d\s()-]{7,20}$/.test(body.phone||''))fail('Enter a valid contact number.');
        const merged=new Map();for(const row of body.items){const q=numberField(row.quantity,'Quantity',1,100,true);merged.set(row.productId,(merged.get(row.productId)||0)+q);if(merged.get(row.productId)>100)fail('Order at most 100 of one product.');}
        const items=[...merged].map(([productId,quantity])=>{const p=this.data.products.find(p=>p.id===productId);if(!p?.available||p.stock<quantity)fail('An item is unavailable or does not have enough stock.');return {productId,name:p.name,price:p.price,quantity};});
        if(body.fulfillment==='delivery'&&(!body.address?.trim()||!Number.isFinite(Number(body.lat))||!Number.isFinite(Number(body.lng))||distance(Number(body.lat),Number(body.lng))>15))fail('Choose a delivery pin within 15 km of the café and enter your address.');
        const subtotal=Math.round(items.reduce((n,i)=>n+i.price*i.quantity,0)*100)/100;const deliveryFee=body.fulfillment==='delivery'?60:0;const value={id:ID('CG'),userId:user.id,customerName:user.name,items,subtotal,deliveryFee,total:subtotal+deliveryFee,fulfillment:body.fulfillment,address:body.fulfillment==='delivery'?textField(body.address,'Delivery address',8,500):CONFIG.cafe.address,lat:body.fulfillment==='delivery'?Number(body.lat):CONFIG.cafe.lat,lng:body.fulfillment==='delivery'?Number(body.lng):CONFIG.cafe.lng,phone:body.phone,notes:optionalText(body.notes,'Notes'),status:'placed',createdAt:now(),history:[{status:'placed',at:now()}],driverLat:null,driverLng:null};
        items.forEach(i=>{this.data.products.find(p=>p.id===i.productId).stock-=i.quantity;});list.push(value);this.save();return structuredClone(value);
      }
      const item=list.find(o=>o.id===id);if(!item)fail('Order not found.');if(user.role==='customer'&&(item.userId!==user.id||item.status!=='placed'||body.status!=='cancelled'))fail('You can only cancel your own newly placed order.');
      const flow=item.fulfillment==='delivery'?['placed','preparing','out_for_delivery','delivered']:['placed','preparing','ready_for_pickup','collected'];
      if(['cancelled','delivered','collected'].includes(item.status))fail('This order is already closed.');
      if(!['cancelled',...flow].includes(body.status))fail('Choose a valid order status.');
      if(body.status!==item.status&&body.status!=='cancelled'&&flow[flow.indexOf(item.status)+1]!==body.status)fail('Follow the next step in the order status.');
      if(body.driverLat!==undefined||body.driverLng!==undefined){if(user.role==='customer'||item.fulfillment!=='delivery'||body.status!=='out_for_delivery')fail('Rider positions can only be updated by staff during delivery.');const lat=numberField(body.driverLat,'Latitude',-90,90),lng=numberField(body.driverLng,'Longitude',-180,180);if(distance(lat,lng)>15)fail('Rider position must be within the delivery area.');item.driverLat=lat;item.driverLng=lng;}
      if(body.status!==item.status){item.status=body.status;item.history.push({status:item.status,at:now()});if(item.status==='cancelled')item.items.forEach(i=>{const p=this.data.products.find(p=>p.id===i.productId);if(p)p.stock+=i.quantity;});if(item.status==='delivered'){item.driverLat=item.lat;item.driverLng=item.lng;}}
      this.save();return structuredClone(item);
    }
    fail('This feature is unavailable.');
  }
  async external(resource,params) {
    try {
      if(resource==='geocode') {
        const q=params.get('q')?.trim();if(!q||q.length<3)fail('Enter a place or street in Davao City.');
        const url=`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=ph&viewbox=125.45,7.20,125.75,6.95&bounded=1&q=${encodeURIComponent(q)}`;
        const response=await fetch(url,{signal:AbortSignal.timeout(9000)});if(!response.ok)throw new Error();return (await response.json()).map(r=>({name:r.display_name,lat:Number(r.lat),lng:Number(r.lon)}));
      }
      const lat=Number(params.get('lat')),lng=Number(params.get('lng'));if(!Number.isFinite(lat)||!Number.isFinite(lng)||distance(lat,lng)>15)fail('Choose a location within 15 km of the café.');
      const response=await fetch(`https://router.project-osrm.org/route/v1/driving/${CONFIG.cafe.lng},${CONFIG.cafe.lat};${lng},${lat}?overview=full&geometries=geojson`,{signal:AbortSignal.timeout(9000)});if(!response.ok)throw new Error();const route=(await response.json()).routes?.[0];if(!route)throw new Error();return {coordinates:route.geometry.coordinates.map(([x,y])=>[y,x]),distanceKm:route.distance/1000,durationMinutes:Math.ceil(route.duration/60)};
    } catch(e) { if(e.message.startsWith('Enter ')||e.message.startsWith('Choose '))throw e;fail('The map service is unavailable. You can still choose your pin on the map.'); }
  }
}
