import { approxM } from './core.js';

// A rider chooses a destination; heading/GPS is used only to validate a bus,
// never to silently decide which direction the rider wants to travel.
export function directionChoices(lines){
  const options=[];
  for(const line of lines){
    if(line.stops.length<2)continue;
    const first=line.stops[0],last=line.stops.at(-1);
    const loop=first.id===last.id||approxM(first.pos,last.pos)<120;
    const destinations=loop?line.stops.slice(1):[last];
    for(const destination of destinations){
      const index=line.stops.indexOf(destination);
      if(destination.along<=first.along+25)continue;
      const name=loop?destination.name:(line.headsign?.trim()||destination.name);
      options.push({key:line.key+':'+index,lineKey:line.key,route:line.route,destinationIndex:index,destinationAlong:destination.along,destinationId:destination.id,destinationName:name,loop,label:'往 '+name+(loop?'（环线沿途站）':''),line});
    }
  }
  // Some official feeds have different branches with identical headsigns.
  for(const option of options){
    if(options.filter(o=>o.label===option.label).length>1){
      const first=option.line.stops[0];
      option.label+=' · 从 '+first.name+' 出发 · 路径 '+(lines.indexOf(option.line)+1);
    }
  }
  return options;
}

export function boardingStops(choice,position,limit=3){
  if(!choice||!position)return [];
  const stops=choice.line.stops.slice(0,choice.destinationIndex).map((s,index)=>({...s,key:choice.lineKey+':stop:'+index,routes:new Set([choice.route]),distance:approxM(position,s.pos),boarding:{lineKey:choice.lineKey,stopIndex:index,destinationIndex:choice.destinationIndex,destinationAlong:choice.destinationAlong,destinationName:choice.destinationName}}));
  return stops.filter(s=>s.along+25<choice.destinationAlong).sort((a,b)=>a.distance-b.distance).slice(0,limit);
}
