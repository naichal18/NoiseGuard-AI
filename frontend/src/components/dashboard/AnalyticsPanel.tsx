"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Download,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Waves,
} from "lucide-react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
type SourceFilter = "all" | "dataset" | "simulator" | "api" | "sensor";
type Period = 24 | 168 | 720;

type Sensor = { id:number; sensor_code:string; name:string; location:string; is_active:boolean };
type Reading = { id:number; sensor_id:number; noise_level:number; recorded_at:string; source:string; event_type:string };
type Settings = { day_limit_db:number; night_limit_db:number; timezone:string; high_noise_threshold_db:number; critical_noise_threshold_db:number };
type AnalysisReading = Reading & { period:"DAY"|"NIGHT"; localHour:number };
type TrendPoint = { timestamp:number; label:string; average:number; peak:number };
type SensorAnalysis = { label:string; location:string; average:number; peak:number; violations:number; readings:number };
type DayNightAnalysis = { day_average:number; night_average:number; day_count:number; night_count:number };
type AnalyticsSummary = {
  total_readings:number; average:number; peak:number; high:number; critical:number; normal:number; moderate:number; violations:number;
  trend:TrendPoint[]; sensor_rows:SensorAnalysis[]; day_night:DayNightAnalysis; events:{label:string; value:number; meta:string}[]; hourly:{label:string; value:number}[];
  timezone:string; day_limit_db:number; night_limit_db:number; high_noise_threshold_db:number; critical_noise_threshold_db:number;
};

const DEFAULT_SETTINGS: Settings = { day_limit_db:55, night_limit_db:45, timezone:"Asia/Kolkata", high_noise_threshold_db:85, critical_noise_threshold_db:95 };

const n = (v:unknown, fallback=0) => { const x=Number(v); return Number.isFinite(x)?x:fallback; };
const sourceName = (v:string) => String(v||"unknown").toLowerCase();
const eventName = (v:string) => String(v||"UNKNOWN").replaceAll("_"," ").replaceAll("NORMAL ACTIVITY","NORMAL");
const fmtTime = (v:string|number) => { const d=new Date(v); return Number.isNaN(d.getTime())?"--:--":d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",hour12:false}); };
const fmtDate = (v:string|number) => { const d=new Date(v); return Number.isNaN(d.getTime())?"--":d.toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit"}); };

function getRows(payload:unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const o=payload as Record<string,unknown>;
    for (const k of ["readings","data","items"]) if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return [];
}
function parseReading(row:unknown):Reading|null {
  if (!row || typeof row!=="object") return null;
  const r=row as Record<string,unknown>; const d=new Date(String(r.recorded_at??""));
  if (!Number.isFinite(n(r.id,NaN)) || !Number.isFinite(n(r.sensor_id,NaN)) || !Number.isFinite(n(r.noise_level,NaN)) || Number.isNaN(d.getTime())) return null;
  return { id:n(r.id), sensor_id:n(r.sensor_id), noise_level:n(r.noise_level), recorded_at:String(r.recorded_at), source:sourceName(String(r.source??"unknown")), event_type:String(r.event_type??"NORMAL_ACTIVITY") };
}
function parseSensors(payload:unknown):Sensor[] {
  const rows=Array.isArray(payload)?payload:(payload&&typeof payload==="object"&&Array.isArray((payload as Record<string,unknown>).sensors)?(payload as Record<string,unknown>).sensors as unknown[]:[]);
  return rows.filter((x):x is Record<string,unknown>=>!!x&&typeof x==="object").map(r=>({id:n(r.id),sensor_code:String(r.sensor_code??`NG-${String(r.id).padStart(3,"0")}`),name:String(r.name??"SENSOR"),location:String(r.location??r.name??"UNKNOWN"),is_active:Boolean(r.is_active??true)})).filter(s=>s.id>0);
}
function localParts(iso:string,tz:string) {
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:tz,hour:"2-digit",hourCycle:"h23"}).formatToParts(new Date(iso));
  return n(parts.find(p=>p.type==="hour")?.value,0);
}
function severity(level:number,s:Settings) { if(level>=s.critical_noise_threshold_db)return "CRITICAL"; if(level>=s.high_noise_threshold_db)return "HIGH"; if(level>s.day_limit_db)return "MODERATE"; return "NORMAL"; }
function selectWindow(readings:Reading[],source:SourceFilter,hours:Period) {
  const selected=source==="all"?readings:readings.filter(r=>sourceName(r.source)===source); if(!selected.length)return [];
  const latest=new Map<string,number>(); selected.forEach(r=>{const ts=new Date(r.recorded_at).getTime();const key=sourceName(r.source);if(Number.isFinite(ts))latest.set(key,Math.max(latest.get(key)??0,ts));});
  return selected.filter(r=>{const ts=new Date(r.recorded_at).getTime();const last=latest.get(sourceName(r.source));return !!last&&ts>=last-hours*3600000&&ts<=last;});
}
function trendData(rows:AnalysisReading[],hours:Period):TrendPoint[] {
  if(!rows)return[]; const ordered=[...rows].sort((a,b)=>+new Date(a.recorded_at)-+new Date(b.recorded_at)); const start=+new Date(ordered[0].recorded_at),end=+new Date(ordered.at(-1)!.recorded_at); const count=hours===24?24:hours===168?42:56; const size=Math.max((end-start)/count,60000); const buckets=new Map<number,number[]>();
  ordered.forEach(r=>{const ts=+new Date(r.recorded_at);const i=Math.min(count-1,Math.max(0,Math.floor((ts-start)/size)));const key=start+i*size;(buckets.get(key)??buckets.set(key,[]).get(key)!).push(r.noise_level);});
  return [...buckets].map(([timestamp,values])=>({timestamp,label:hours===24?fmtTime(timestamp):`${fmtDate(timestamp)} ${fmtTime(timestamp)}`,average:values.reduce((a,b)=>a+b,0)/values.length,peak:Math.max(...values)}));
}

