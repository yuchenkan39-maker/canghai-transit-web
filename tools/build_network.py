import base64,csv,gzip,io,json,os,time,zipfile,zlib
from pathlib import Path
import requests
OUT=Path("site/network");OUT.mkdir(exist_ok=True)
URL="https://api.data.gov.my/gtfs-static/prasarana?category="
catalog=[]; exports={}; diagnostics=[]
for category in ["rapid-bus-kl","rapid-bus-mrtfeeder"]:
    response=requests.get(URL+category,timeout=120);response.raise_for_status()
    archive=zipfile.ZipFile(io.BytesIO(response.content))
    def table(name):
        if name not in archive.namelist(): return []
        return list(csv.DictReader(io.TextIOWrapper(archive.open(name),"utf-8-sig")))
    routes=table("routes.txt");trips=table("trips.txt");stops={x["stop_id"]:x for x in table("stops.txt")}
    patterns={}
    for t in trips:
        patterns.setdefault(t["route_id"],{}).setdefault((t.get("direction_id",""),t.get("shape_id","")),t)
    tripids={t["trip_id"] for ps in patterns.values() for t in ps.values()}
    stopseq={}
    for row in table("stop_times.txt"):
        if row["trip_id"] in tripids:
            stopseq.setdefault(row["trip_id"],[]).append((int(row["stop_sequence"]),row["stop_id"]))
    shapes={}
    for row in table("shapes.txt"):
        shapes.setdefault(row["shape_id"],[]).append((int(row["shape_pt_sequence"]),round(float(row["shape_pt_lat"]),6),round(float(row["shape_pt_lon"]),6)))
    shapes={k:[[a,b] for _,a,b in sorted(v)] for k,v in shapes.items()}
    for r in routes:
        rid=r["route_id"];key=category+":"+rid;lines=[]
        for t in patterns.get(rid,{}).values():
            seq=sorted(stopseq.get(t["trip_id"],[]))
            lines.append(dict(direction=t.get("direction_id",""),headsign=t.get("trip_headsign",""),shape=shapes.get(t.get("shape_id",""),[]),stops=[dict(id=s,name=stops[s]["stop_name"],lat=float(stops[s]["stop_lat"]),lng=float(stops[s]["stop_lon"])) for _,s in seq if s in stops]))
        pts=[p for l in lines for p in l["shape"]]
        catalog.append(dict(key=key,id=rid,name=r.get("route_short_name") or rid,title=r.get("route_long_name",""),category=category,file="routes/"+str(len(catalog))+".json",bounds=[min(p[0] for p in pts),min(p[1] for p in pts),max(p[0] for p in pts),max(p[1] for p in pts)] if pts else None))
        exports[catalog[-1]["file"]]=dict(id=rid,name=catalog[-1]["name"],category=category,lines=lines)
    diagnostics.append(dict(category=category,routes=len(routes),stops=len(stops),trips=len(trips)))
(OUT/"routes").mkdir(exist_ok=True)
for p,obj in exports.items(): (OUT/p).write_text(json.dumps(obj,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
(OUT/"catalog.json").write_text(json.dumps(dict(source=URL,generatedAt=int(time.time()),routes=catalog),ensure_ascii=False,separators=(",",":")),encoding="utf-8")

