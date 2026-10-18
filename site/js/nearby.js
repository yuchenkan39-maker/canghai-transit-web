import { approxM, bearing } from './core.js';
import { estimatePath } from './prediction.js';
const diff=(a,b)=>Math.abs(((a-b+540)%360)-180);
// Project onto route segments, retaining along-route distance rather than straight-line distance.
function project(line,pos,heading=null,minAlong=0){
  let best=null;
  for(let i=0;i<line.points.length-1;i++){
    const a=line.points[i],b=line.points[i+1],len=line.cum[i+1]-line.cum[i];if(len<1)continue;
    const scale=Math.cos(pos.lat*Math.PI/180),dx=(b.lng-a.lng)*scale,dy=b.lat-a.lat;
    const t=Math.max(0,Math.min(1,((pos.lng-a.lng)*scale*dx+(pos.lat-a.lat)*dy)/(dx*dx+dy*dy)));
    const along=line.cum[i]+len*t;if(along+10<minAlong)continue;
    const gap=approxM(pos,{lat:a.lat+(b.lat-a.lat)*t,lng:a.lng+(b.lng-a.lng)*t});
    const turn=heading==null?0:diff(bearing(a,b),heading);
    const score=gap+turn*2;
    if(!best||score<best.score)best={along,gap,turn,score};
  }
  return best;
}
export function prepareLines(lines){
  return lines.filter(l=>l.shape.length>1).map((l,index)=>{
    const line={route:l.routeId,key:l.patternId||l.routeId+'/'+index,dirCode:l.dirCode,headsign:l.headsign,points:l.shape,cum:[0],stops:[]};
    for(let i=1;i<l.shape.length;i++)line.cum.push(line.cum[i-1]+approxM(l.shape[i-1],l.shape[i]));
    let from=0;
    for(const s of l.stops){const hit=project(line,s.pos,null,from);if(!hit||hit.gap>150)continue;from=hit.along;line.stops.push({...s,along:hit.along});}
    return line;
  });
}
export function nearbyStops(lines,pos,limit=3){
  const stops=new Map();
  for(const line of lines)for(const s of line.stops){
    const key=s.id||s.pos.lat+','+s.pos.lng;
    if(!stops.has(key))stops.set(key,{...s,key,routes:new Set(),distance:approxM(pos,s.pos)});
    stops.get(key).routes.add(line.route);
  }
  return [...stops.values()].sort((a,b)=>a.distance-b.distance).slice(0,limit);
}
export class TrafficHistory{
  constructor(){this.samples=new Map();}
  observe(buses,now=Date.now()){
    for(const b of buses){
      if(!Number.isFinite(b.speed)||b.speed<0||b.speed>100||!Number.isFinite(b.gpsMs)||now-b.gpsMs>90000||b.gpsMs>now+30000)continue;
      const key=b.route+'/'+b.id,list=this.samples.get(key)||[];
      if(!list.length||b.gpsMs>list[list.length-1].time)list.push({time:b.gpsMs,speed:b.speed});
      this.samples.set(key,list.filter(s=>now-s.time<=180000));
    }
    for(const [key,list]of this.samples)if(!list.length||now-list[list.length-1].time>180000)this.samples.delete(key);
  }
  view(bus,now=Date.now()){
    const list=(this.samples.get(bus.route+'/'+bus.id)||[]).filter(s=>now-s.time<=180000);
    const span=list.length>1?list.at(-1).time-list[0].time:0;
    if(list.length<3||span<60000)return {speed:bus.speed,label:'路况待判断（积累连续车速中）',historical:false};
    let area=0;for(let i=1;i<list.length;i++)area+=(list[i-1].speed+list[i].speed)/2*(list[i].time-list[i-1].time);
    const speed=area/span;
    return {speed,historical:true,label:speed<3?'持续停车或低速，路况待确认':speed<12?'持续低速，疑似拥堵或停站':speed<20?'行驶偏慢（车速推断）':'行驶较顺畅（车速推断）'};
  }
}
export function stopArrivals(lines,stop,buses,now=Date.now(),traffic=null,history=null){
  const arrivals=[],unknown=[];
  for(const bus of buses){
    if(!stop.routes.has(bus.route))continue;
    if(!Number.isFinite(bus.gpsMs)||now-bus.gpsMs>90000||bus.gpsMs>now+30000){unknown.push({bus,reason:'GPS 较旧，暂不估算'});continue;}
    if(!Number.isFinite(bus.angle)){unknown.push({bus,reason:'方向未知，暂不估算'});continue;}
    const hits=lines.filter(l=>l.route===bus.route).map(line=>({line,hit:project(line,bus.pos,bus.angle)})).filter(x=>x.hit&&x.hit.gap<=100&&x.hit.turn<=65).sort((a,b)=>a.hit.score-b.hit.score);
    if(!hits.length)continue;
    const {line,hit}=hits[0];
    // Equally plausible opposite patterns cannot safely establish a boarding direction.
    if(hits[1]&&hits[1].hit.score-hit.score<12&&hits[1].line.headsign!==line.headsign){unknown.push({bus,reason:'行驶方向待确认'});continue;}
    if(stop.boarding&&line.key!==stop.boarding.lineKey)continue;
    const targets=stop.boarding?line.stops.filter((s,i)=>i===stop.boarding.stopIndex&&s.id===stop.id&&s.along>=hit.along-25&&s.along<stop.boarding.destinationAlong):line.stops.filter(s=>s.id===stop.id&&s.along>=hit.along-25);
    if(!targets.length)continue; // Do not invent a terminus turnaround or wrap a loop.
    const meters=Math.max(0,targets[0].along-hit.along);
    if(meters<=35&&approxM(bus.pos,stop.pos)<=50){arrivals.push({bus,meters,minutes:0,headsign:stop.boarding?.destinationName||line.headsign});continue;}
    const road=traffic?.view(bus,now)||{speed:bus.speed,label:'路况待判断',historical:false};
    if(!Number.isFinite(road.speed)||road.speed<3||road.speed>100){unknown.push({bus,reason:road.speed<3?'车辆停车或持续低速，暂不估算':'车速不可用，暂不估算'});continue;}
    const peers=[];
    for(const other of buses){
      if(other.id===bus.id||!Number.isFinite(other.angle)||!Number.isFinite(other.gpsMs)||now-other.gpsMs>90000||other.gpsMs>now+30000)continue;
      const recent=traffic?.view(other,now);if(!recent?.historical||recent.speed<3||recent.speed>65)continue;
      // A vehicle waiting at a boarding stop is not evidence of road congestion.
      if(line.stops.some(s=>approxM(s.pos,other.pos)<45))continue;
      const location=project(line,other.pos,other.angle);
      if(!location||location.gap>45||location.turn>45||location.along<hit.along||location.along>targets[0].along)continue;
      peers.push({id:other.id,key:other.route+'/'+other.id,along:location.along,speed:recent.speed});
    }
    const prediction=estimatePath({line,from:hit.along,to:targets[0].along,now,bus,road,peers,history});
    arrivals.push({bus,meters,minutes:prediction?.minutes??Math.max(1,Math.ceil(meters/(road.speed/3.6)/60)),headsign:stop.boarding?.destinationName||line.headsign,traffic:road,prediction});
  }
  return {arrivals:arrivals.sort((a,b)=>a.minutes-b.minutes||a.meters-b.meters),unknown};
}
