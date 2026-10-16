import { api, esc } from './api.js';

export class DeliveryMap {
  constructor(container, config, options={}) {
    this.config=config;this.options=options;this.container=container;
    if(!window.L){container.innerHTML='<p class="hint" style="padding:20px">The map could not load. Refresh the page to try again.</p>';return;}
    this.map=L.map(container,{scrollWheelZoom:false}).setView([config.cafe.lat,config.cafe.lng],13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(this.map);
    this.marker([config.cafe.lat,config.cafe.lng],'Café','cafe').addTo(this.map).bindPopup('Cake Galerie · café pickup');
    if(options.selectable)this.map.on('click',e=>this.select(e.latlng.lat,e.latlng.lng));
    setTimeout(()=>this.map?.invalidateSize(),100);
  }
  marker(coords,text,type){return L.marker(coords,{icon:L.divIcon({className:'map-pin',html:`<span class="map-label ${type}">${esc(text)}</span>`,iconSize:[60,28],iconAnchor:[30,28]})});}
  async select(lat,lng) {
    if(!this.map)return;
    lat=Number(lat);lng=Number(lng);this.position={lat,lng};
    if(this.destination)this.destination.remove();this.destination=this.marker([lat,lng],'Your door','destination').addTo(this.map);
    this.map.panTo([lat,lng]);this.options.onSelect?.({lat,lng});
    return this.route(lat,lng);
  }
  async route(lat,lng) {
    const token=Symbol();this.routeToken=token;
    try {
      const result=await api.get(`/route?lat=${lat}&lng=${lng}`);
      if(this.routeToken!==token||!this.map)return;
      this.line?.remove();this.line=L.polyline(result.coordinates,{color:'#697e47',weight:4,opacity:.8}).addTo(this.map);
      this.map.fitBounds(this.line.getBounds(),{padding:[35,35],maxZoom:15});this.options.onRoute?.(result);
    } catch(e){if(this.routeToken===token)this.options.onError?.(e.message);}
  }
  async track(order) {
    if(!this.map)return;
    await this.select(order.lat,order.lng);
    if(Number.isFinite(order.driverLat)&&Number.isFinite(order.driverLng))this.marker([order.driverLat,order.driverLng],'Rider','rider').addTo(this.map);
  }
  destroy(){this.routeToken=null;this.map?.remove();this.map=null;}
}
