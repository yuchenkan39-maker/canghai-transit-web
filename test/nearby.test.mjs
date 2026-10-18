import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLines,nearbyStops,stopArrivals,TrafficHistory} from '../site/js/nearby.js';
import {parseLocal} from '../site/js/core.js';
const now=2000000;
const shape=[{lat:3,lng:101},{lat:3,lng:101.01},{lat:3,lng:101.02}];
const lines=prepareLines([{routeId:'R',headsign:'East',shape,stops:[{id:'west',name:'West',pos:shape[0]},{id:'east',name:'East',pos:shape[2]}]},{routeId:'R',headsign:'West',shape:[...shape].reverse(),stops:[{id:'opposite',name:'Other side',pos:{lat:3.0001,lng:101.02}}]}]);
const stop=nearbyStops(lines,shape[2]).find(s=>s.id==='east');
const bus={id:'one',route:'R',pos:{lat:3,lng:101.005},gpsMs:now,angle:90,speed:30};
test('nearest stops preserve separate boarding IDs and route memberships',()=>{
 assert.equal(stop.id,'east');assert.ok(stop.routes.has('R'));assert.equal(nearbyStops(lines,shape[2])[1].id,'opposite');
});
test('only upstream buses heading toward the exact stop receive ETA',()=>{
 assert.ok(stopArrivals(lines,stop,[bus],now).arrivals[0].minutes>=3);
 assert.equal(stopArrivals(lines,stop,[{...bus,angle:270}],now).arrivals.length,0);
 assert.equal(stopArrivals(lines,stop,[{...bus,pos:{lat:3,lng:101.021}}],now).arrivals.length,0);
});
test('stale, directionless and stationary buses do not invent minutes',()=>{
 for(const changes of [{gpsMs:now-91000},{angle:null},{speed:0}])assert.equal(stopArrivals(lines,stop,[{...bus,...changes}],now).arrivals.length,0);
 assert.equal(stopArrivals(lines,stop,[{...bus,pos:shape[2],speed:0}],now).arrivals[0].minutes,0);
});
test('sustained slow speeds adjust ETA; duplicate reports cannot fake history',()=>{
 const history=new TrafficHistory();
 for(let i=0;i<3;i++)history.observe([{...bus,speed:6,gpsMs:now-60000+i*30000}],now);
 const slow=stopArrivals(lines,stop,[bus],now,history).arrivals[0];
 assert.match(slow.traffic.label,/疑似拥堵/);assert.ok(slow.minutes>stopArrivals(lines,stop,[bus],now).arrivals[0].minutes);
 const repeated=new TrafficHistory();for(let i=0;i<5;i++)repeated.observe([bus],now);assert.equal(repeated.view(bus,now).historical,false);
 assert.equal(history.view(bus,now+300000).historical,false);
});
test('GPS parsing preserves seconds for sampling',()=>{assert.equal(parseLocal('2026-10-18 14:30:45')-parseLocal('2026-10-18 14:30:00'),45000);});
