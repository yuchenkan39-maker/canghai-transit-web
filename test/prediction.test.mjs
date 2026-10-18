import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyKey,HistoricalProfiles,estimatePath} from '../site/js/prediction.js';
import {prepareLines,stopArrivals,TrafficHistory} from '../site/js/nearby.js';
const now=Date.parse('2026-10-18T02:00:00Z'); // Sunday 10:00 MYT
const line={route:'R',points:[{lat:3,lng:101},{lat:3,lng:101.03}],cum:[0,3335]};
const bus={route:'R',id:'self',speed:30},road={speed:30,historical:true,label:'行驶较顺畅（车速推断）'};
function history(speed=15){const h=new HistoricalProfiles();h.setCatalog({version:1,cellDegrees:.003,sourceMonth:'2026-04',observedTo:'2026-04-30T20:00:00+08:00'});const entries={};for(let x=101;x<101.031;x+=.0005)entries[historyKey({lat:3,lng:x},90,now)]=[speed,20,4,3];h.setRoute('R',entries);return h;}
test('history bins use Malaysian local day/hour and preserve direction',()=>{
 const pos={lat:3,lng:101};assert.match(historyKey(pos,90,now),/,2,1,3$/);
 assert.match(historyKey(pos,270,Date.parse('2026-10-18T16:30:00Z')),/,6,0,0$/); // Monday 00:30
});
test('historical road-time priors influence remaining path; missing data is explicit',()=>{
 const args={line,from:0,to:3000,now,bus,road};
 const empty=estimatePath(args),prior=estimatePath({...args,history:history()});
 assert.equal(empty.coverage,0);assert.equal(empty.historyMonth,null);
 assert.ok(prior.minutes>empty.minutes);assert.equal(prior.coverage,1);assert.equal(prior.staleHistory,true);
 assert.ok(prior.low<=prior.minutes&&prior.high>=prior.minutes);assert.match(prior.source,/历史/);
});
test('one peer, duplicated vehicle IDs and opposite route direction do not fabricate congestion',()=>{
 const args={line,from:0,to:3000,now,bus,road,history:history(30)};
 const peer={id:'p',key:'R/p',along:1500,speed:5};
 const one=estimatePath({...args,peers:[peer]});assert.equal(one.peerCount,0);
 assert.equal(estimatePath({...args,peers:[peer,{...peer,key:'OTHER/p'}]}).peerCount,0);
 const two=estimatePath({...args,peers:[peer,{...peer,id:'q',key:'R/q'}]});
 assert.equal(two.peerCount,2);assert.ok(two.liveCoverage>0&&two.liveCoverage<.3);assert.match(two.label,/疑似/);
 assert.ok(two.minutes>one.minutes); // The slowdown affects its local segment only.
});
test('stop-area, stale and reverse-direction peers are excluded by map matching',()=>{
 const prepared=prepareLines([{routeId:'R',headsign:'East',shape:line.points,stops:[{id:'s',name:'Target',pos:line.points[1]}]}]);
 const target={id:'s',routes:new Set(['R']),pos:line.points[1]};
 const self={...bus,pos:{lat:3,lng:101.001},gpsMs:now,angle:90};
 const p={...self,id:'p',pos:{lat:3,lng:101.0299}},q={...p,id:'q'};
 const traffic=new TrafficHistory();for(let i=0;i<3;i++)traffic.observe([self,p,q].map(b=>({...b,speed:b.id==='self'?30:6,gpsMs:now-60000+i*30000})),now);
 let out=stopArrivals(prepared,target,[self,p,q],now,traffic,history());
 assert.equal(out.arrivals.find(a=>a.bus.id==='self').prediction.peerCount,0);
 out=stopArrivals(prepared,target,[self,{...p,pos:{lat:3,lng:101.015},angle:270},{...q,pos:{lat:3,lng:101.015},gpsMs:now-100000}],now,traffic,history());
 assert.equal(out.arrivals.find(a=>a.bus.id==='self').prediction.peerCount,0);
});
test('sparse historical cells and invalid speeds never become a baseline',()=>{
 const h=history(),key=historyKey({lat:3,lng:101},90,now);
 for(const value of [[15,10,4,3],[15,20,1,3],[15,20,4,1],[0,20,4,3],[Infinity,20,4,3]]){
  h.setRoute('R',{[key]:value});assert.equal(h.lookup('R',{lat:3,lng:101},90,now),null);
 }
 assert.equal(estimatePath({line,from:0,to:1000,now,bus,road:{speed:0},history:history()}),null);
});
test('published profiles are real aggregates with declared source and sample thresholds',()=>{
 const dir=new URL('../site/history/',import.meta.url),catalog=JSON.parse(fs.readFileSync(new URL('catalog.json',dir)));
 assert.equal(catalog.rawRows,5171644);assert.ok(catalog.cells>20000);assert.ok(catalog.routes.T7900);assert.ok(catalog.routes.T7860);
 assert.ok(catalog.validation.samples>1000);assert.ok(catalog.validation.modelAbsSeconds<catalog.validation.instantSpeedAbsSeconds);
 let count=0;for(const r of Object.values(catalog.routes)){
  const entries=Object.values(JSON.parse(fs.readFileSync(new URL(r.file,dir))));assert.equal(entries.length,r.cells);count+=entries.length;
  for(const [speed,n,days,vehicles]of entries){assert.ok(speed>=3&&speed<=65);assert.ok(n>=12&&days>=3&&vehicles>=2);}
 }
 assert.equal(count,catalog.cells);
});
