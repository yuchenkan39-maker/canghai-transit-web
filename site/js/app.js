import { parseLocal, myt, hhmm, loadBundle, RouteIndex, routeById, fxPoints, fxView, fxRate } from "./core.js";
import { NetworkFeed, requestSpacing } from "./live.js";
import { prepareLines, nearbyStops, stopArrivals, TrafficHistory } from "./nearby.js?v=eta2";
import { HistoricalProfiles } from "./prediction.js";
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const DEFAULT=["T7900","T7860","P0010","P0020"];
const palette=["#2F7FED","#0E9F76","#8B5CF6","#E5487F","#C36C1E","#177E89","#8E5A9D","#657C28"];
const portraits=["dog","gentleman","hamster","cat"];
let routes=[],byId=new Map(),shown=new Set(DEFAULT),buses=[],selected=null,feed=null,position=null,rate=null,latestFeedTime=null,savedSelection=false;
const shapes=new Map(),loadingShapes=new Map(),markers=new Map();
let nearbyActive=false,nearbyTicket=0,nearbyLines=[],nearbyChoices=[],nearbyStop=null,stopMarker=null,locationTime=0,locationAccuracy=0;
const trafficHistory=new TrafficHistory();
const historical=new HistoricalProfiles(),historyRequests=new Map();let historyReady=null;
function loadHistorical(){
  if(historyReady)return historyReady;
  historyReady=fetch('history/catalog.json',{signal:AbortSignal.timeout(15000)}).then(r=>{if(!r.ok)throw Error('历史参考暂不可用');return r.json();}).then(c=>{
    historical.setCatalog(c);if(!historical.catalog)throw Error('历史数据格式不匹配');
    $('prediction-status').textContent='历史参考：'+c.sourceMonth+' · '+Object.keys(c.routes).length+' 条线路 · 工作日／周末、时段及方向分开统计。未覆盖路段使用车速估算；未接入商业道路路况。';
    return c;
  }).catch(()=>{$('prediction-status').textContent='历史参考暂不可用，当前使用实时公交车速估算。';return null;});
  return historyReady;
}
function ensureHistorical(id){
  if(historyRequests.has(id))return historyRequests.get(id);
  const promise=loadHistorical().then(async c=>{
    const entry=c?.routes?.[id];if(!entry)return;
    const r=await fetch('history/'+entry.file,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('历史线路未读取');
    historical.setRoute(id,await r.json());renderNearby();
  }).catch(()=>{historyRequests.delete(id);});
  historyRequests.set(id,promise);return promise;
}
try{const saved=JSON.parse(localStorage.getItem("transit.routes"));if(Array.isArray(saved)&&saved.every(id=>typeof id==="string")){shown=new Set(saved);savedSelection=true;}}catch(e){}
const map=L.map("map",{minZoom:9,maxZoom:19,preferCanvas:true}).setView([3.1135,101.649],12);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
const shapeLayer=L.layerGroup().addTo(map),stopLayer=L.layerGroup().addTo(map);
new ResizeObserver(()=>map.invalidateSize()).observe($("map"));
const color=id=>byId.get(id)?.color||"#777";
const portrait=id=>byId.get(id)?.portrait||"dog";
const routeName=id=>byId.get(id)?.name||id;
const age=ms=>{const n=Math.max(0,Math.round((Date.now()-ms)/1000));return n<60?n+" 秒前":Math.floor(n/60)+" 分钟前";};
function markerHtml(bus){
  return '<div class="marker'+(selected===bus.route+"/"+bus.id?' selected':'')+'" style="--route:'+color(bus.route)+'">'+(bus.angle==null?'':'<i class="arrow" style="transform:rotate('+bus.angle+'deg)"></i>')+'<img class="portrait" src="assets/crew/'+portrait(bus.route)+'.jpg" alt=""><b>'+esc(routeName(bus.route))+'</b></div>';
}
function save(){try{localStorage.setItem("transit.routes",JSON.stringify([...shown]));}catch(e){}}
function updateQuery(){
  $("selection-count").textContent="· 已选 "+shown.size+" 条";
  const cycle=Math.ceil(requestSpacing(shown.size)*shown.size/1000);
  $("query-note").textContent=shown.size>12
    ? "全网分批查询，一轮约 "+cycle+" 秒；收到车辆后逐步显示。聚焦几条线路可提高刷新频率。"
    : shown.size?"当前线路约每 5 秒查询，GPS 实际更新时间由公交系统决定。":"尚未选择线路。";
}
function renderOptions(){
  const q=$("route-search").value.trim().toLowerCase();
  const list=routes.filter(r=>!q||(r.name+" "+r.id+" "+r.title).toLowerCase().includes(q));
  $("route-options").innerHTML=list.map(r=>'<button class="route-btn" data-route="'+esc(r.id)+'" aria-pressed="'+shown.has(r.id)+'" title="'+esc(r.title)+'">'+esc(r.name)+'</button>').join("")||'<p class="muted">未找到线路</p>';
  $("route-options").querySelectorAll("button").forEach(button=>button.onclick=()=>{const id=button.dataset.route;shown.has(id)?shown.delete(id):shown.add(id);applySelection();});
  updateQuery();
}
async function getShape(id){
  if(shapes.has(id))return shapes.get(id);
  if(loadingShapes.has(id))return loadingShapes.get(id);
  const route=byId.get(id);if(!route)return null;
  const promise=fetch("network/"+route.file).then(r=>{if(!r.ok)throw Error("线路文件暂不可用");return r.json();}).then(data=>{
    const bundle=loadBundle({routes:[{id,name:route.name,lines:data.lines.map(l=>({dir:"",headsign:l.headsign,shape:l.shape,stops:l.stops}))}]});
    const result={...bundle,index:new RouteIndex(bundle.lines),prepared:prepareLines(bundle.lines)};shapes.set(id,result);ensureHistorical(id);return result;
  }).catch(()=>null).finally(()=>loadingShapes.delete(id));
  loadingShapes.set(id,promise);return promise;
}
async function drawShapes(){
  shapeLayer.clearLayers();stopLayer.clearLayers();
  const ids=shown.size<=8?[...shown]:selected?[selected.split("/")[0]]:[];
  const data=await Promise.all(ids.map(getShape));
  // A route may have been deselected while its geometry was loading.
  shapeLayer.clearLayers();stopLayer.clearLayers();
  for(let i=0;i<ids.length;i++){
    if(!shown.has(ids[i])||!data[i])continue;
    for(const line of data[i].lines){
      L.polyline(line.shape,{color:color(ids[i]),weight:4,opacity:.7,interactive:false}).addTo(shapeLayer);
      if(map.getZoom()>=14)for(const s of line.stops)L.circleMarker(s.pos,{radius:4,color:color(ids[i]),weight:2,fillColor:"#fff",fillOpacity:1}).bindTooltip(esc(s.name)).addTo(stopLayer);
    }
  }
}
function applySelection(){
  selected=null;save();feed?.setRoutes([...shown]);renderOptions();drawShapes();renderBuses();
  if(nearbyActive)showNearby();
}
function focusBus(bus){
  selected=bus.route+"/"+bus.id;map.flyTo(bus.pos,Math.max(15,map.getZoom()),{duration:.5});getShape(bus.route).then(()=>{drawShapes();renderBuses();});renderBuses();
}
function renderBuses(){
  trafficHistory.observe(buses);
  const visible=buses.filter(b=>shown.has(b.route));const seen=new Set();
  for(const bus of visible){
    const key=bus.route+"/"+bus.id;seen.add(key);let marker=markers.get(key);
    const html=markerHtml(bus);
    if(!marker){marker=L.marker(bus.pos,{icon:L.divIcon({className:"",html,iconSize:[0,0]}),keyboard:false}).addTo(map);marker.on("click",()=>focusBus(marker.bus));markers.set(key,marker);}
    marker.bus=bus;marker.setLatLng(bus.pos);
    if(marker.html!==html){marker.setIcon(L.divIcon({className:"",html,iconSize:[0,0]}));marker.html=html;}
    marker.setZIndexOffset(key===selected?1000:0);
  }
  for(const [key,marker]of markers)if(!seen.has(key)){map.removeLayer(marker);markers.delete(key);}
  $("bus-count").textContent=visible.length+" 辆有有效定位"+(latestFeedTime?" · 接收于 "+hhmm(latestFeedTime):"");
  const cards=visible.slice().sort((a,b)=>Number(b.route+"/"+b.id===selected)-Number(a.route+"/"+a.id===selected)||routeName(a.route).localeCompare(routeName(b.route),undefined,{numeric:true})).slice(0,100);
  $("vehicles").innerHTML=cards.map(bus=>{
    const key=bus.route+"/"+bus.id;
    const progress=shapes.get(bus.route)?.index.locate(bus.route,bus.pos,null,bus.angle);
    const next=progress?.nextStop?"下一站约为 "+progress.nextStop:"点击查看所在路段";
    return '<button class="vehicle'+(key===selected?' selected':'')+'" data-key="'+esc(key)+'" style="--route:'+color(bus.route)+'"><img class="portrait" src="assets/crew/'+portrait(bus.route)+'.jpg" alt=""><span><b>'+esc(routeName(bus.route))+' · '+esc(bus.id)+'</b><span>'+esc(next)+'</span><small>'+(bus.speed==null?"":bus.speed+" km/h · ")+'GPS '+age(bus.gpsMs)+'</small></span></button>';
  }).join("")||'<p class="muted">'+(shown.size?"等待有效车辆位置。暂时没有位置不代表线路停运。":"先选择一条线路。")+'</p>';
  $("vehicles").querySelectorAll("button").forEach(button=>button.onclick=()=>{const bus=visible.find(b=>b.route+"/"+b.id===button.dataset.key);if(bus)focusBus(bus);});
  renderNearby();
}
function selectNearby(stop){
  nearbyStop=stop;if(stopMarker)map.removeLayer(stopMarker);
  stopMarker=L.marker(stop.pos,{icon:L.divIcon({className:'',html:'<div class="nearest-stop-dot"></div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(map).bindTooltip(esc(stop.name),{permanent:true,direction:'top'});
  map.fitBounds(L.latLngBounds([position,stop.pos]),{padding:[55,55],maxZoom:16});renderNearby();
}
async function showNearby(){
  nearbyActive=true;const ticket=++nearbyTicket;
  $("nearby-panel").hidden=false;nearbyStop=null;nearbyLines=[];$('nearby-distance').textContent='';$('nearby-load-status').textContent='';
  if(stopMarker){map.removeLayer(stopMarker);stopMarker=null;}
  $("nearby-options").innerHTML='';$("nearby-arrivals").innerHTML='';
  if(!shown.size){$("nearby-title").textContent='请先选择公交线路';return;}
  if(!position){$("nearby-title").textContent='请先允许获取你的位置';return;}
  $("nearby-title").textContent='正在查找所选线路的最近站点…';
  const ids=[...shown];let failed=0;
  for(let offset=0;offset<ids.length;offset+=8){
    const batch=await Promise.all(ids.slice(offset,offset+8).map(getShape));
    if(ticket!==nearbyTicket)return;
    for(const bundle of batch)if(bundle)nearbyLines.push(...bundle.prepared);else failed++;
  }
  nearbyChoices=nearbyStops(nearbyLines,position);
  $("nearby-load-status").textContent=failed?failed+' 条线路站点未能读取，可点击最近站点重试。':'';
  if(!nearbyChoices.length){$("nearby-title").textContent='所选线路暂无可用站点，请换一条线路或重试';return;}
  selectNearby(nearbyChoices[0]);
}
function renderNearby(){
  if(!nearbyActive||!nearbyStop)return;
  const s=nearbyStop;
  $("nearby-title").textContent=s.name;
  $("nearby-distance").textContent='距你直线约 '+Math.round(s.distance)+' 米 · 定位精度约 '+Math.round(locationAccuracy)+' 米'+(s.distance>2000?' · 站点较远，可换线路查看':'');
  $("nearby-options").innerHTML=nearbyChoices.map((x,i)=>'<button class="'+(x.key===s.key?'on':'')+'" data-stop="'+i+'" aria-pressed="'+(x.key===s.key)+'">'+esc(x.name)+' · '+Math.round(x.distance)+' 米<br>'+esc([...x.routes].map(routeName).join(' / '))+'</button>').join('');
  $("nearby-options").querySelectorAll('button').forEach(button=>button.onclick=()=>selectNearby(nearbyChoices[Number(button.dataset.stop)]));
  if(Date.now()-locationTime>120000){$("nearby-arrivals").textContent='你的位置已超过两分钟，请点“最近站点”重新定位。';return;}
  const result=stopArrivals(nearbyLines,s,buses.filter(b=>shown.has(b.route)),Date.now(),trafficHistory,historical);
  $("nearby-arrivals").innerHTML=result.arrivals.slice(0,5).map((a,i)=>'<button data-arrival="'+i+'"><b>'+esc(routeName(a.bus.route))+' · '+esc(a.bus.id)+'</b><strong>'+(a.minutes===0?'已到站附近':a.prediction?'预计约 '+a.prediction.low+'–'+a.prediction.high+' 分钟':'预计约 '+a.minutes+' 分钟')+'</strong><small>'+esc(a.headsign||'沿当前行驶方向')+'</small><small>沿线约 '+Math.round(a.meters)+' 米 · '+(a.bus.speed??'—')+' km/h · GPS '+age(a.bus.gpsMs)+'</small><small>'+esc(a.prediction?.label||a.traffic?.label||'到站附近')+(a.traffic?.historical?' · 近期均速 '+a.traffic.speed.toFixed(1)+' km/h':'')+'</small><small>'+esc(a.prediction?.source||'')+'</small><small>'+esc(a.minutes===0?'':a.prediction?.historyMonth?'历史月份 '+a.prediction.historyMonth+(a.prediction.staleHistory?'（较旧，仅供参考）':''):'无匹配的历史路段参考')+'</small></button>').join('')||'<p class="muted">暂无可确认正驶向此站的车辆；不代表线路停运。</p>';
  $("nearby-arrivals").querySelectorAll('button').forEach(button=>button.onclick=()=>focusBus(result.arrivals[Number(button.dataset.arrival)].bus));
  if(result.unknown.length){const note=document.createElement('p');note.className='muted';note.textContent=result.unknown.slice(0,3).map(x=>routeName(x.bus.route)+' '+x.bus.id+'：'+x.reason).join('；');$("nearby-arrivals").append(note);}
}
$("nearest-stop").onclick=()=>{
  if(!shown.size){showNearby();return;}
  nearbyActive=true;
  if(!position||Date.now()-locationTime>120000)$("locate").click();else showNearby();
};
setInterval(renderNearby,10000);
$("route-search").oninput=renderOptions;
$("all-routes").onclick=()=>{shown=new Set(routes.map(r=>r.id));applySelection();$("route-search").value="";renderOptions();};
$("usual-routes").onclick=()=>{shown=new Set(DEFAULT.filter(id=>byId.has(id)));applySelection();};
$("clear-routes").onclick=()=>{shown.clear();applySelection();};
$("fit").onclick=()=>{
  const pts=buses.filter(b=>shown.has(b.route)).map(b=>b.pos);if(position)pts.push(position);
  if(pts.length)map.fitBounds(L.latLngBounds(pts),{padding:[40,40],maxZoom:15});
  else{const boxes=[...shown].map(id=>byId.get(id)?.bounds).filter(Boolean);if(boxes.length)map.fitBounds(L.latLngBounds(boxes.flatMap(b=>[[b[0],b[1]],[b[2],b[3]]])),{padding:[30,30]});}
};
let selfMarker=null,accuracy=null;
$("locate").onclick=()=>{
  const label=$("location-status");if(!navigator.geolocation){label.textContent="此浏览器不支持定位";return;}
  label.textContent="正在获取你的位置…";$("locate").disabled=true;
  navigator.geolocation.getCurrentPosition(p=>{
    $("locate").disabled=false;position={lat:p.coords.latitude,lng:p.coords.longitude};
    locationTime=Date.now();locationAccuracy=p.coords.accuracy;
    if(selfMarker)map.removeLayer(selfMarker);if(accuracy)map.removeLayer(accuracy);
    selfMarker=L.marker(position,{icon:L.divIcon({className:"",html:'<div class="location-dot"></div>',iconSize:[16,16],iconAnchor:[8,8]})}).addTo(map).bindTooltip("我的位置");
    accuracy=L.circle(position,{radius:p.coords.accuracy,color:"#287bed",weight:1,fillOpacity:.08}).addTo(map);
    map.setView(position,15);label.textContent="我的位置 · 精度约 "+Math.round(p.coords.accuracy)+" 米";
    if(nearbyActive)showNearby();
  },e=>{$("locate").disabled=false;label.textContent=e.code===1?"未允许定位，你仍可正常查车":e.code===3?"定位超时，请稍后重试":"暂时无法获取位置";},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
};
map.on("zoomend",drawShapes);
async function weather(){
  try{
    const q=new URLSearchParams({latitude:3.1209,longitude:101.6538,current:"temperature_2m,apparent_temperature,weather_code",hourly:"precipitation_probability,temperature_2m",forecast_days:2,timezone:"Asia/Kuala_Lumpur"});
    const r=await fetch("https://api.open-meteo.com/v1/forecast?"+q,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const d=await r.json();
    const hours=d.hourly.time.map((t,i)=>({t:parseLocal(t),p:d.hourly.precipitation_probability[i],temp:d.hourly.temperature_2m[i]})).filter(x=>x.t>=Date.now()).slice(0,8);
    $("weather").innerHTML='<p>马大附近 · '+esc(d.current.time.replace("T"," "))+'</p><span class="rate">'+esc(d.current.temperature_2m)+'°C</span><span>　体感 '+esc(d.current.apparent_temperature)+'°C</span><div class="hourly">'+hours.map(x=>'<div class="hour">'+hhmm(x.t)+'<small>'+esc(x.temp)+'°C</small><small>雨 '+(x.p==null?"未知":esc(x.p)+"%")+'</small></div>').join("")+'</div>';
  }catch(e){$("weather").textContent="天气暂时不可用，请稍后刷新";}
}
function conversion(){const n=Number($("amount").value);$("conversion").textContent=rate&&Number.isFinite(n)&&n>=0?n.toLocaleString()+" 令吉 ≈ "+(n*rate).toFixed(2)+" 元":"";}
$("amount").oninput=conversion;
async function fx(){
  try{const r=await fetch("https://api.frankfurter.dev/v1/latest?base=MYR&symbols=CNY",{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();const d=await r.json();rate=d.rates.CNY;if(!Number.isFinite(rate))throw Error();$("fx").innerHTML='<p>1 令吉 = <span class="rate">'+fxRate(rate)+'</span> 元</p><p class="muted">参考价更新于 '+esc(d.date)+'，实际换汇以服务商报价为准。</p>';conversion();}catch(e){$("fx").textContent="汇率暂时不可用";}
}
async function main(){
  loadHistorical();weather();fx();setInterval(weather,600000);setInterval(fx,10800000);
  try{
    const response=await fetch("network/catalog.json");if(!response.ok)throw Error("线路目录读取失败");const catalog=await response.json();
    // These route codes are directly queryable with the original RKL socket scheme.
    routes=catalog.routes.filter(r=>r.category==="rapid-bus-kl").map((r,i)=>({...r,color:palette[i%palette.length],portrait:DEFAULT.includes(r.id)?portraits[DEFAULT.indexOf(r.id)]:portraits[i%portraits.length]}));
    byId=new Map(routes.map(r=>[r.id,r]));shown=new Set([...shown].filter(id=>byId.has(id)));if(!shown.size&&!savedSelection)shown=new Set(DEFAULT.filter(id=>byId.has(id)));
    $("network-count").textContent=routes.length+" 条 Rapid KL 类别线路";
    renderOptions();drawShapes();
    let scheduled=false;
    feed=new NetworkFeed({routes:[...shown],onUpdate:list=>{buses=list;if(!scheduled){scheduled=true;setTimeout(()=>{scheduled=false;renderBuses();},250);}},onStatus:s=>{$("connection").textContent=s.message;if(s.updatedAt)latestFeedTime=s.updatedAt;}});
    feed.start();renderBuses();
  }catch(e){$("connection").textContent="线路目录暂时不可用，请刷新重试。";$("network-count").textContent="目录加载失败";}
}
window.addEventListener("pagehide",()=>feed?.stop());
window.addEventListener("pageshow",e=>{if(e.persisted)feed?.start();});
main();
