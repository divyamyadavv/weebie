const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {adminPlaybackRestoreAction,isAdminPlaybackRestored,isUnrestoredAdminReset}=require("../lib/playbackSync.cjs");

 test("admin restore action distinguishes saved state and transfer snapshots",()=>{
 const savedState={time:541,playing:true,eventType:"progress"};
 assert.equal(adminPlaybackRestoreAction(savedState,{admin:true,restored:false}),"apply");
 assert.equal(adminPlaybackRestoreAction(savedState,{admin:true,restored:true}),"none");
 assert.equal(adminPlaybackRestoreAction(savedState,{admin:false,restored:false}),"none");
 assert.equal(adminPlaybackRestoreAction(null,{admin:true,restored:false}),"none");
 assert.equal(adminPlaybackRestoreAction({...savedState,eventType:"admin-transfer"},{admin:true,restored:false}),"mark");
});

test("recognizes when the real player has reached the saved position",()=>{
 const savedState={time:541};
 for(const position of [0,120,NaN,undefined])assert.equal(isAdminPlaybackRestored(savedState,position),false);
 for(const position of [538,541,552])assert.equal(isAdminPlaybackRestored(savedState,position),true);
 assert.equal(isAdminPlaybackRestored({time:0},0),true);
});

test("blocks admin events behind the saved playback position until restored",()=>{
 const savedState={time:541,playing:true,eventType:"progress"};
 for(const eventType of ["play","pause","seeked","progress"]){
  for(const time of [0,6])assert.equal(isUnrestoredAdminReset(savedState,{time,eventType},false),true);
 }
 assert.equal(isUnrestoredAdminReset(savedState,{time:541.4,eventType:"progress"},false),false);
 assert.equal(isUnrestoredAdminReset(savedState,{time:0,eventType:"play"},true),false);
 assert.equal(isUnrestoredAdminReset({...savedState,time:0},{time:0,eventType:"progress"},false),false);
});

test("retries restore after a wiped hand-over and stops after real position catches up",()=>{
 const savedState={time:541,playing:true,eventType:"progress"};
 let position=0,restoreCalls=0,attempts=0,restored=false;
 const player={getTime:()=>position,restore:state=>{restoreCalls++;if(restoreCalls===2)position=state.time}};
 const attempt=()=>{
  if(restored)return;
  if(player&&isAdminPlaybackRestored(savedState,player.getTime())){restored=true;return}
  if(++attempts>40){restored=true;return}
  player.restore(savedState);
 };
 attempt();
 assert.equal(position,0);
 assert.equal(restored,false);
 attempt();
 assert.equal(position,541);
 assert.equal(restored,false);
 attempt();
 assert.equal(restored,true);
 const completedRestoreCalls=restoreCalls;
 attempt();
 assert.equal(restoreCalls,completedRestoreCalls);
});

test("room page and Player wire retryable admin restoration",()=>{
 const page=fs.readFileSync(path.join(__dirname,"..","app","room","[code]","page.js"),"utf8");
 const player=fs.readFileSync(path.join(__dirname,"..","components","Player.js"),"utf8");
 assert.equal(page.includes('if(admin||state.eventType==="admin-transfer")return;'),false);
 assert.equal(page.includes("api.current.apply(state);adminRestored.current=true"),false);
 assert.equal(page.includes("adminSince"),false);
 assert.ok(page.includes('import {shouldApplyPlaybackState,adminPlaybackRestoreAction,isAdminPlaybackRestored,isUnrestoredAdminReset} from "../../../lib/playbackSync.cjs";'));
 assert.ok(page.includes("playbackInitialized=useRef(false),adminRestored=useRef(false),adminRestoreAttempts=useRef(0);"));
 assert.ok(page.includes("isAdminPlaybackRestored(state,player.getTime?.())"));
 assert.ok(page.includes("player?.restore?.(state)"));
 assert.ok(page.includes("adminRestoreAttempts.current>40"));
 assert.ok(page.includes("setInterval(()=>{attempt();if(adminRestored.current)clearInterval(timer)},700)"));
 assert.ok(page.includes("return()=>clearInterval(timer);"));
 assert.ok(player.includes("const restore=s=>{if(!s)return false;remote.current=null;pending.current=null;forceInitialSeek.current=true;lastHardCorrection.current=-10000;return apply(s)};"));
 assert.ok(player.includes("const getTime=()=>{const v=vid.current,p=yt.current;return v?v.currentTime:Number(p?.getCurrentTime?.())||0};"));
 assert.ok(player.includes("apiRef.current={apply,enable,restore,getTime}"));
});