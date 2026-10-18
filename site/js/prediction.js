import { bearing } from './core.js';
const median=values=>{const a=values.slice().sort((x,y)=>x-y);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function historyKey(pos,angle,now,cell=.003){
  const local=new Date(now+8*3600000),day=local.getUTCDay();
  return [Math.floor(pos.lat/cell),Math.floor(pos.lng/cell),Math.floor(((angle+22.5)%360)/45),Number(day===0||day===6),Math.floor(local.getUTCHours()/3)].join(',');
}
export class HistoricalProfiles{
  constructor(){this.catalog=null;this.routes=new Map();}
  setCatalog(catalog){if(catalog?.version===1&&catalog.cellDegrees===.003)this.catalog=catalog;}
  setRoute(id,data){this.routes.set(id,data);}
  lookup(route,pos,angle,now){
    const entry=this.routes.get(route)?.[historyKey(pos,angle,now,this.catalog?.cellDegrees)];
    if(!entry||entry.length<4||!entry.every(Number.isFinite)||entry[0]<3||entry[0]>65||entry[1]<12||entry[2]<3||entry[3]<2)return null;
    return {speed:entry[0],samples:entry[1],days:entry[2],vehicles:entry[3]};
  }
}
function pointAlong(line,along){
  let i=0;while(i<line.cum.length-2&&line.cum[i+1]<along)i++;
  const a=line.points[i],b=line.points[i+1],length=line.cum[i+1]-line.cum[i];
  const t=length?clamp((along-line.cum[i])/length,0,1):0;
  return {pos:{lat:a.lat+(b.lat-a.lat)*t,lng:a.lng+(b.lng-a.lng)*t},angle:bearing(a,b)};
}
/** Integrate remaining path in <=150m slices. Peers affect only nearby slices,
 * not the whole route, and require two independent vehicles with sustained data.
 * No assumed recovery from an observed slowdown; no invented congestion source.
 */
export function estimatePath({line,from,to,now,bus,road,peers=[],history}){
  const distance=to-from;if(distance<=0)return null;
  const current=Number.isFinite(road.speed)&&road.speed>=3&&road.speed<=100?road.speed:null;
  if(!current)return null; // Terminal dwell / stopping duration cannot be inferred from a prior.
  const parts=[];let histMeters=0,peerMeters=0,slowMeters=0;
  const peerIds=new Set();
  for(let start=from;start<to;start+=150){
    const end=Math.min(start+150,to),length=end-start,at=(start+end)/2;
    const {pos,angle}=pointAlong(line,at),prior=history?.lookup(bus.route,pos,angle,now);
    if(prior)histMeters+=length;
    const nearby=peers.filter(p=>Math.abs(p.along-at)<=180&&p.id!==bus.id);
    const unique=[...new Map(nearby.map(p=>[p.id,p])).values()];
    let speed=prior?.speed??current;
    // Current bus observations are local evidence, not a whole-route multiplier.
    if(prior&&at-from<=400&&road.historical)speed=1/(.65/current+.35/prior.speed);
    if(unique.length>=2){
      const live=median(unique.map(p=>p.speed));
      // A stop-related slow/zero speed is filtered by the caller.
      speed=prior?1/(.8/live+.2/prior.speed):live;
      peerMeters+=length;unique.forEach(p=>peerIds.add(p.id));
      if(prior&&live<prior.speed*.65)slowMeters+=length;
    }
    parts.push({length,speed,prior:!!prior});
  }
  const coverage=histMeters/distance,liveCoverage=peerMeters/distance;
  // Sparse historical coverage stays explicit; unmatched slices use current speed.
  const seconds=parts.reduce((sum,p)=>sum+p.length/(p.speed/3.6),0);
  const minutes=Math.max(1,Math.ceil(seconds/60));
  const usesHistory=histMeters>0,usesPeers=peerMeters>0;
  const label=slowMeters>0?'前方局部明显偏慢，疑似拥堵或停站':usesPeers?'前方部分路段有同向公交参考':road.label;
  const source=[usesHistory?'历史路段参考 '+Math.round(coverage*100)+'%':null,usesPeers?'同向车辆 '+peerIds.size+' 辆':null,road.historical?'本车近期均速':'本车瞬时速度'].filter(Boolean).join(' · ');
  // These are heuristic bounds, not calibrated statistical confidence intervals.
  const staleHistory=usesHistory&&history?.catalog?.observedTo&&now-Date.parse(history.catalog.observedTo)>90*86400000;
  const uncertainty=usesPeers&&coverage>=.7&&!staleHistory? .25:.4;
  return {minutes,low:Math.max(1,Math.floor(seconds/60*(1-uncertainty))),high:Math.max(minutes+1,Math.ceil(seconds/60*(1+uncertainty))),label,source,coverage,liveCoverage,peerCount:peerIds.size,historyMonth:usesHistory?history.catalog?.sourceMonth:null,confidence:'参考范围，尚未校准',staleHistory:!!staleHistory};
}
