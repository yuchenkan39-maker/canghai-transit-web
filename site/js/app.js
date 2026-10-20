import {parseLocal,hhmm,loadBundle,RouteIndex,fxRate} from './core.js';
import {NetworkFeed} from './live.js';
import {prepareLines} from './nearby.js?v=clean1';
import {directionChoices,boardingStops} from './boarding.js';
import {TABS,menuSections,matchRoutes} from './routemenu.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DEFAULT=['T7900','T7860','P0010','P0020'],portraits=['dog','gentleman','hamster','cat'];
const palette=['#2F7FED','#0E9F76','#8B5CF6','#E5487F','#C36C1E','#177E89','#8E5A9D','#657C28'];
let routes=[],byId=new Map(),shown=new Set(DEFAULT),buses=[],selected=null,feed=null,position=null,rate=null;
let menuOpen=false,menuTab='all';
let boardingRoute='',boardingOptions=[],boardingChoice=null,nearbyStop=null,ticket=0,selfMarker=null,accuracy=null,stopMarker=null;
const shapes=new Map(),loadingShapes=new Map(),markers=new Map();
try{const saved=JSON.parse(localStorage.getItem('transit.routes'));if(Array.isArray(saved)&&saved.every(x=>typeof x==='string'))shown=new Set(saved);}catch{}
const map=L.map('map',{minZoom:9,maxZoom:19,preferCanvas:true}).setView([3.1135,101.649],12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,className:'fresh-map',attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
const shapeLayer=L.layerGroup().addTo(map),stopLayer=L.layerGroup().addTo(map);
new ResizeObserver(()=>map.invalidateSize()).observe($('map'));
const routeName=id=>byId.get(id)?.name||id,color=id=>byId.get(id)?.color||'#777',portrait=id=>byId.get(id)?.portrait||'dog';
const age=ms=>{const n=Math.max(0,Math.round((Date.now()-ms)/1000));return n<60?n+' 秒前':Math.floor(n/60)+' 分钟前';};
function renderSelected(){
 $('selected-routes').innerHTML=[...shown].map(id=>'<button type="button" data-route="'+esc(id)+'" aria-label="移除 '+esc(routeName(id))+'" style="--route:'+color(id)+'"><i aria-hidden="true"></i>'+esc(routeName(id))+'<span aria-hidden="true">×</span></button>').join('');
 $('clear-routes').hidden=!shown.size;
}
// Route menu: opened by the "线路 ▾" button or by typing; stays open while several routes are ticked.
const optionHtml=r=>{const on=shown.has(r.id);return '<button type="button" class="route-option" data-route="'+esc(r.id)+'" aria-pressed="'+on+'" style="--route:'+r.color+'"><i class="swatch" aria-hidden="true"></i><b>'+esc(r.name)+'</b><span>'+esc(r.title)+'</span><em aria-hidden="true">'+(on?'✓':'+')+'</em></button>';};
function renderMenu(){
 const box=$('route-options');box.hidden=!menuOpen;$('route-menu').setAttribute('aria-expanded',String(menuOpen));
 if(!menuOpen){box.innerHTML='';return;}
 const query=$('route-search').value,searching=!!query.trim();
 const tabs=searching?'':'<div class="menu-tabs" role="group" aria-label="线路分类">'+TABS.map(([key,label])=>'<button type="button" data-tab="'+key+'" aria-pressed="'+(key===menuTab)+'">'+label+(key==='picked'?' · <span class="picked-count">'+shown.size+'</span>':'')+'</button>').join('')+'</div>';
 const body=menuSections(routes,{tab:menuTab,query,shown}).map(s=>(s.label?'<p class="menu-group">'+esc(s.label)+'</p>':'')+s.routes.map(optionHtml).join('')).join('')||'<p class="menu-empty">'+(searching?'没有匹配的线路':menuTab==='picked'?'还没选线路':'暂无线路')+'</p>';
 box.innerHTML=tabs+'<div class="menu-list">'+body+'</div><div class="menu-foot"><span>已选 <b class="picked-count">'+shown.size+'</b> 条</span><button type="button" data-done>完成</button></div>';
}
function syncMenu(){
 const box=$('route-options');if(box.hidden)return;
 box.querySelectorAll('.route-option').forEach(b=>{const on=shown.has(b.dataset.route);b.setAttribute('aria-pressed',String(on));b.querySelector('em').textContent=on?'✓':'+';});
 box.querySelectorAll('.picked-count').forEach(e=>e.textContent=shown.size);
}
function openMenu(){if(!menuOpen){menuOpen=true;renderMenu();}}
function closeMenu(focusToggle){if(!menuOpen)return;menuOpen=false;$('route-search').value='';renderMenu();if(focusToggle)$('route-menu').focus();}
async function getShape(id){
 if(shapes.has(id))return shapes.get(id);if(loadingShapes.has(id))return loadingShapes.get(id);
 const route=byId.get(id);if(!route)return null;
 const promise=fetch('network/'+route.file).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{
  const bundle=loadBundle({routes:[{id,name:route.name,lines:data.lines.map(l=>({dir:l.direction,headsign:l.headsign,shape:l.shape,stops:l.stops}))}]});
  bundle.lines.forEach((line,i)=>line.patternId=id+'/'+i);
  const result={...bundle,index:new RouteIndex(bundle.lines),prepared:prepareLines(bundle.lines)};shapes.set(id,result);return result;
 }).catch(()=>null).finally(()=>loadingShapes.delete(id));loadingShapes.set(id,promise);return promise;
}
async function drawShapes(){
 const ids=selected?[selected.split('/')[0]]:shown.size<=6?[...shown]:[];
 const bundles=await Promise.all(ids.map(getShape));shapeLayer.clearLayers();stopLayer.clearLayers();
 const drawn=[],weight=selected?6:5,line={lineCap:'round',lineJoin:'round',interactive:false};
 ids.forEach((id,i)=>{if(shown.has(id)&&bundles[i])for(const l of bundles[i].lines)drawn.push([id,l]);});
 // All white casings first, then the colours, so the two directions of a route never cut through each other.
 for(const [,l] of drawn)L.polyline(l.shape,{...line,color:'#fff',weight:weight+4,opacity:.95}).addTo(shapeLayer);
 for(const [id,l] of drawn)L.polyline(l.shape,{...line,color:color(id),weight,opacity:.92}).addTo(shapeLayer);
 if(map.getZoom()>=15)for(const [id,l] of drawn)for(const s of l.stops)L.circleMarker(s.pos,{radius:4,color:color(id),weight:2.5,fillColor:'#fff',fillOpacity:1}).bindTooltip(esc(s.name)).addTo(stopLayer);
 stopMarker?.bringToFront();
}
function applySelection(){selected=null;try{localStorage.setItem('transit.routes',JSON.stringify([...shown]));}catch{}feed?.setRoutes([...shown]);renderSelected();syncMenu();drawShapes();renderBuses();if(!$('nearby-panel').hidden)showNearby();}
function focusBus(bus){selected=bus.route+'/'+bus.id;map.flyTo(bus.pos,Math.max(15,map.getZoom()),{duration:.4});getShape(bus.route).then(()=>{drawShapes();renderBuses();});renderBuses();}
function renderBuses(){
 const visible=buses.filter(b=>shown.has(b.route)),seen=new Set();
 for(const bus of visible){const key=bus.route+'/'+bus.id;seen.add(key);let marker=markers.get(key);
  const html='<div class="marker'+(selected===key?' selected':'')+'" style="--route:'+color(bus.route)+'">'+(bus.angle==null?'':'<i class="arrow" style="transform:rotate('+bus.angle+'deg)"></i>')+'<img class="portrait" src="assets/crew/'+portrait(bus.route)+'.jpg" alt=""><b>'+esc(routeName(bus.route))+'</b></div>';
  if(!marker){marker=L.marker(bus.pos,{icon:L.divIcon({className:'',html,iconSize:[0,0]}),keyboard:false}).addTo(map);marker.on('click',()=>focusBus(marker.bus));markers.set(key,marker);}
  marker.bus=bus;marker.setLatLng(bus.pos);if(marker.html!==html){marker.setIcon(L.divIcon({className:'',html,iconSize:[0,0]}));marker.html=html;}marker.setZIndexOffset(selected===key?1000:0);
 }
 for(const [key,marker]of markers)if(!seen.has(key)){map.removeLayer(marker);markers.delete(key);}
 $('bus-count').textContent=visible.length+' 辆';
 $('vehicles').innerHTML=visible.slice().sort((a,b)=>Number(b.route+'/'+b.id===selected)-Number(a.route+'/'+a.id===selected)).slice(0,80).map(bus=>{
  const key=bus.route+'/'+bus.id,progress=shapes.get(bus.route)?.index.locate(bus.route,bus.pos,null,bus.angle);
  return '<button class="vehicle'+(key===selected?' selected':'')+'" data-key="'+esc(key)+'" style="--route:'+color(bus.route)+'"><img class="portrait" src="assets/crew/'+portrait(bus.route)+'.jpg" alt=""><span><b>'+esc(routeName(bus.route))+' · '+esc(bus.id)+'</b>'+(progress?.nextStop?'<span>'+esc(progress.nextStop)+'</span>':'')+'<small>'+(bus.speed==null?'':bus.speed+' km/h · ')+age(bus.gpsMs)+'</small></span></button>';
 }).join('')||'<p class="muted">'+(shown.size?'暂无车辆':'搜索并添加线路')+'</p>';
 $('vehicles').querySelectorAll('button').forEach(button=>button.onclick=()=>{const b=visible.find(b=>b.route+'/'+b.id===button.dataset.key);if(b)focusBus(b);});
}
function clearStop(){nearbyStop=null;if(stopMarker){map.removeLayer(stopMarker);stopMarker=null;}$('nearby-options').innerHTML='';}
async function showNearby(){
 $('nearby-panel').hidden=false;if(!shown.has(boardingRoute)){boardingRoute=shown.size===1?[...shown][0]:'';boardingChoice=null;}
 $('boarding-route').innerHTML='<option value="">选择线路</option>'+[...shown].map(id=>'<option value="'+esc(id)+'">'+esc(routeName(id))+'</option>').join('');$('boarding-route').value=boardingRoute;await loadBoardingRoute(boardingRoute);
}
async function loadBoardingRoute(id){
 const turn=++ticket;boardingRoute=id;clearStop();boardingOptions=[];$('boarding-direction').disabled=true;$('find-boarding').disabled=true;$('boarding-direction').innerHTML='<option value="">选择方向</option>';
 if(!id){boardingChoice=null;$('nearby-title').textContent=shown.size?'选择线路和方向':'请先添加线路';return;}
 const previous=boardingChoice?.route===id?boardingChoice.key:null,bundle=await getShape(id);if(turn!==ticket)return;
 if(!bundle){$('nearby-title').textContent='读取失败，请重选线路';return;}
 boardingOptions=directionChoices(bundle.prepared);$('boarding-direction').innerHTML='<option value="">选择方向</option>'+boardingOptions.map(o=>'<option value="'+esc(o.key)+'">'+esc(o.label.replace('（环线沿途站）',''))+'</option>').join('');$('boarding-direction').disabled=!boardingOptions.length;
 boardingChoice=boardingOptions.find(o=>o.key===previous)||null;$('boarding-direction').value=boardingChoice?.key||'';refreshStops();
}
function refreshStops(){
 clearStop();$('find-boarding').disabled=!boardingChoice;
 if(!boardingChoice){$('nearby-title').textContent='选择目的地方向';return;}if(!position){$('nearby-title').textContent='点击找站，获取位置';return;}
 const choices=boardingStops(boardingChoice,position);$('nearby-title').textContent='';
 $('nearby-options').innerHTML=choices.map((s,i)=>'<button data-stop="'+i+'">'+esc(s.name)+' <small>'+Math.round(s.distance)+' m</small></button>').join('')||'暂无站点';
 function selectStop(stop){nearbyStop=stop;if(stopMarker)map.removeLayer(stopMarker);stopMarker=L.circleMarker(stop.pos,{radius:7,color:'#287d65',weight:3,fillColor:'#fff',fillOpacity:1}).addTo(map).bindTooltip(esc(stop.name),{permanent:true,direction:'top'});map.fitBounds(L.latLngBounds([position,stop.pos]),{padding:[45,45],maxZoom:16});$('nearby-options').querySelectorAll('button').forEach((b,i)=>b.classList.toggle('on',choices[i]===stop));}
 $('nearby-options').querySelectorAll('button').forEach(b=>b.onclick=()=>selectStop(choices[Number(b.dataset.stop)]));if(choices.length)selectStop(choices[0]);
}
$('boarding-route').onchange=()=>{boardingChoice=null;loadBoardingRoute($('boarding-route').value);};
$('boarding-direction').onchange=()=>{boardingChoice=boardingOptions.find(o=>o.key===$('boarding-direction').value)||null;refreshStops();};
$('find-boarding').onclick=()=>{if(boardingChoice)position?refreshStops():$('locate').click();};
$('nearest-stop').onclick=()=>{$('nearby-panel').hidden?showNearby():($('nearby-panel').hidden=true);};
$('route-menu').onclick=()=>menuOpen?closeMenu():openMenu();
$('route-search').onfocus=openMenu;
$('route-search').oninput=()=>{menuOpen=true;renderMenu();};
$('route-search').onkeydown=e=>{
 const input=e.target;
 if(e.key==='Escape'){if(input.value){input.value='';renderMenu();}else closeMenu(true);}
 else if(e.key==='Enter'){const first=matchRoutes(routes,input.value)[0];if(first){e.preventDefault();shown.add(first.id);input.value='';applySelection();renderMenu();}}
};
$('route-options').onclick=e=>{
 const option=e.target.closest('[data-route]'),tab=e.target.closest('[data-tab]');
 if(option){const id=option.dataset.route;shown.has(id)?shown.delete(id):shown.add(id);applySelection();}
 else if(tab){menuTab=tab.dataset.tab;renderMenu();}
 else if(e.target.closest('[data-done]'))closeMenu(true);
};
// composedPath keeps the original ancestors even when a click re-rendered (detached) its target.
document.addEventListener('click',e=>{if(menuOpen&&!e.composedPath().includes($('route-picker')))closeMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menuOpen&&e.target!==$('route-search'))closeMenu(true);});
$('selected-routes').onclick=e=>{const chip=e.target.closest('[data-route]');if(chip){shown.delete(chip.dataset.route);applySelection();}};
$('clear-routes').onclick=()=>{shown.clear();applySelection();};
$('fit').onclick=()=>{const points=buses.filter(b=>shown.has(b.route)).map(b=>b.pos);if(position)points.push(position);if(points.length)map.fitBounds(L.latLngBounds(points),{padding:[50,50],maxZoom:15});};
$('locate').onclick=()=>{
 const status=$('location-status');if(!navigator.geolocation){status.textContent='无法定位';return;}$('locate').disabled=true;status.textContent='定位中…';
 navigator.geolocation.getCurrentPosition(p=>{$('locate').disabled=false;position={lat:p.coords.latitude,lng:p.coords.longitude};if(selfMarker)map.removeLayer(selfMarker);if(accuracy)map.removeLayer(accuracy);
  selfMarker=L.marker(position,{icon:L.divIcon({className:'',html:'<div class="location-dot"></div>',iconSize:[16,16],iconAnchor:[8,8]})}).addTo(map);accuracy=L.circle(position,{radius:p.coords.accuracy,color:'#458dd4',weight:1,fillOpacity:.06}).addTo(map);map.setView(position,15);status.textContent='± '+Math.round(p.coords.accuracy)+' m';if(boardingChoice)refreshStops();
 },e=>{$('locate').disabled=false;status.textContent=e.code===1?'未允许定位':'定位失败，请重试';},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
};
map.on('zoomend',drawShapes);
async function weather(){
  try{
    const q=new URLSearchParams({latitude:3.1209,longitude:101.6538,current:"temperature_2m,apparent_temperature,weather_code",hourly:"precipitation_probability,temperature_2m",forecast_days:2,timezone:"Asia/Kuala_Lumpur"});
    const r=await fetch("https://api.open-meteo.com/v1/forecast?"+q,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const d=await r.json();
    const hours=d.hourly.time.map((t,i)=>({t:parseLocal(t),p:d.hourly.precipitation_probability[i],temp:d.hourly.temperature_2m[i]})).filter(x=>x.t>=Date.now()).slice(0,8);
    $("weather").innerHTML='<p>马大 · '+esc(d.current.time.replace("T"," "))+'</p><span class="rate">'+esc(d.current.temperature_2m)+'°C</span><span>　体感 '+esc(d.current.apparent_temperature)+'°C</span><div class="hourly">'+hours.map(x=>'<div class="hour">'+hhmm(x.t)+'<small>'+esc(x.temp)+'°C</small><small>雨 '+(x.p==null?"未知":esc(x.p)+"%")+'</small></div>').join("")+'</div>';
  }catch(e){$("weather").textContent="天气暂不可用";}
}
function conversion(){const n=Number($("amount").value);$("conversion").textContent=rate&&Number.isFinite(n)&&n>=0?n.toLocaleString()+" 令吉 ≈ "+(n*rate).toFixed(2)+" 元":"";}
$("amount").oninput=conversion;
async function fx(){
  try{const r=await fetch("https://api.frankfurter.dev/v1/latest?base=MYR&symbols=CNY",{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const d=await r.json();rate=d.rates.CNY;if(!Number.isFinite(rate))throw Error();$("fx").innerHTML='<p>1 令吉 = <span class="rate">'+fxRate(rate)+'</span> 元</p><p class="muted">'+esc(d.date)+'</p>';conversion();}catch(e){$("fx").textContent="汇率暂不可用";}
}
async function main(){
 weather();fx();setInterval(weather,600000);setInterval(fx,10800000);
 try{
  const response=await fetch('network/catalog.json');if(!response.ok)throw Error();const catalog=await response.json();
  // The four home routes keep the main app's colours and portraits; the rest take turns through the palette.
  routes=catalog.routes.filter(r=>r.category==='rapid-bus-kl').map((r,i)=>{const home=DEFAULT.indexOf(r.id);return {...r,color:home>=0?palette[home]:palette[i%palette.length],portrait:home>=0?portraits[home]:portraits[i%4]};});
  byId=new Map(routes.map(r=>[r.id,r]));shown=new Set([...shown].filter(id=>byId.has(id)));renderSelected();renderMenu();drawShapes();let scheduled=false;
  feed=new NetworkFeed({routes:[...shown],onUpdate:list=>{buses=list;if(!scheduled){scheduled=true;setTimeout(()=>{scheduled=false;renderBuses();},250);}},onStatus:s=>{$('connection').textContent=s.connected?'实时':'连接中';$('connection').classList.toggle('online',s.connected);}});feed.start();renderBuses();
 }catch{$('connection').textContent='加载失败';}
}
window.addEventListener('pagehide',()=>feed?.stop());window.addEventListener('pageshow',e=>{if(e.persisted)feed?.start();});main();
