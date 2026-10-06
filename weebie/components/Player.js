"use client";
import {useEffect,useRef,useState} from "react";
import Hls from "hls.js";
import {loadYT} from "../lib/youtube";
import PlayerSettings from "./PlayerSettings";
import PlayerControls from "./PlayerControls";
import {PLAYBACK_RATES,expectedPlaybackPosition,playbackCorrection} from "../lib/playbackSync.cjs";
import {buildQualityOptions,isOriginalPlayable} from "../lib/mediaQuality";
import {AUTO_QUALITY,ORIGINAL_QUALITY,applyHlsQualityMode,capturePlaybackState,getViewerQualitySessionId,qualityPreferenceKey as makeQualityPreferenceKey,restorePlaybackState,updateAdaptiveLevelCap} from "../lib/qualityPreference.cjs";

export default function Player({source,url,onEvent,onError,onAutoplayBlocked,onBuffering,onPlaybackRateChange,onPlaybackApplied,playbackRate=1,apiRef,canControl=true,onToggleFullscreen,isFullscreen=false,isBuffering=false}){
 const host=useRef(),vid=useRef(),yt=useRef(),hls=useRef(),programmaticChange=useRef(false),programmaticChangeTimer=useRef(null),pauseReassert=useRef(null),pending=useRef(),remote=useRef(),ev=useRef(),lastHardCorrection=useRef(-10000),forceInitialSeek=useRef(true),lastProgressEmit=useRef(),pendingQualitySwitch=useRef(null),qualityPreferenceRef=useRef(AUTO_QUALITY),qualityController=useRef({cap:-1,lastChangeAt:0}),qualitySwitching=useRef(false);
 const playbackRateRef=useRef(playbackRate),bufferingRef=useRef(onBuffering);
 const [settingsOpen,setSettingsOpen]=useState(false),[audioTracks,setAudioTracks]=useState([]),[subtitleTracks,setSubtitleTracks]=useState([]),[activeAudio,setActiveAudio]=useState(-1),[activeSubtitle,setActiveSubtitle]=useState(-1),[availableRates,setAvailableRates]=useState(null),[videoDimensions,setVideoDimensions]=useState({width:0,height:0}),[audioTrackApiAvailable,setAudioTrackApiAvailable]=useState(false),[subtitleTrackApiAvailable,setSubtitleTrackApiAvailable]=useState(false),[mediaDecodeFailed,setMediaDecodeFailed]=useState(false),[externalSubtitle,setExternalSubtitle]=useState(null),[subtitleInputError,setSubtitleInputError]=useState(""),[qualityPreference,setQualityPreference]=useState(AUTO_QUALITY),[qualityPreferenceLoaded,setQualityPreferenceLoaded]=useState(false),[qualityViewerId,setQualityViewerId]=useState(""),[activeQuality,setActiveQuality]=useState("Original"),[hlsSupport,setHlsSupport]=useState({js:false,native:false}),[hlsError,setHlsError]=useState(false);
 ev.current=onEvent;
 playbackRateRef.current=playbackRate;bufferingRef.current=onBuffering;
 qualityPreferenceRef.current=qualityPreference;
 const markProgrammaticChange=()=>{programmaticChange.current=true;clearTimeout(programmaticChangeTimer.current);programmaticChangeTimer.current=setTimeout(()=>{programmaticChange.current=false;programmaticChangeTimer.current=null},1500)};
 const emit=e=>{
  if(pending.current){apply(pending.current);return}
  if(programmaticChange.current||!canControl)return;
  ev.current(e);
  if(e.eventType==="pause"&&!e.playing){
   clearTimeout(pauseReassert.current);
   const pauseState={...e};
   pauseReassert.current=setTimeout(()=>{
    const video=vid.current,player=yt.current,isPaused=video?video.paused:player?.getPlayerState?.()===2;
    if(canControl&&!programmaticChange.current&&isPaused)ev.current(pauseState);
    pauseReassert.current=null;
   },2000);
  }else if(e.eventType!=="progress"){
   clearTimeout(pauseReassert.current);
   pauseReassert.current=null;
  }
 };
 useEffect(()=>()=>{clearTimeout(programmaticChangeTimer.current);clearTimeout(pauseReassert.current)},[]);
 useEffect(()=>{
  clearTimeout(pauseReassert.current);
  pauseReassert.current=null;
  if(canControl){
   clearTimeout(programmaticChangeTimer.current);
   programmaticChangeTimer.current=null;
   programmaticChange.current=false;
   remote.current=null;pending.current=null;lastHardCorrection.current=-10000;forceInitialSeek.current=true;
  }
 },[canControl]);
 const completeQualitySwitch=(video,snapshot)=>restorePlaybackState(video,snapshot,()=>{if(pendingQualitySwitch.current===snapshot)pendingQualitySwitch.current=null;qualitySwitching.current=false});
 const apply=s=>{
  if(!s)return;
  const key=`${s.eventTimestamp||0}:${s.time}:${s.playing}:${s.playbackRate||1}:${s.eventType}`;
  if(remote.current?.key===key&&!pending.current)return;
  const receivedAt=performance.now(),playback={...s,playbackRate:Number(s.playbackRate)||1,key,receivedAt,wallClockAtReceive:Date.now()};
  const p=yt.current,v=vid.current;
  if(!p?.seekTo&&(!v||v.readyState<1)){pending.current=s;return false}
  markProgrammaticChange();
  remote.current=playback;
  const expected=expectedPlaybackPosition(playback,receivedAt);
  if(p?.seekTo){
   const rate=playback.playbackRate,drift=expected-p.getCurrentTime(),correction=playbackCorrection(drift,s.eventType,lastHardCorrection.current,receivedAt,rate);
   if(correction.seek||forceInitialSeek.current&&Math.abs(drift)>0.65){p.seekTo(expected,true);lastHardCorrection.current=receivedAt;forceInitialSeek.current=false}
   if(p.getPlaybackRate?.()!==rate)p.setPlaybackRate?.(rate);
   const playerState=p.getPlayerState?.();
   if(s.playing&&playerState!==1)p.playVideo();else if(!s.playing&&playerState!==2)p.pauseVideo();
   pending.current=null;
  }else{
   const rate=playback.playbackRate,drift=expected-v.currentTime,correction=playbackCorrection(drift,s.eventType,lastHardCorrection.current,receivedAt,rate);
   v.playbackRate=rate;
   if(correction.seek||forceInitialSeek.current&&Math.abs(drift)>0.65){v.currentTime=expected;lastHardCorrection.current=receivedAt;forceInitialSeek.current=false}
   if(s.playing&&v.paused){const action=v.play();action?.catch(()=>onAutoplayBlocked?.())}
   else if(!s.playing&&!v.paused)v.pause();
   pending.current=null;
  }
  onPlaybackApplied?.(s);
  return true;
 };
 const enable=()=>{const p=yt.current,v=vid.current;if(p?.playVideo)p.playVideo();else if(v){const playback=remote.current;if(playback?.playing){const expected=expectedPlaybackPosition(playback,performance.now());if(Math.abs(expected-v.currentTime)>0.65)v.currentTime=expected}v.play().catch(()=>onAutoplayBlocked?.())}};
 const restore=s=>{if(!s)return false;remote.current=null;pending.current=null;forceInitialSeek.current=true;lastHardCorrection.current=-10000;return apply(s)};
 const getTime=()=>{const v=vid.current,p=yt.current;return v?v.currentTime:Number(p?.getCurrentTime?.())||0};
 apiRef.current={apply,enable,restore,getTime};
 const ytKey=source?.type==="yt"?source.id:null;
 const sourceWidth=Number(source?.sourceResolution?.width)||Number(source?.width)||videoDimensions.width,sourceHeight=Number(source?.sourceResolution?.height)||Number(source?.height)||videoDimensions.height;
 const originalPlayable=isOriginalPlayable(source,mime=>vid.current?.canPlayType(mime))&&!mediaDecodeFailed;
 const qualityOptions=source?.type==="drive"&&source.qualityStatus==="ready"?buildQualityOptions({...source,width:sourceWidth,height:sourceHeight}).filter(option=>option.id!==ORIGINAL_QUALITY||originalPlayable):[];
 const qualityOptionsSignature=qualityOptions.map(option=>option.id).join(",");
 const hasGeneratedQualities=qualityOptions.some(option=>option.kind==="rendition");
 const qualityKey=makeQualityPreferenceKey(typeof window!=="undefined"?window.location.pathname:"room",source?.fileId||source?.id||"source",qualityViewerId);
 const canUseHls=source?.type==="drive"&&hasGeneratedQualities&&qualityPreferenceLoaded&&!hlsError&&(hlsSupport.js||hlsSupport.native);
 const hlsUrl=url?`${url}/hls/master.m3u8`:"";
 const nativeHlsUrl=qualityPreference===AUTO_QUALITY?hlsUrl:qualityPreference===ORIGINAL_QUALITY?url:`${url}/hls/${qualityPreference}/index.m3u8`;
 useEffect(()=>{setAvailableRates(null)},[ytKey]);
 useEffect(()=>{try{setQualityViewerId(getViewerQualitySessionId(window.sessionStorage))}catch{setQualityViewerId("")}},[]);
 useEffect(()=>{setVideoDimensions({width:0,height:0});setAudioTrackApiAvailable(false);setSubtitleTrackApiAvailable(false);setMediaDecodeFailed(false);setExternalSubtitle(null);setSubtitleInputError("")},[source?.type,source?.fileId,source?.id]);
 useEffect(()=>{const video=vid.current;if(video)setHlsSupport({js:Hls.isSupported(),native:Boolean(video.canPlayType("application/vnd.apple.mpegurl"))})},[source?.type,url]);
 useEffect(()=>{
  if(source?.type!=="drive"){setQualityPreference(AUTO_QUALITY);setQualityPreferenceLoaded(true);return}
  if(!qualityViewerId){setQualityPreferenceLoaded(false);return}
  let stored=AUTO_QUALITY;
  try{stored=localStorage.getItem(qualityKey)||AUTO_QUALITY}catch{}
  const valid=stored===AUTO_QUALITY||(stored===ORIGINAL_QUALITY&&originalPlayable)||qualityOptionsSignature.split(",").includes(stored);
  setQualityPreference(valid?stored:AUTO_QUALITY);setQualityPreferenceLoaded(true);
 },[source?.type,source?.fileId,source?.qualityStatus,qualityViewerId,qualityOptionsSignature,qualityKey,originalPlayable]);
 useEffect(()=>{if(source?.type!=="drive"||!qualityPreferenceLoaded||!qualityViewerId)return;try{localStorage.setItem(qualityKey,qualityPreference)}catch{}},[source?.type,qualityPreference,qualityPreferenceLoaded,qualityKey,qualityViewerId]);
 useEffect(()=>{if(qualityPreference!==ORIGINAL_QUALITY||!hlsError)return;setHlsError(false)},[qualityPreference,hlsError]);
 useEffect(()=>()=>{if(externalSubtitle?.url)URL.revokeObjectURL(externalSubtitle.url)},[externalSubtitle]);
 useEffect(()=>{
  if(source?.type==="yt")return;
  const interval=setInterval(()=>{
   if(canControl)return;
   const v=vid.current,s=remote.current;if(!v||!s)return;
   const now=performance.now();
   const rate=Number(s.playbackRate)||1;
   if(!s.playing){if(!v.paused){markProgrammaticChange();v.pause()}if(v.playbackRate!==rate)v.playbackRate=rate;return}
   if(v.paused||v.readyState<2){if(v.playbackRate!==rate)v.playbackRate=rate;return}
   const expected=expectedPlaybackPosition(s,now),drift=expected-v.currentTime,correction=playbackCorrection(drift,s.eventType,lastHardCorrection.current,now,rate);
   if(correction.seek){markProgrammaticChange();v.currentTime=expected;v.playbackRate=rate;lastHardCorrection.current=now}
   else if(v.playbackRate!==correction.playbackRate)v.playbackRate=correction.playbackRate;
  },1000);
  return()=>clearInterval(interval);
 },[source?.type,canControl]);
 useEffect(()=>{if(!ytKey)return;let dead=false,iv,player,lastEmit=0;host.current.innerHTML="<div></div>";
    loadYT().then(YT=>{if(dead)return;player=new YT.Player(host.current.firstChild,{videoId:ytKey,width:"100%",height:"100%",playerVars:{rel:0,playsinline:1,controls:canControl?1:0,disablekb:canControl?0:1,fs:0},events:{
   onReady:()=>{const rates=player?.getAvailablePlaybackRates?.();setAvailableRates(Array.isArray(rates)?rates:null);player?.setPlaybackRate?.(Number(playbackRateRef.current)||1);if(pending.current)apply(pending.current)},
   onAutoplayBlocked:()=>onAutoplayBlocked?.(),
  onStateChange:e=>{if(e.data===3)bufferingRef.current?.(true);else if(e.data===1||e.data===2){bufferingRef.current?.(false);emit({source,playing:e.data===1,time:e.target.getCurrentTime(),playbackRate:e.target.getPlaybackRate?.()||Number(playbackRateRef.current)||1,eventType:e.data===1?"play":"pause"})}},
   onError:e=>onError(e.data===100?"This video was removed or is private.":[101,150].includes(e.data)?"The owner doesn't allow this video to be embedded.":"Invalid or unavailable video.")}});yt.current=player;
   iv=setInterval(()=>{const position=player?.getCurrentTime?.();if(position==null)return;const playing=player.getPlayerState()===1;
   if(remote.current?.playing&&playing){const now=performance.now(),rate=Number(remote.current.playbackRate)||1,expected=expectedPlaybackPosition(remote.current,now),correction=playbackCorrection(expected-position,remote.current.eventType,lastHardCorrection.current,now,rate);if(correction.seek){markProgrammaticChange();player.seekTo(expected,true);lastHardCorrection.current=now}}
  if(canControl&&playing&&Date.now()-lastEmit>2000){lastEmit=Date.now();emit({source,playing,time:position,playbackRate:player.getPlaybackRate?.()||Number(playbackRateRef.current)||1,eventType:"progress"})}
   },1000)});
  return()=>{dead=true;clearInterval(iv);const current=player;if(yt.current===current)yt.current=null;if(current&&typeof current.destroy==="function")current.destroy();player=null}},[ytKey,canControl]);
 const vev=event=>{if(pending.current){apply(pending.current);return}const v=vid.current;if(!v)return;const progress=event.type==="timeupdate";if(progress){const now=performance.now();if(!canControl||v.paused||(lastProgressEmit.current!=null&&now-lastProgressEmit.current<1000))return;lastProgressEmit.current=now}emit({source,playing:!v.paused,time:event?.currentTarget?.currentTime??v.currentTime,playbackRate:Number(v.playbackRate)||1,eventType:progress?"progress":event.type==="seeked"?"seeked":v.paused?"pause":"play"})};
 const readTracks=()=>{
  const media=vid.current;if(!media)return;
  setAudioTrackApiAvailable("audioTracks" in media&&media.audioTracks!==undefined);
  setSubtitleTrackApiAvailable("textTracks" in media&&media.textTracks!==undefined);
  if(media.videoWidth&&media.videoHeight){setVideoDimensions({width:media.videoWidth,height:media.videoHeight});if(qualityPreferenceRef.current===AUTO_QUALITY&&!hlsSupport.js)setActiveQuality(`Browser adaptive · ${media.videoHeight}p (${media.videoWidth}x${media.videoHeight})`);else if(qualityPreferenceRef.current!==ORIGINAL_QUALITY)setActiveQuality(`${media.videoHeight}p (${media.videoWidth}x${media.videoHeight})`)}
  const audio=media.audioTracks?Array.from(media.audioTracks):[];
  const subtitles=media.textTracks?Array.from(media.textTracks).filter(track=>track.kind==="captions"||track.kind==="subtitles"):[];
  setAudioTracks(audio.map((track,index)=>({index,label:String(track.label||track.language||`Audio track ${index+1}`),language:String(track.language||"")})));
  setSubtitleTracks(subtitles.map((track,index)=>({index,label:String(track.label||track.language||`Subtitle track ${index+1}`),language:String(track.language||"")})));
  setActiveAudio(audio.findIndex(track=>track.enabled));
  setActiveSubtitle(subtitles.findIndex(track=>track.mode==="showing"));
 };
 useEffect(()=>{
  const media=vid.current;if(!media){setAudioTracks([]);setSubtitleTracks([]);setActiveAudio(-1);setActiveSubtitle(-1);return}
  const audio=media.audioTracks,text=media.textTracks;
  readTracks();
  audio?.addEventListener?.("addtrack",readTracks);audio?.addEventListener?.("change",readTracks);text?.addEventListener?.("addtrack",readTracks);text?.addEventListener?.("change",readTracks);media.addEventListener("resize",readTracks);
  return()=>{audio?.removeEventListener?.("addtrack",readTracks);audio?.removeEventListener?.("change",readTracks);text?.removeEventListener?.("addtrack",readTracks);text?.removeEventListener?.("change",readTracks);media.removeEventListener("resize",readTracks)};
 },[source?.type,url,hlsSupport.js]);
 const selectQuality=quality=>{
  if(quality!==AUTO_QUALITY&&quality!==ORIGINAL_QUALITY&&!qualityOptions.some(option=>option.id===quality))return;
  if(quality===ORIGINAL_QUALITY&&!originalPlayable)return;
  if(quality===qualityPreference)return;
  pendingQualitySwitch.current=capturePlaybackState(vid.current);
  qualitySwitching.current=true;
  qualityController.current={cap:-1,lastChangeAt:0};setHlsError(false);setQualityPreference(quality);
  if(quality===AUTO_QUALITY){setActiveQuality("Auto selecting");applyHlsQualityMode(hls.current,AUTO_QUALITY,"",sourceWidth,sourceHeight)}
  else if(quality===ORIGINAL_QUALITY)setActiveQuality(qualityLabel);
  else{setActiveQuality(`${quality} · switching`);applyHlsQualityMode(hls.current,quality,quality,sourceWidth,sourceHeight)}
 };
 useEffect(()=>{
  const video=vid.current;
  if(source?.type!=="drive"||!url||!canUseHls||!hlsSupport.js||qualityPreference===ORIGINAL_QUALITY||!video)return;
  const snapshot=pendingQualitySwitch.current||capturePlaybackState(video),instance=new Hls({startLevel:-1,capLevelToPlayerSize:false,abrBandWidthFactor:0.7,abrBandWidthUpFactor:0.55,maxBufferLength:20,maxMaxBufferLength:45,backBufferLength:30});
  hls.current=instance;
  instance.on(Hls.Events.MANIFEST_PARSED,()=>{
   const mode=qualityPreferenceRef.current;
   if(mode===AUTO_QUALITY){qualityController.current={cap:-1,lastChangeAt:Date.now()};applyHlsQualityMode(instance,AUTO_QUALITY,"",sourceWidth,sourceHeight)}
   else applyHlsQualityMode(instance,mode,mode,sourceWidth,sourceHeight);
  if(snapshot){instance.startLoad(snapshot.time);completeQualitySwitch(video,snapshot)}
  });
  instance.on(Hls.Events.LEVEL_SWITCHED,(_event,data)=>{
   const level=instance.levels[data.level];if(level)setActiveQuality(`${level.height}p (${level.width}x${level.height})`);
  });
  instance.on(Hls.Events.FRAG_BUFFERED,()=>{
   if(qualityPreferenceRef.current!==AUTO_QUALITY)return;
   const ranges=video.buffered;let bufferedSeconds=0;
   for(let index=0;index<ranges.length;index++)if(video.currentTime>=ranges.start(index)&&video.currentTime<=ranges.end(index)){bufferedSeconds=ranges.end(index)-video.currentTime;break}
   const estimate=Number(instance.bandwidthEstimate)||Number(instance.abrController?.bwEstimator?.getEstimate?.())||0;
   const updated=updateAdaptiveLevelCap(instance,AUTO_QUALITY,{bandwidthEstimate:estimate,bufferedSeconds,currentCap:qualityController.current.cap,lastChangeAt:qualityController.current.lastChangeAt,now:Date.now()});
   if(updated.changed)qualityController.current={cap:updated.cap,lastChangeAt:updated.lastChangeAt};
  });
  instance.on(Hls.Events.ERROR,(_event,data)=>{if(!data.fatal)return;pendingQualitySwitch.current=capturePlaybackState(video);setHlsError(true);setActiveQuality("Original fallback");onError?.("Adaptive streaming failed; playback has fallen back to the protected original stream.")});
  instance.loadSource(hlsUrl);instance.attachMedia(video);
  return()=>{if(hls.current===instance)hls.current=null;instance.destroy();if(video.src!==url){video.src=url;video.load();const snapshot=pendingQualitySwitch.current;if(snapshot)completeQualitySwitch(video,snapshot)}};
 },[source?.type,source?.fileId,url,hlsUrl,canUseHls,hlsSupport.js,qualityPreference===ORIGINAL_QUALITY]);
 useEffect(()=>{
  const instance=hls.current;if(!instance||qualityPreference===ORIGINAL_QUALITY)return;
  if(qualityPreference===AUTO_QUALITY){qualityController.current={cap:-1,lastChangeAt:Date.now()};applyHlsQualityMode(instance,AUTO_QUALITY,"",sourceWidth,sourceHeight)}
  else applyHlsQualityMode(instance,qualityPreference,qualityPreference,sourceWidth,sourceHeight);
 },[qualityPreference,sourceWidth,sourceHeight]);
 useEffect(()=>{
  const video=vid.current;
  if(source?.type!=="drive"||!url||hlsSupport.js||!hlsSupport.native||!canUseHls||qualityPreference===ORIGINAL_QUALITY||!video)return;
  const snapshot=pendingQualitySwitch.current||capturePlaybackState(video);
  video.src=nativeHlsUrl;video.load();
  const restore=()=>{if(snapshot)completeQualitySwitch(video,snapshot)};
  video.addEventListener("loadedmetadata",restore,{once:true});
  return()=>{video.removeEventListener("loadedmetadata",restore);if(video.src!==url){video.src=url;video.load();if(snapshot)completeQualitySwitch(video,snapshot)}};
 },[source?.type,source?.fileId,url,nativeHlsUrl,hlsSupport.js,hlsSupport.native,canUseHls,qualityPreference]);
 useEffect(()=>{
  const video=vid.current;if(!video)return;
  const failed=()=>{if(!hlsSupport.native||hlsSupport.js||!canUseHls||qualityPreferenceRef.current===ORIGINAL_QUALITY)return;pendingQualitySwitch.current=capturePlaybackState(video);setHlsError(true);setActiveQuality("Original fallback");onError?.("Adaptive streaming failed; playback has fallen back to the protected original stream.")};
  video.addEventListener("error",failed);
  return()=>video.removeEventListener("error",failed);
 },[source?.type,source?.fileId,url,onError,hlsSupport.native,hlsSupport.js,canUseHls]);
 useEffect(()=>{
  const video=vid.current,tracks=source?.sourceTracks?.subtitles||[];
  if(source?.type!=="drive"||!video||!url||!tracks.length)return;
  const elements=tracks.filter(track=>track.ready&&track.asset).map(track=>{
   const element=document.createElement("track");element.kind="subtitles";element.label=track.label||"Subtitle";element.srclang=track.language||"und";element.src=`${url}/hls/${track.asset}`;element.addEventListener("load",readTracks);video.appendChild(element);return element;
  });
  return()=>elements.forEach(element=>{element.removeEventListener("load",readTracks);element.remove()});
 },[source?.type,source?.fileId,url,source?.sourceTracks]);
 useEffect(()=>{
  const video=vid.current;if(!video)return;
  const restore=()=>{const snapshot=pendingQualitySwitch.current;if(snapshot)completeQualitySwitch(video,snapshot)};
  video.addEventListener("loadedmetadata",restore);
  return()=>video.removeEventListener("loadedmetadata",restore);
 },[source?.type,source?.fileId,url]);
 const selectAudio=index=>{
  const tracks=vid.current?.audioTracks;if(!tracks)return;
  Array.from(tracks).forEach((track,trackIndex)=>{track.enabled=trackIndex===index});setActiveAudio(index);
 };
 const selectSubtitle=index=>{
  const tracks=vid.current?.textTracks;if(!tracks)return;
  const selectable=Array.from(tracks).filter(track=>track.kind==="captions"||track.kind==="subtitles");
  selectable.forEach((track,trackIndex)=>{track.mode=trackIndex===index?"showing":"disabled"});setActiveSubtitle(index);
 };
 const addExternalSubtitle=file=>{
  if(!file)return;
  if(!file.name.toLowerCase().endsWith(".vtt")&&file.type!=="text/vtt"){setSubtitleInputError("Choose a WebVTT (.vtt) file.");return}
  setSubtitleInputError("");setExternalSubtitle({url:URL.createObjectURL(file),label:file.name});
 };
 const selectSpeed=rate=>{
  if(!canControl)return;
  if(availableRates&&!availableRates.includes(rate))return;
  const video=vid.current,player=yt.current,time=video?.currentTime??player?.getCurrentTime?.()??0,playing=video?!video.paused:player?.getPlayerState?.()===1;
  const activeRate=video?.playbackRate??player?.getPlaybackRate?.()??playbackRate;if(Number(activeRate)===rate)return;
  if(video)video.playbackRate=rate;else player?.setPlaybackRate?.(rate);
  const now=performance.now(),wallClock=Date.now();remote.current={...(remote.current||{}),source,playing,time,playbackRate:rate,eventType:"speed",eventTimestamp:wallClock,serverTimestamp:wallClock,receivedAt:now,wallClockAtReceive:wallClock};lastHardCorrection.current=now;
  onPlaybackRateChange?.({source,playing,time,playbackRate:rate,eventType:"speed"});
 };
 const trackNotice=source?.type==="yt"?"Audio and subtitle tracks are not exposed by the current YouTube player API.":mediaDecodeFailed?"This browser could not decode this container, so its embedded tracks cannot be inspected or selected. A compatible remux or prepared HLS rendition is required.":"";
 const audioNotice=source?.type==="yt"?trackNotice:mediaDecodeFailed?trackNotice:!audioTrackApiAvailable?"This browser does not expose embedded audio tracks for this stream; a compatible remux or HLS audio rendition is required.":"No additional audio tracks were exposed by this video.";
 const subtitleNotice=source?.type==="yt"?trackNotice:mediaDecodeFailed?"This browser cannot decode this container, so embedded tracks cannot be inspected. A local WebVTT file can be attached when the video source is playable.":!subtitleTrackApiAvailable?"This browser does not expose embedded subtitle tracks for this stream.":"No selectable embedded subtitle tracks were exposed by this video.";
 const qualityLabel=sourceWidth&&sourceHeight?`Original · ${sourceHeight}p (${sourceWidth}x${sourceHeight})`:"Original source · resolution unavailable";
 const selectedQuality=qualityPreference,autoAvailable=hasGeneratedQualities&&(hlsSupport.js||hlsSupport.native)&&!hlsError;
 const activeQualityLabel=qualityPreference===ORIGINAL_QUALITY?qualityLabel:activeQuality;
 const settingsPanel=<PlayerSettings open={settingsOpen} onToggle={()=>setSettingsOpen(open=>!open)} onClose={()=>setSettingsOpen(false)} rates={PLAYBACK_RATES} playbackRate={playbackRate} availableRates={availableRates} canControl={canControl} onSpeed={selectSpeed} audioTracks={audioTracks} subtitleTracks={subtitleTracks} activeAudio={activeAudio} activeSubtitle={activeSubtitle} onAudio={selectAudio} onSubtitle={selectSubtitle} onExternalSubtitleFile={source?.type==="drive"?addExternalSubtitle:undefined} audioNotice={audioNotice} subtitleNotice={subtitleNotice} subtitleInputError={subtitleInputError} qualityLabel={qualityLabel} activeQuality={activeQualityLabel} qualityOptions={qualityOptions} selectedQuality={selectedQuality} onQualityChange={selectQuality} autoAvailable={autoAvailable} qualityStatus={source?.type==="yt"?"youtube":source?.qualityStatus||"not-prepared"} hlsError={hlsError} qualitySupported={source?.type==="drive"}/>;
 if(source?.type==="yt")return <div className="relative h-full w-full"><div ref={host} className="h-full w-full"/>{settingsPanel}</div>;
 if(source?.type==="drive"&&url)return <div className="relative h-full w-full">
   <video ref={vid} src={url} controls={false} playsInline className="h-full w-full" onPlay={vev} onPause={vev} onSeeked={vev} onTimeUpdate={vev} onWaiting={()=>onBuffering?.(true)} onStalled={()=>onBuffering?.(true)} onPlaying={()=>onBuffering?.(false)} onCanPlay={()=>onBuffering?.(false)} onLoadedMetadata={()=>{readTracks();if(vid.current)vid.current.playbackRate=Number(playbackRate)||1;if(pending.current)apply(pending.current)}} onLoadedData={()=>{onBuffering?.(false);readTracks();if(pending.current)apply(pending.current)}} onError={()=>{setMediaDecodeFailed(true);onBuffering?.(false);onError("This Drive video could not be played in the browser.")}}>{externalSubtitle&&<track key={externalSubtitle.url} kind="subtitles" label={externalSubtitle.label} srcLang="und" src={externalSubtitle.url} onLoad={readTracks} onError={()=>setSubtitleInputError("The browser could not load this WebVTT track.")}/>}</video>
   <PlayerControls videoRef={vid} canControl={canControl} isBuffering={isBuffering} isFullscreen={isFullscreen} onToggleFullscreen={onToggleFullscreen} onAutoplayBlocked={onAutoplayBlocked}/>
  {settingsPanel}
 </div>;
 return <div className="grid h-full place-items-center p-6 text-center text-sm text-slate-400">{source?.type==="drive"?"The shared Drive video is loading.":"No video selected yet."}</div>;
}
