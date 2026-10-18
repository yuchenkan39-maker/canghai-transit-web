import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadBundle} from '../site/js/core.js';
import {prepareLines,stopArrivals} from '../site/js/nearby.js';
import {directionChoices,boardingStops} from '../site/js/boarding.js';
const a={lat:3,lng:101},b={lat:3,lng:101.01},c={lat:3,lng:101.02};
const s=(id,name,pos)=>({id,name,pos});
const lines=prepareLines([
 {routeId:'R',headsign:'East Mall',shape:[a,b,c],stops:[s('start','Start',a),s('east','East boarding',b),s('end','End',c)]},
 {routeId:'R',headsign:'West Station',shape:[c,b,a],stops:[s('end','End',c),s('west','Opposite side',{lat:3.00001,lng:101.01}),s('start','Start',a)]}
]);
test('rider explicitly selects destination; nearest opposite-side stop is excluded',()=>{
 const choices=directionChoices(lines);assert.equal(choices.length,2);assert.equal(choices[0].label,'往 East Mall');
 assert.deepEqual(boardingStops(null,b),[]);
 const stations=boardingStops(choices[0],{lat:3.00001,lng:101.01});
 assert.equal(stations[0].id,'east');assert.ok(stations.every(x=>x.id!=='west'&&x.id!=='end'));
 assert.equal(stations[0].boarding.destinationName,'East Mall');
});
test('direction is matched against all patterns before applying rider selection',()=>{
 const selected=boardingStops(directionChoices(lines)[0],b)[0],now=100000;
 const right={id:'right',route:'R',pos:{lat:3,lng:101.005},gpsMs:now,angle:90,speed:30};
 const wrong={...right,id:'wrong',pos:{lat:3,lng:101.015},angle:270};
 const result=stopArrivals(lines,selected,[right,wrong],now);
 assert.deepEqual(result.arrivals.map(a=>a.bus.id),['right']);assert.equal(result.arrivals[0].headsign,'East Mall');
 const switched=boardingStops(directionChoices(lines)[1],b)[0];
 assert.deepEqual(stopArrivals(lines,switched,[right,wrong],now).arrivals.map(a=>a.bus.id),['wrong']);
});
test('loop destination excludes boarding stops after destination, including a physically closer return leg',()=>{
 const loop=prepareLines([{routeId:'L',headsign:'',shape:[a,b,c,{lat:3.0001,lng:101.01},a],stops:[s('terminal','Station',a),s('out','Outbound',b),s('mall','Mall',c),s('back','Return side',{lat:3.0001,lng:101.01}),s('terminal','Station',a)]}]);
 const options=directionChoices(loop),mall=options.find(o=>o.destinationId==='mall');assert.ok(mall.loop);assert.match(mall.label,/Mall/);
 const stops=boardingStops(mall,{lat:3.0001,lng:101.01});assert.equal(stops[0].id,'out');assert.ok(!stops.some(s=>s.id==='back'||s.id==='mall'));
 assert.ok(options.some(o=>o.destinationId==='terminal'));
});
test('real T790 offers both terminals; T786 loop offers Phileo as an explicit destination',()=>{
 const catalog=JSON.parse(fs.readFileSync(new URL('../site/network/catalog.json',import.meta.url)));
 function read(id){const route=catalog.routes.find(r=>r.id===id),data=JSON.parse(fs.readFileSync(new URL('../site/network/'+route.file,import.meta.url)));return prepareLines(loadBundle({routes:[{id,name:route.name,lines:data.lines.map(l=>({...l,dir:l.direction}))}]}).lines);}
 const direct=directionChoices(read('T7900'));assert.ok(direct.some(o=>/MID VALLEY/i.test(o.label)));assert.ok(direct.some(o=>/PARAMOUNT/i.test(o.label)));
 const ring=directionChoices(read('T7860'));assert.ok(ring.length>2);assert.ok(ring.some(o=>/Phileo/i.test(o.label)));assert.ok(ring.every(o=>o.loop));
});
