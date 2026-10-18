"""Build aggregate bus-speed priors from a published KRI parquet; no API key.

Only aggregates are exported. GPS positions and vehicle identifiers stay in the
temporary build workspace. Counts/dates are preserved so sparse cells cannot
silently turn into confident estimates. Terminal waiting is excluded.
"""
import argparse, json, math, tempfile, time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
import requests
import pyarrow.parquet as pq

SOURCE='https://kri-public-data.s3.ap-southeast-1.amazonaws.com/GTFS/vehicle_positions/year%3D2026/vehicle_positions_202604.parquet'
CELL=.003
TZ=timezone(timedelta(hours=8))
def meters(a,b):
    return math.hypot((b[1]-a[1])*111320*math.cos(math.radians((a[0]+b[0])/2)),(b[0]-a[0])*110574)
def heading(a,b):
    return math.degrees(math.atan2((b[1]-a[1])*math.cos(math.radians((a[0]+b[0])/2)),b[0]-a[0]))%360
def key_for(lat,lng,angle,day,hour):
    return f'{math.floor(lat/CELL)},{math.floor(lng/CELL)},{math.floor((angle+22.5)%360/45)},{day},{hour//3}'
def build(source=SOURCE,out=Path('site/history')):
    catalog=json.loads(Path('site/network/catalog.json').read_text())['routes']
    routes={r['id']:r for r in catalog if r['category']=='rapid-bus-kl'}
    terminals={}
    for rid,r in routes.items():
        data=json.loads((Path('site/network')/r['file']).read_text())
        terminals[rid]=[(s['lat'],s['lng']) for l in data['lines'] if l['stops'] for s in [l['stops'][0],l['stops'][-1]]]
    stats=defaultdict(lambda:[0.,0.,0,set(),set()])
    last={};rows=accepted=0;min_t=float('inf');max_t=0;held=[]
    # The published April file is bounded (~85 MB); abort instead of accepting an unbounded download.
    with tempfile.TemporaryDirectory() as tmp:
        path=Path(tmp)/'raw.parquet'
        with requests.get(source,stream=True,timeout=(20,120)) as response:
            response.raise_for_status();size=0
            with path.open('wb') as f:
                for block in response.iter_content(1024*1024):
                    size+=len(block)
                    if size>350*1024*1024:raise ValueError('Historical file exceeds build budget')
                    f.write(block)
        parquet=pq.ParquetFile(path)
        print('Downloaded bytes',size,'rows',parquet.metadata.num_rows,flush=True)
        for batch in parquet.iter_batches(batch_size=65536,columns=['timestamp','route_id','latitude','longitude','vehicle_id','bearing','speed']):
            columns=batch.to_pydict()
            for values in zip(*(columns[k] for k in ['timestamp','route_id','latitude','longitude','vehicle_id','bearing','speed'])):
                rows+=1
                try:
                    ts,rid,lat,lng,vid,brg,spd=values
                    ts=float(ts);lat=float(lat);lng=float(lng);spd=float(spd);brg=float(brg)
                    if rid not in routes or not(1<=lat<=7.5 and 99<=lng<=120 and 0<=spd<=100):continue
                    if not all(math.isfinite(x) for x in [ts,lat,lng,spd,brg]):continue
                except (ValueError,TypeError):continue
                min_t=min(min_t,ts);max_t=max(max_t,ts)
                tag=(rid,vid);previous=last.get(tag)
                if previous and ts<=previous[0]:continue
                last[tag]=(ts,lat,lng,spd,brg)
                if not previous:continue
                dt=ts-previous[0]
                if not 5<=dt<=120:continue
                a=previous[1:3];b=(lat,lng);distance=meters(a,b)
                if distance/dt*3.6>90:continue
                if any(meters(b,t)<100 for t in terminals[rid]):continue
                angle=heading(a,b) if distance>=15 else brg
                # Heading jumps/reversals cannot establish a consistent directed segment.
                if distance>=15 and abs((angle-brg+540)%360-180)>70:continue
                local=datetime.fromtimestamp(ts,TZ)
                mid=((a[0]+lat)/2,(a[1]+lng)/2)
                key=key_for(*mid,angle,int(local.weekday()>=5),local.hour)
                # Hold the last calendar week out for a small, honest diagnostic.
                if local.day>=24:
                    if distance>=50 and previous[3]>=3 and len(held)<150000:held.append((rid,key,distance,dt,previous[3]))
                else:
                    s=stats[(rid,key)];s[0]+=distance;s[1]+=dt;s[2]+=1;s[3].add(local.date().isoformat());s[4].add(vid)
                accepted+=1
            print('Processed',rows,'accepted intervals',accepted,flush=True)
    def compact(s):
        dist,seconds,n,days,vehicles=s;speed=dist/seconds*3.6 if seconds else 0
        if n<12 or len(days)<3 or len(vehicles)<2 or not 3<=speed<=65:return None
        return [round(speed,2),n,len(days),len(vehicles)]
    validation={'samples':0,'modelAbsSeconds':0.,'instantSpeedAbsSeconds':0.}
    for rid,key,dist,dt,instant in held:
        record=compact(stats.get((rid,key),[0,0,0,set(),set()]))
        if record:
            validation['samples']+=1
            validation['modelAbsSeconds']+=abs(dist/(record[0]/3.6)-dt)
            validation['instantSpeedAbsSeconds']+=abs(dist/(instant/3.6)-dt)
    if validation['samples']:
        for k in ['modelAbsSeconds','instantSpeedAbsSeconds']:validation[k]=round(validation[k]/validation['samples'],2)
    # Re-read held-out observations is unnecessary: deployment deliberately uses training-only priors.
    # This preserves the validation split and discloses the actual training date range.
    out.mkdir(parents=True,exist_ok=True);files={};cells=0
    for rid in routes:
        entries={key:v for (route,key),s in stats.items() if route==rid and (v:=compact(s))}
        if not entries:continue
        file=rid+'.json';(out/file).write_text(json.dumps(entries,separators=(',',':')))
        files[rid]={'file':file,'cells':len(entries)};cells+=len(entries)
    if not files:raise ValueError('No history cells passed quality thresholds')
    metadata={'version':1,'source':source,'sourcePage':'https://www.krinstitute.org/publications/gklmob','sourceMonth':'2026-04','training':'2026-04-01 / 2026-04-23','builtAt':int(time.time()),'observedFrom':datetime.fromtimestamp(min_t,TZ).isoformat(),'observedTo':datetime.fromtimestamp(max_t,TZ).isoformat(),'cellDegrees':CELL,'hourBand':3,'minDays':3,'minVehicles':2,'rawRows':rows,'acceptedIntervals':accepted,'cells':cells,'routes':files,'validation':validation,'method':'Time-weighted distance/time from consecutive 5–120s GPS intervals; stop waiting included except within 100m of GTFS terminals. Minimum 12 intervals, 3 days, 2 vehicles per directed cell/time band. Training days 1–23; days 24 onward held out. Weekends are calendar weekends, not public holidays.'}
    (out/'catalog.json').write_text(json.dumps(metadata,separators=(',',':')))
    print('HISTORY_RESULT',json.dumps({k:v for k,v in metadata.items() if k!='routes'}),flush=True)
    print('ROUTE_COVERAGE',len(files),flush=True)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',default=SOURCE);args=parser.parse_args();build(args.source)
