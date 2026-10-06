"use client";
import {useEffect,useState} from "react";
import {Check,HardDrive,LoaderCircle,Search,X} from "lucide-react";
import {connectDrive,listDriveVideos,selectDriveVideo} from "../lib/drive";

export default function DrivePicker({open,onClose,onSelect,returnTo,roomCode}){
 const [files,setFiles]=useState([]),[nextPage,setNextPage]=useState(null),[query,setQuery]=useState(""),[loading,setLoading]=useState(false),[selecting,setSelecting]=useState(""),[error,setError]=useState(""),[connected,setConnected]=useState(true);
 const load=async(pageToken,append=false)=>{
  setLoading(true);setError("");
  try{const result=await listDriveVideos(pageToken);setFiles(current=>append?[...current,...result.files]:result.files);setNextPage(result.nextPageToken);setConnected(true)}
  catch(exception){setError(exception.message);if(exception.status===409)setConnected(false)}
  finally{setLoading(false)}
 };
 useEffect(()=>{if(open){setQuery("");void load(null)}},[open]);
 if(!open)return null;
 const connect=async()=>{
  setLoading(true);setError("");
  try{const result=await connectDrive(returnTo);window.location.assign(result.authorizationUrl)}
  catch(exception){setError(exception.message);setLoading(false)}
 };
 const choose=async file=>{
  setSelecting(file.id);setError("");
  try{const result=await selectDriveVideo(file.id,roomCode);await onSelect(result.video);onClose()}
  catch(exception){setError(exception.message)}
  finally{setSelecting("")}
 };
 const filtered=files.filter(file=>file.name.toLowerCase().includes(query.trim().toLowerCase()));
 return <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&onClose()}>
  <section role="dialog" aria-modal="true" aria-labelledby="drive-picker-title" className="card flex max-h-[min(720px,90vh)] w-full max-w-xl flex-col overflow-hidden border border-white/10 bg-panel shadow-2xl">
   <header className="flex items-center gap-3 border-b border-white/10 p-4"><HardDrive size={18}/><h2 id="drive-picker-title" className="flex-1 text-base font-semibold">Google Drive videos</h2><button className="btn2 !p-2" onClick={onClose} aria-label="Close"><X size={16}/></button></header>
   <div className="flex items-center gap-2 border-b border-white/10 p-3"><Search size={16} className="text-slate-400"/><input autoFocus className="input !py-2" placeholder="Search videos" value={query} onChange={event=>setQuery(event.target.value)}/></div>
   {error&&<p role="alert" className="mx-3 mt-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-200">{error}</p>}
   {!connected&&<div className="grid flex-1 place-items-center p-8 text-center"><div className="space-y-3"><p className="text-sm text-slate-300">Connect the room host&apos;s Google Drive to choose a video.</p><button className="btn" disabled={loading} onClick={connect}><HardDrive size={15}/>{loading?"Connecting...":"Connect Google Drive"}</button></div></div>}
    {connected&&<div className="min-h-0 flex-1 overflow-y-auto p-2">{loading&&!files.length?<p className="flex items-center justify-center gap-2 p-8 text-sm text-slate-400"><LoaderCircle className="animate-spin" size={16}/>Loading videos</p>:filtered.length?filtered.map(file=><button key={file.id} disabled={!!selecting} onClick={()=>choose(file)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-white/5 disabled:opacity-60"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white/5"><HardDrive size={16}/></span><span className="min-w-0 flex-1"><span className="block truncate">{file.name}</span><span className="block text-xs text-slate-500">{file.mime} · {file.size?`${(file.size/1024/1024).toFixed(0)} MB`:"Size unavailable"}{file.width&&file.height?` · ${file.width}x${file.height}`:""}</span></span>{selecting===file.id?<LoaderCircle className="animate-spin" size={16}/>:<Check size={16} className="text-slate-500"/>}</button>):!loading?<p className="p-8 text-center text-sm text-slate-400">No supported videos found.</p>:null}</div>}
   {connected&&nextPage&&<footer className="border-t border-white/10 p-3"><button className="btn2 w-full justify-center" disabled={loading} onClick={()=>load(nextPage,true)}>{loading?<LoaderCircle className="animate-spin" size={15}/>:null}Load more</button></footer>}
  </section>
 </div>;
}