import test from "node:test";
import assert from "node:assert/strict";
import { NetworkFeed, freshPositions, requestSpacing, retentionMs } from "../site/js/live.js";
import { readFileSync, existsSync } from "node:fs";
const catalog=JSON.parse(readFileSync(new URL("../site/network/catalog.json",import.meta.url)));
test("all Rapid KL routes have geometry files and unique socket ids",()=>{
 const routes=catalog.routes.filter(r=>r.category==="rapid-bus-kl");
 assert.ok(routes.length>100);assert.equal(new Set(routes.map(r=>r.id)).size,routes.length);
 for(const route of routes){assert.ok(existsSync(new URL("../site/network/"+route.file,import.meta.url)),route.id);
 const data=JSON.parse(readFileSync(new URL("../site/network/"+route.file,import.meta.url)));assert.equal(data.id,route.id);}
});
test("full network requests are paced while watched routes keep a short cycle",()=>{
 assert.equal(requestSpacing(4)*4,5000);assert.ok(requestSpacing(137)>=350);
 assert.ok(requestSpacing(137)*137>=45000);
 assert.ok(retentionMs(137)>requestSpacing(137)*137);
});
test("expiry removes silent buses even if no new payload arrives",()=>{
 const now=2000000,bus={route:"T7900",gpsMs:now-1000};
 const seen=new Map([["one",{bus,seenMs:now-1000}],["silent",{bus:{...bus,id:"old"},seenMs:now-21000}],["badgps",{bus:{...bus,gpsMs:now-310000},seenMs:now}],["other",{bus:{...bus,route:"OTHER"},seenMs:now}]]);
 assert.equal(freshPositions(seen,new Set(["T7900"]),now).length,1);
 assert.equal(freshPositions(seen,new Set(["T7900"]),now+20000).length,0);
});
function socket(){return {readyState:1,sent:[],send(s){this.sent.push(s)},close(){this.closed=true}};}
const payload=JSON.stringify([{route:"U7800",bus_no:"TEST",latitude:3.12,longitude:101.65,dt_gps:"2026-10-18 14:00:00",speed:20,angle:90}]);
test("non-original route is queried and decoded with the existing protocol",async()=>{
 const ws=socket();let latest=[];const feed=new NetworkFeed({routes:["U7800"],socketFactory:()=>ws,now:()=>Date.parse("2026-10-18T14:00:30+08:00"),inflate:async()=>payload,onUpdate:bs=>latest=bs});
 try{feed.start();await ws.onmessage({data:"40"});await new Promise(r=>setTimeout(r,130));
 assert.ok(ws.sent.some(s=>s.includes('"route":"U7800"')));
 await ws.onmessage({data:'42["onFts-client","fixture"]'});assert.equal(latest.length,1);assert.equal(latest[0].route,"U7800");
 feed.setRoutes(["T7900"]);assert.equal(latest.length,0);
 }finally{feed.stop();}
});
test("late decompression from a stopped socket cannot restore old vehicles",async()=>{
 const ws=socket();let release,updates=0;const wait=new Promise(r=>release=r);
 const feed=new NetworkFeed({routes:["U7800"],socketFactory:()=>ws,now:()=>Date.parse("2026-10-18T14:00:30+08:00"),inflate:()=>wait,onUpdate:()=>updates++});
 feed.start();const pending=ws.onmessage({data:'42["onFts-client","fixture"]'});
 feed.stop();release(payload);await pending;assert.equal(updates,0);assert.equal(ws.closed,true);
});