function TrendChart({data,settings}:{data:TrendPoint[];settings:Settings}) {
  const W=960,H=300,L=45,R=16,T=18,B=35, pw=W-L-R,ph=H-T-B; const vals=data.flatMap(p=>[p.average,p.peak]); const max=Math.max(110,settings.critical_noise_threshold_db,...vals); const min=Math.min(30,settings.night_limit_db,...vals); const range=Math.max(1,max-min); const x=(i:number)=>L+(data.length<2?pw/2:i/(data.length-1)*pw); const y=(v:number)=>T+(max-v)/range*ph;
  const path=(key:"average"|"peak")=>data.map((p,i)=>`${i?"L":"M"} ${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  return <div className="border border-[#1f521f] bg-[#080b08]"><div className="flex items-center justify-between border-b border-dashed border-[#1f521f] px-3 py-2"><span className="flex items-center gap-2 text-[10px] text-[#33ff00]"><Activity size={13}/>NOISE LEVEL TREND</span><span className="text-[7px] text-[#1f9e1f]">LAST {data.length} TIME_BUCKETS</span></div><div className="overflow-x-auto p-2">{!data.length?<div className="flex h-[300px] items-center justify-center text-[8px] text-[#1f9e1f]">[ NO_ANALYTICS_DATA ]</div>:<svg viewBox={`0 0 ${W} ${H}`} className="min-w-[720px] w-full" role="img" aria-label="Noise level trend"><line x1={L} x2={L} y1={T} y2={H-B} stroke="#1f521f"/><line x1={L} x2={W-R} y1={H-B} y2={H-B} stroke="#1f521f"/>{[40,60,80,100,110].filter(v=>v>=min&&v<=max).map(v=><g key={v}><line x1={L} x2={W-R} y1={y(v)} y2={y(v)} stroke="#1f521f" strokeDasharray="4 5"/><text x={L-7} y={y(v)+3} textAnchor="end" fill="#1f9e1f" fontSize="9">{v}</text></g>)}<line x1={L} x2={W-R} y1={y(settings.high_noise_threshold_db)} y2={y(settings.high_noise_threshold_db)} stroke="#ffb000" strokeDasharray="8 5"/><line x1={L} x2={W-R} y1={y(settings.critical_noise_threshold_db)} y2={y(settings.critical_noise_threshold_db)} stroke="#ff3333" strokeDasharray="8 5"/><path d={path("average")} fill="none" stroke="#33ff00" strokeWidth="2.5"/><path d={path("peak")} fill="none" stroke="#ff3333" strokeWidth="1.5"/>{data.filter((_,i)=>i%Math.max(1,Math.floor(data.length/8))===0).map(p=>{const i=data.indexOf(p);return <text key={p.timestamp} x={x(i)} y={H-12} textAnchor="middle" fill="#1f9e1f" fontSize="8">{p.label}</text>})}<text x={L+6} y={y(settings.high_noise_threshold_db)-5} fill="#ffb000" fontSize="8">HIGH {settings.high_noise_threshold_db}</text><text x={L+6} y={y(settings.critical_noise_threshold_db)-5} fill="#ff3333" fontSize="8">CRITICAL {settings.critical_noise_threshold_db}</text></svg>}</div><div className="flex gap-4 border-t border-dashed border-[#1f521f] px-3 py-2 text-[7px]"><span className="text-[#33ff00]">━━ AVG</span><span className="text-[#ff3333]">━━ PEAK</span><span className="text-[#ffb000]">- - HIGH</span><span className="text-[#ff3333]">- - CRITICAL</span></div></div>;
}

function BarList({title,rows,suffix="",max}:{title:string;rows:{label:string;value:number;meta?:string}[];suffix?:string;max?:number}) { const scale=max??Math.max(1,...rows.map(r=>r.value)); return <div className="border border-[#1f521f] bg-[#080b08]"><div className="border-b border-dashed border-[#1f521f] px-3 py-2 text-[10px] text-[#33ff00]">{title}</div><div className="space-y-2 p-3">{rows?rows.map((r,i)=><div key={`${r.label}-${i}`}><div className="flex justify-between gap-2 text-[7px]"><span className="truncate text-[#1f9e1f]">{r.label}</span><span className="text-[#33ff00]">{r.value.toFixed(1)}{suffix}</span></div><div className="mt-1 h-2 border border-[#1f521f]"><div className="h-full bg-[#33ff00]" style={{width:`${Math.min(100,r.value/scale*100)}%`}}/></div>{r.meta&&<div className="mt-1 text-[6px] text-[#1f9e1f]">{r.meta}</div>}</div>):<div className="py-8 text-center text-[8px] text-[#1f9e1f]">[ NO_DATA ]</div>}</div></div>; }

function exportReport(stats:{average:number;peak:number;high:number;critical:number;violations:number},period:string,source:string,s:Settings){const body=["NOISEGUARD_AI // ANALYTICS REPORT","================================",`PERIOD: ${period}`,`SOURCE: ${source.toUpperCase()}`,`TIMEZONE: ${s.timezone}`,"",`AVERAGE: ${stats.average.toFixed(1)} dB`,`PEAK: ${stats.peak.toFixed(1)} dB`,`HIGH: ${stats.high}`,`CRITICAL: ${stats.critical}`,`VIOLATIONS: ${stats.violations}`,`DAY LIMIT: ${s.day_limit_db} dB`,`NIGHT LIMIT: ${s.night_limit_db} dB`].join("\n");const url=URL.createObjectURL(new Blob([body],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=`noiseguard-analytics-${period.toLowerCase()}.txt`;a.click();URL.revokeObjectURL(url);}

export default function AnalyticsPanel(){
  const [period,setPeriod]=useState<Period>(24),[source,setSource]=useState<SourceFilter>("all");
  const [sensors,setSensors]=useState<Sensor[]>([]),[settings,setSettings]=useState<Settings>(DEFAULT_SETTINGS);
  const [summary,setSummary]=useState<AnalyticsSummary>({
    total_readings:0,average:0,peak:0,high:0,critical:0,normal:0,moderate:0,violations:0,trend:[],sensor_rows:[],
    day_night:{day_average:0,night_average:0,day_count:0,night_count:0},events:[],hourly:[],timezone:DEFAULT_SETTINGS.timezone,
    day_limit_db:DEFAULT_SETTINGS.day_limit_db,night_limit_db:DEFAULT_SETTINGS.night_limit_db,high_noise_threshold_db:DEFAULT_SETTINGS.high_noise_threshold_db,critical_noise_threshold_db:DEFAULT_SETTINGS.critical_noise_threshold_db,
  });
  const [loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[error,setError]=useState("");

  const load=useCallback(async()=>{
    try{
      setRefreshing(true);
      const [analyticsResponse,sensorResponse]=await Promise.all([
        fetch(`${API_BASE_URL}/api/readings/analytics-summary?hours=${period}&source=${encodeURIComponent(source)}`,{cache:"no-store"}),
        fetch(`${API_BASE_URL}/api/sensors`,{cache:"no-store"}),
      ]);
      if(!analyticsResponse.ok)throw new Error(`ANALYTICS_API_${analyticsResponse.status}`);
      const [analyticsPayload,sensorPayload]=await Promise.all([analyticsResponse.json(),sensorResponse.ok?sensorResponse.json():Promise.resolve([])]);
      const a=analyticsPayload as Partial<AnalyticsSummary>;
      const nextSettings:Settings={
        day_limit_db:n(a.day_limit_db,55),
        night_limit_db:n(a.night_limit_db,45),
        timezone:String(a.timezone??"Asia/Kolkata"),
        high_noise_threshold_db:n(a.high_noise_threshold_db,85),
        critical_noise_threshold_db:n(a.critical_noise_threshold_db,95),
      };
      setSummary({
        total_readings:n(a.total_readings),average:n(a.average),peak:n(a.peak),high:n(a.high),critical:n(a.critical),normal:n(a.normal),moderate:n(a.moderate),violations:n(a.violations),
        trend:Array.isArray(a.trend)?a.trend as TrendPoint[]:[],
        sensor_rows:Array.isArray(a.sensor_rows)?a.sensor_rows as SensorAnalysis[]:[],
        day_night:(a.day_night&&typeof a.day_night==="object")?a.day_night as DayNightAnalysis:{day_average:0,night_average:0,day_count:0,night_count:0},
        events:Array.isArray(a.events)?a.events as {label:string;value:number;meta:string}[]:[],
        hourly:Array.isArray(a.hourly)?a.hourly as {label:string;value:number}[]:[],
        timezone:nextSettings.timezone,day_limit_db:nextSettings.day_limit_db,night_limit_db:nextSettings.night_limit_db,
        high_noise_threshold_db:nextSettings.high_noise_threshold_db,critical_noise_threshold_db:nextSettings.critical_noise_threshold_db,
      });
      setSettings(nextSettings);
      setSensors(parseSensors(sensorPayload));
      setError("");
    }catch(e){setError(e instanceof Error?e.message:"ANALYTICS_BACKEND_UNAVAILABLE");}
    finally{setLoading(false);setRefreshing(false);}
  },[period,source]);

  useEffect(()=>{void load();},[load]);

  const stats={average:summary.average,peak:summary.peak,high:summary.high,critical:summary.critical,normal:summary.normal,moderate:summary.moderate,violations:summary.violations};
  const trend=summary.trend;
  const sensorRows=summary.sensor_rows;
  const dayNight=summary.day_night;
  const events=summary.events;
  const hourly=summary.hourly;
  const rowsLength=summary.total_readings;
  const periodLabel=period===24?"24H":period===168?"7D":"30D";

  const insights=useMemo(()=>{const top=sensorRows[0];const peakHour=[...hourly].sort((a,b)=>b.value-a.value)[0];const diff=dayNight.night_average?((dayNight.day_average-dayNight.night_average)/dayNight.night_average*100):0;return[top?`Highest average sensor: ${top.label} at ${top.average.toFixed(1)} dB.`:"No sensor data available.",peakHour?`Peak hourly average occurs around ${peakHour.label} (${peakHour.value.toFixed(1)} dB).`:"Hourly pattern unavailable.",`Noise-limit breaches: ${stats.violations.toLocaleString()} readings in the selected window.`,dayNight.day_average&&dayNight.night_average?`Daytime average is ${Math.abs(diff).toFixed(1)}% ${diff>=0?"higher":"lower"} than nighttime average.`:"Day/night comparison unavailable."];},[sensorRows,hourly,dayNight,stats.violations]);

  return <section className="space-y-3" aria-label="Noise analytics">
    <div className="border border-[#1f521f] bg-[#080b08]"><div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-[1fr_auto] xl:items-center"><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center border border-[#33ff00] text-[#33ff00]"><BarChart3 size={24}/></div><div><div className="text-[16px] font-bold text-[#33ff00]">ANALYTICS</div><div className="text-[8px] text-[#1f9e1f]">DETAILED NOISE DATA ANALYSIS // INSIGHTS // COMPLIANCE TRENDS</div></div></div><div className="flex flex-wrap items-center justify-end gap-2 text-[8px]"><span className="text-[#1f9e1f]">TIME_RANGE:</span>{[24,168,720].map(v=><button key={v} type="button" onClick={()=>setPeriod(v as Period)} className={`min-w-[48px] border px-3 py-2 ${period===v?"border-[#33ff00] bg-[#33ff00] text-black":"border-[#1f521f] text-[#33ff00]"}`}>{v===24?"24H":v===168?"7D":"30D"}</button>)}<select value={source} onChange={e=>setSource(e.target.value as SourceFilter)} className="min-w-[145px] border border-[#1f521f] bg-[#080b08] px-3 py-2 text-[8px] text-[#33ff00] outline-none"><option value="all">ALL SOURCES</option><option value="dataset">DATASET</option><option value="simulator">SIMULATOR</option><option value="api">API</option><option value="sensor">SENSOR</option></select><button type="button" onClick={()=>void load()} disabled={refreshing} className="terminal-button inline-flex items-center gap-2 px-3 py-2 text-[8px]"><RefreshCw size={11} className={refreshing?"animate-spin":""}/>[ REFRESH ]</button></div></div></div>
    {error&&<div className="border border-[#ff3333] bg-[#120606] p-3 text-[8px] text-[#ff3333]">[ ANALYTICS_ERROR ] {error}</div>}
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">{[["AVERAGE NOISE LEVEL",stats.average,"dB","normal"],["PEAK NOISE LEVEL",stats.peak,"dB","critical"],["TOTAL READINGS",rowsLength,"","normal"],["NOISE VIOLATIONS",stats.violations,"","high"],["ACTIVE SENSORS",sensors.filter(s=>s.is_active).length,`/ ${sensors.length}`,"normal"]].map(([label,value,suffix,tone])=><div key={String(label)} className="border border-[#1f521f] bg-[#080b08] p-3"><div className="flex items-center gap-2 text-[8px] text-[#1f9e1f]">{tone==="critical"||tone==="high"?<ShieldAlert size={12} className="text-[#ff3333]"/>:<Waves size={12} className="text-[#33ff00]"/>}{label}</div><div className={`mt-2 text-[21px] font-bold ${tone==="critical"?"text-[#ff3333]":tone==="high"?"text-[#ffb000]":"text-[#33ff00]"}`}>{n(value).toFixed(label==="TOTAL READINGS"||label==="NOISE VIOLATIONS"||label==="ACTIVE SENSORS"?0:1)}<span className="ml-1 text-[8px] text-[#ffb000]">{suffix}</span></div></div>)}</div>
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.9fr)]"><TrendChart data={trend} settings={settings}/><BarList title="SENSOR COMPARISON (AVG NOISE)" rows={sensorRows.slice(0,6).map(r=>({label:r.label,value:r.average,meta:`${r.location} // PEAK ${r.peak.toFixed(1)} dB`}))} suffix=" dB"/></div>
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(300px,1.1fr)_minmax(300px,0.9fr)_minmax(320px,1fr)]">
      <div className="border border-[#1f521f] bg-[#080b08]"><div className="border-b border-dashed border-[#1f521f] px-3 py-2 text-[10px] text-[#33ff00]">DAY VS NIGHT ANALYSIS</div><div className="grid grid-cols-2 gap-2 p-2"><div className="border border-[#1f521f] p-3"><div className="text-[8px] text-[#ffb000]">☀ DAY // 06:00-22:00</div><div className="mt-2 text-[23px] font-bold text-[#ffb000]">{dayNight.day_average.toFixed(1)}<span className="ml-1 text-[8px]">dB</span></div><div className="text-[7px] text-[#1f9e1f]">{dayNight.day_count.toLocaleString()} READINGS</div><div className="mt-3 h-2 border border-[#1f521f]"><div className="h-full bg-[#ffb000]" style={{width:`${Math.min(100,dayNight.day_average/110*100)}%`}}/></div></div><div className="border border-[#1f521f] p-3"><div className="text-[8px] text-[#55ccff]">☾ NIGHT // 22:00-06:00</div><div className="mt-2 text-[23px] font-bold text-[#55ccff]">{dayNight.night_average.toFixed(1)}<span className="ml-1 text-[8px]">dB</span></div><div className="text-[7px] text-[#1f9e1f]">{dayNight.night_count.toLocaleString()} READINGS</div><div className="mt-3 h-2 border border-[#1f521f]"><div className="h-full bg-[#55ccff]" style={{width:`${Math.min(100,dayNight.night_average/110*100)}%`}}/></div></div></div><div className="border-t border-dashed border-[#1f521f] px-3 py-2 text-[7px] text-[#1f9e1f]">LIMITS: DAY {settings.day_limit_db} dB / NIGHT {settings.night_limit_db} dB <span className="ml-3 text-[#33ff00]">TZ: {settings.timezone}</span></div></div>
      <div className="border border-[#1f521f] bg-[#080b08]"><div className="border-b border-dashed border-[#1f521f] px-3 py-2 text-[10px] text-[#33ff00]">NOISE LEVEL DISTRIBUTION</div><div className="flex items-center gap-4 p-3"><div className="relative h-28 w-28 shrink-0 rounded-full" style={{background:"conic-gradient(#33ff00 0 62%,#ffb000 62% 84%,#ff8c00 84% 95%,#ff3333 95% 100%)"}}><div className="absolute inset-[18px] flex flex-col items-center justify-center rounded-full bg-[#080b08]"><span className="text-[17px] font-bold text-[#33ff00]">{rowsLength.toLocaleString()}</span><span className="text-[7px] text-[#1f9e1f]">TOTAL</span></div></div><div className="space-y-2 text-[8px]">{[["NORMAL",stats.normal,"#33ff00"],["MODERATE",stats.moderate,"#ffb000"],["HIGH",stats.high,"#ff8c00"],["CRITICAL",stats.critical,"#ff3333"]].map(([label,count,color])=><div key={String(label)} className="flex justify-between gap-4 text-[#1f9e1f]"><span><i className="mr-2 inline-block h-2 w-2" style={{backgroundColor:String(color)}}/>{label}</span><span className="text-[#33ff00]">{Number(count).toLocaleString()}</span></div>)}</div></div></div>
      <BarList title="EVENT TYPE ANALYSIS" rows={events} suffix="%" max={100}/>
    </div>
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)_minmax(300px,0.75fr)]">
      <div className="border border-[#1f521f] bg-[#080b08]"><div className="flex items-center justify-between border-b border-dashed border-[#1f521f] px-3 py-2"><span className="flex items-center gap-2 text-[10px] text-[#33ff00]"><TrendingUp size={13}/>TOP NOISY LOCATIONS</span><span className="text-[7px] text-[#1f9e1f]">BY AVERAGE NOISE // {periodLabel}</span></div><div className="overflow-x-auto"><table className="w-full min-w-[540px] text-[7px]"><thead><tr className="border-b border-[#1f521f] text-left text-[#1f9e1f]"><th className="px-2 py-2">#</th><th className="px-2 py-2">LOCATION</th><th className="px-2 py-2">SENSOR</th><th className="px-2 py-2">AVG dB</th><th className="px-2 py-2">PEAK dB</th><th className="px-2 py-2">BREACHES</th></tr></thead><tbody>{sensorRows.slice(0,6).map((r,i)=><tr key={r.label} className="border-b border-[#102510]"><td className="px-2 py-2 text-[#ffb000]">{i+1}</td><td className="px-2 py-2 text-[#33ff00]">{r.location}</td><td className="px-2 py-2 text-[#1f9e1f]">{r.label}</td><td className="px-2 py-2 text-[#33ff00]">{r.average.toFixed(1)}</td><td className="px-2 py-2 text-[#ff3333]">{r.peak.toFixed(1)}</td><td className="px-2 py-2 text-[#ffb000]">{r.violations}</td></tr>)}</tbody></table></div></div>
      <BarList title="HOURLY NOISE PATTERN" rows={hourly} suffix=" dB" max={110}/>
      <div className="border border-[#1f521f] bg-[#080b08]"><div className="flex items-center gap-2 border-b border-dashed border-[#1f521f] px-3 py-2 text-[10px] text-[#33ff00]"><Activity size={13}/>INSIGHTS & TRENDS</div><div className="space-y-2 p-3">{insights.map((x,i)=><div key={x} className="border-b border-[#102510] pb-2 text-[7px] leading-relaxed text-[#1f9e1f]"><span className="mr-2 text-[#33ff00]">[{String(i+1).padStart(2,"0")}]</span>{x}</div>)}<div className="border-t border-dashed border-[#1f521f] pt-2 text-[7px] text-[#1f9e1f]">SOURCE: <span className="text-[#33ff00]">{source.toUpperCase()}</span><br/>PERIOD: <span className="text-[#33ff00]">{periodLabel}</span><br/>TZ: <span className="text-[#33ff00]">{settings.timezone}</span></div><button type="button" onClick={()=>exportReport(stats,periodLabel,source,settings)} className="terminal-button mt-2 inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-[8px]"><Download size={11}/>[ EXPORT ANALYTICS REPORT ]</button></div></div>
    </div>
    <div className="border border-dashed border-[#1f521f] p-2 text-[7px] text-[#1f9e1f]"><div className="flex flex-wrap gap-x-5 gap-y-1">READINGS_ANALYZED: <span className="text-[#33ff00]">{rowsLength.toLocaleString()}</span> AVG: <span className="text-[#33ff00]">{stats.average.toFixed(1)} dB</span> PEAK: <span className="text-[#ff3333]">{stats.peak.toFixed(1)} dB</span> HIGH: <span className="text-[#ffb000]">{stats.high.toLocaleString()}</span> CRITICAL: <span className="text-[#ff3333]">{stats.critical.toLocaleString()}</span> ENGINE: <span className="text-[#33ff00]">[ ANALYTICS_ONLINE ]</span></div></div>
    {loading&&<div className="border border-[#1f521f] p-2 text-[8px] text-[#1f9e1f]">[ LOADING_ANALYTICS_DATA ]</div>}
  </section>;
}
