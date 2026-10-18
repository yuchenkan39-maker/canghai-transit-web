// Same Engine.IO v3 / onFts-reload protocol as the original four-route app.
import { WS_URL, reloadFrame, parseFrame, parseBuses } from "./core.js";

export function requestSpacing(routeCount) { return Math.max(350, 5000 / Math.max(1, routeCount)); }
export function retentionMs(routeCount) { return Math.max(20000, requestSpacing(routeCount) * routeCount * 1.5); }
export function freshPositions(seen, routes, now) {
  const keep = retentionMs(routes.size);
  return [...seen.values()].filter(v => routes.has(v.bus.route) && now-v.seenMs <= keep && now-v.bus.gpsMs <= 300000 && v.bus.gpsMs-now <= 60000).map(v=>v.bus);
}
export async function inflatePayload(b64) {
  const bytes=Uint8Array.from(atob(b64.trim()), c=>c.charCodeAt(0));
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream(bytes[0]===31&&bytes[1]===139?"gzip":"deflate"));
  return new Response(stream).text();
}
export class NetworkFeed {
  constructor({routes=[],onUpdate=()=>{},onStatus=()=>{},socketFactory=u=>new WebSocket(u),now=Date.now,inflate=inflatePayload}={}) {
    Object.assign(this,{onUpdate,onStatus,socketFactory,now,inflate});
    this.routes=[...new Set(routes)];this.seen=new Map();this.generation=0;this.backoff=2000;
    this.stopped=true;this.timer=null;this.retry=null;this.ws=null;
  }
  setRoutes(routes) {
    this.routes=[...new Set(routes)];this.cursor=0;this.nextPoll=0;
    for(const [k,v] of this.seen)if(!this.routes.includes(v.bus.route))this.seen.delete(k);
    this.publish();
  }
  publish() { this.onUpdate(freshPositions(this.seen,new Set(this.routes),this.now())); }
  start() { if(!this.stopped)return;this.stopped=false;this.connect(); }
  stop() { this.stopped=true;this.generation++;clearInterval(this.timer);clearTimeout(this.retry);this.ws?.close();this.ws=null; }
  connect() {
    if(this.stopped)return;
    clearInterval(this.timer);clearTimeout(this.retry);
    const generation=++this.generation;let dead=false,ready=false;
    this.onStatus({connected:false,message:"正在连接 Rapid Bus 实时数据…"});
    let ws;
    const fail=message=>{
      if(dead||this.stopped||generation!==this.generation)return;
      dead=true;clearInterval(this.timer);ws?.close();
      this.seen.clear();this.publish();
      this.onStatus({connected:false,message:message+"，"+Math.round(this.backoff/1000)+" 秒后重连"});
      this.retry=setTimeout(()=>this.connect(),this.backoff);this.backoff=Math.min(30000,this.backoff*2);
    };
    try{ws=this.socketFactory(WS_URL);this.ws=ws;}catch(e){fail("连接失败");return;}
    let lastData=this.now(),lastPing=this.now(),pingMs=25000,lastSweep=0;
    this.cursor=0;this.nextPoll=0;
    ws.onclose=()=>fail("连接中断");ws.onerror=()=>fail("网络错误");
    ws.onmessage=async event=>{
      if(dead||generation!==this.generation||this.stopped)return;
      const f=parseFrame(event.data);
      if(f.type==="open")pingMs=f.ping;
      else if(f.type==="connected"){ready=true;this.onStatus({connected:true,message:"已连接，正在逐条查询线路…"});}
      else if(f.type==="ping")ws.send("3");
      else if(f.type==="close")fail("服务器断开");
      else if(f.type==="event"&&f.name==="onFts-client"&&typeof f.data==="string"){
        try{
          const text=await this.inflate(f.data);
          if(dead||generation!==this.generation||this.stopped)return;
          const now=this.now(),buses=parseBuses(text,now,this.routes);
          lastData=now;this.backoff=2000;
          for(const bus of buses)this.seen.set(bus.route+"/"+bus.id,{bus,seenMs:now});
          this.publish();this.onStatus({connected:true,message:"正在接收实时位置",updatedAt:now});
        }catch(e){/* Invalid frames do not erase the last valid snapshot. */}
      }
    };
    this.timer=setInterval(()=>{
      if(dead||generation!==this.generation)return;
      const now=this.now();
      if(ready&&ws.readyState===1&&this.routes.length&&now>=this.nextPoll){
        ws.send(reloadFrame(this.routes[this.cursor%this.routes.length]));
        this.cursor=(this.cursor+1)%this.routes.length;this.nextPoll=now+requestSpacing(this.routes.length);
      }
      if(ready&&ws.readyState===1&&now-lastPing>=pingMs){ws.send("2");lastPing=now;}
      if(this.routes.length&&now-lastData>45000&&!ready)fail("连接握手超时");
      else if(this.routes.length&&ready&&now-lastData>Math.max(45000,this.routes.length*requestSpacing(this.routes.length)+15000))fail("没有收到数据");
      if(now-lastSweep>=1000){
        for(const [k,v]of this.seen)if(now-v.seenMs>retentionMs(this.routes.length)||now-v.bus.gpsMs>300000)this.seen.delete(k);
        this.publish();lastSweep=now;
      }
    },100);
  }
}

