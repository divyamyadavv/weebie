const AUTO_QUALITY="auto";
const ORIGINAL_QUALITY="original";

function getViewerQualitySessionId(storage){
 try{
  let value=storage.getItem("weebie-quality-viewer");
  if(!value){value=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;storage.setItem("weebie-quality-viewer",value)}
  return value;
 }catch{return `ephemeral-${Date.now()}-${Math.random().toString(36).slice(2)}`}
}

function qualityPreferenceKey(roomCode,fileId,viewerId){
 return `weebie-quality:${String(roomCode||"")}:${String(fileId||"")}:${String(viewerId||"")}`;
}

function matchingLevelIndex(levels,quality,sourceWidth=0,sourceHeight=0){
 const height=Number.parseInt(String(quality||""),10);
 if(!Number.isFinite(height)||height<=0)return -1;
 return (levels||[]).findIndex(level=>Number(level.height)===height&&Number(level.width)>0&&(!sourceWidth||Number(level.width)<=sourceWidth)&&(!sourceHeight||Number(level.height)<=sourceHeight));
}

function applyHlsQualityMode(hls,mode,quality,sourceWidth=0,sourceHeight=0){
 if(!hls)return false;
 if(mode===AUTO_QUALITY){hls.currentLevel=-1;hls.autoLevelCapping=-1;return true}
 const level=matchingLevelIndex(hls.levels,quality,sourceWidth,sourceHeight);
 if(level<0)return false;
 hls.autoLevelCapping=-1;
 hls.currentLevel=level;
 return true;
}

function updateAdaptiveLevelCap(hls,mode,{bandwidthEstimate,bufferedSeconds,currentCap=-1,lastChangeAt=0,now=Date.now()}){
 if(!hls||mode!==AUTO_QUALITY)return {cap:currentCap,lastChangeAt,changed:false};
 const levels=hls.levels||[];
 if(!levels.length||!Number.isFinite(bandwidthEstimate)||bandwidthEstimate<=0)return {cap:currentCap,lastChangeAt,changed:false};
 const highest=levels.length-1,current=currentCap<0?highest:Math.min(currentCap,highest);
 const safeBandwidth=bandwidthEstimate*0.7;
 let desired=0;
 for(let index=0;index<levels.length;index++)if(Number(levels[index].bitrate)>0&&Number(levels[index].bitrate)<=safeBandwidth)desired=index;
 if(bufferedSeconds<3)desired=Math.min(desired,Math.max(0,Number(hls.currentLevel)-1));
 if(desired<current){hls.autoLevelCapping=desired;return {cap:desired,lastChangeAt:now,changed:true}}
 if(desired>current&&now-lastChangeAt>=15000&&bandwidthEstimate>=Number(levels[desired].bitrate)*1.8){hls.autoLevelCapping=desired;return {cap:desired,lastChangeAt:now,changed:true}}
 return {cap:currentCap,lastChangeAt,changed:false};
}

function capturePlaybackState(video){
 if(!video)return null;
 return {time:Number(video.currentTime)||0,paused:video.paused!==false,playbackRate:Number(video.playbackRate)||1};
}

function restorePlaybackState(video,snapshot,onRestored=()=>{}){
 if(!video||!snapshot)return;
 video.playbackRate=snapshot.playbackRate;
 const restore=()=>{
  if(Number.isFinite(snapshot.time)&&Math.abs(video.currentTime-snapshot.time)>0.35)video.currentTime=snapshot.time;
  if(snapshot.paused)video.pause();else video.play()?.catch?.(()=>{});
  onRestored();
 };
 if(video.readyState>=1)restore();else video.addEventListener("loadedmetadata",restore,{once:true});
}

function shouldEmitPlaybackEvent(canControl,quietUntil,qualitySwitching,now=Date.now()){
 return Boolean(canControl)&&!qualitySwitching&&now>=quietUntil;
}

module.exports={AUTO_QUALITY,ORIGINAL_QUALITY,getViewerQualitySessionId,qualityPreferenceKey,matchingLevelIndex,applyHlsQualityMode,updateAdaptiveLevelCap,capturePlaybackState,restorePlaybackState,shouldEmitPlaybackEvent};
