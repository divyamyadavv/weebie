const PLAYBACK_RATES=[0.5,0.75,1,1.25,1.5,1.75,2];

function expectedPlaybackPosition(state,now){
 const time=Number(state?.time)||0;
 const playbackRate=PLAYBACK_RATES.includes(Number(state?.playbackRate))?Number(state.playbackRate):1;
 const receivedAt=Number(state?.receivedAt);
 const serverTimestamp=Number(state?.serverTimestamp),wallClockAtReceive=Number(state?.wallClockAtReceive);
 const serverAge=state?.playing&&serverTimestamp>0&&wallClockAtReceive>0?Math.min(4,Math.max(0,(wallClockAtReceive-serverTimestamp)/1000))*playbackRate:0;
 const elapsed=state?.playing&&Number.isFinite(receivedAt)?Math.max(0,(now-receivedAt)/1000)*playbackRate:0;
 return Math.max(0,time+serverAge+elapsed);
}

function playbackCorrection(drift,eventType,lastSeekAt,now,playbackRate=1){
 const magnitude=Math.abs(drift);
 const rate=PLAYBACK_RATES.includes(Number(playbackRate))?Number(playbackRate):1;
 if(eventType!=="progress"&&magnitude>0.65)return {seek:true,playbackRate:rate};
 if(magnitude>=3&&now-lastSeekAt>=8000)return {seek:true,playbackRate:rate};
 if(magnitude>=0.35)return {seek:false,playbackRate:rate*(drift>0?1.04:0.96)};
 return {seek:false,playbackRate:rate};
}

function shouldApplyPlaybackState(state,viewerUid,initialized){
 return !!state&&(state.controllerId!==viewerUid||!initialized);
}

// Restore only after the real player reaches the saved position; events behind it are not real admin actions.
function adminPlaybackRestoreAction(state,{admin,restored}){
 if(!state||!admin||restored)return "none";
 return state.eventType==="admin-transfer"?"mark":"apply";
}

function isAdminPlaybackRestored(state,position){
 const saved=Number(state?.time)||0,current=Number(position);
 return Number.isFinite(current)&&current>=saved-3;
}

function isUnrestoredAdminReset(state,event,restored){
 return !restored&&Number(state?.time)>1&&!isAdminPlaybackRestored(state,event?.time);
}

module.exports={PLAYBACK_RATES,expectedPlaybackPosition,playbackCorrection,shouldApplyPlaybackState,adminPlaybackRestoreAction,isAdminPlaybackRestored,isUnrestoredAdminReset};