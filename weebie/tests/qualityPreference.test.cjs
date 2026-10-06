const test=require("node:test");
const assert=require("node:assert/strict");
const {AUTO_QUALITY,applyHlsQualityMode,updateAdaptiveLevelCap,getViewerQualitySessionId,qualityPreferenceKey,capturePlaybackState,restorePlaybackState,shouldEmitPlaybackEvent}=require("../lib/qualityPreference.cjs");

const levels=[{height:360,width:640,bitrate:500000},{height:480,width:854,bitrate:900000},{height:720,width:1280,bitrate:1800000}];

function fakeHls(){return {levels,currentLevel:-1,autoLevelCapping:-1,nextLevel:-1}}

test("viewer preference keys differ by room, source, and tab identity",()=>{
 assert.notEqual(qualityPreferenceKey("ROOM01","file-a","viewer-a"),qualityPreferenceKey("ROOM01","file-b","viewer-a"));
 assert.notEqual(qualityPreferenceKey("ROOM01","file-a","viewer-a"),qualityPreferenceKey("ROOM02","file-a","viewer-a"));
 assert.notEqual(qualityPreferenceKey("ROOM01","file-a","viewer-a"),qualityPreferenceKey("ROOM01","file-a","viewer-b"));
 const store=new Map(),storage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)};
 assert.equal(getViewerQualitySessionId(storage),getViewerQualitySessionId(storage));
});

test("manual quality locks an actual level and rejects unavailable or oversized levels",()=>{
 const hls=fakeHls();
 hls.autoLevelCapping=0;
 assert.equal(applyHlsQualityMode(hls,"480p","480p",1920,1080),true);
 assert.equal(hls.currentLevel,1);
 assert.equal(applyHlsQualityMode(hls,"1080p","1080p",1280,720),false);
 assert.equal(hls.currentLevel,1);
});

test("manual mode ignores network samples while Auto caps down for low bandwidth",()=>{
 const hls=fakeHls();applyHlsQualityMode(hls,"720p","720p",1920,1080);
 const locked=hls.currentLevel;
 const unchanged=updateAdaptiveLevelCap(hls,"720p",{bandwidthEstimate:300000,bufferedSeconds:1,currentCap:-1,lastChangeAt:0,now:20000});
 assert.equal(unchanged.changed,false);
 assert.equal(hls.currentLevel,locked);
 applyHlsQualityMode(hls,AUTO_QUALITY);
 const down=updateAdaptiveLevelCap(hls,AUTO_QUALITY,{bandwidthEstimate:400000,bufferedSeconds:8,currentCap:2,lastChangeAt:0,now:20000});
 assert.equal(down.cap,0);
 assert.equal(hls.autoLevelCapping,0);
});

test("Auto mode raises its cap only after bandwidth headroom and cooldown",()=>{
 const hls=fakeHls();
 const tooSoon=updateAdaptiveLevelCap(hls,AUTO_QUALITY,{bandwidthEstimate:4000000,bufferedSeconds:12,currentCap:0,lastChangeAt:10000,now:20000});
 assert.equal(tooSoon.changed,false);
 const improved=updateAdaptiveLevelCap(hls,AUTO_QUALITY,{bandwidthEstimate:4000000,bufferedSeconds:12,currentCap:0,lastChangeAt:10000,now:26000});
 assert.equal(improved.cap,2);
 assert.equal(hls.autoLevelCapping,2);
});

test("quality source switching can restore time, play state, and playback rate",()=>{
 const listeners={};
 const video={currentTime:42,paused:false,playbackRate:1.25,readyState:0,addEventListener:(name,handler)=>{listeners[name]=handler},pause(){this.paused=true},play(){this.paused=false;return Promise.resolve()}};
 const snapshot=capturePlaybackState(video);
 video.currentTime=0;video.paused=true;video.playbackRate=1;
 restorePlaybackState(video,snapshot);
 listeners.loadedmetadata();
 assert.equal(video.currentTime,42);
 assert.equal(video.paused,false);
 assert.equal(video.playbackRate,1.25);
});

test("local quality switches do not emit shared playback events",()=>{
 assert.equal(shouldEmitPlaybackEvent(true,0,true,5000),false);
 assert.equal(shouldEmitPlaybackEvent(true,6000,false,5000),false);
 assert.equal(shouldEmitPlaybackEvent(true,0,false,5000),true);
});
