import { approxM, bearing } from './core.js';
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
