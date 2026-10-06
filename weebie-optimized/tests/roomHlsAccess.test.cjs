const test=require("node:test");
const assert=require("node:assert/strict");
const {authorizeRoomHlsAsset}=require("../lib/roomHlsAccess.cjs");

const generationId="12345678-1234-1234-1234-123456789abc";
const quality={id:"480p",width:854,height:480,status:"ready",ready:true};
const room={hostId:"host",originalOwnerId:"host",source:{type:"drive",fileId:"drive-file-123",qualityStatus:"ready",qualityGenerationId:generationId,qualities:[quality],sourceTracks:{subtitles:[{asset:"subtitles/stream_4.vtt",ready:true}]}}};
const member={kicked:false,blocked:false,online:true};

for(const asset of [["master.m3u8"],["480p","index.m3u8"],["480p","segment_00001.ts"],["subtitles","stream_4.vtt"]]){
 test(`active room member may request authorized HLS asset ${asset.join("/")}`,()=>{
  assert.equal(authorizeRoomHlsAsset({uid:"member",room,member,activeSession:true,asset}).ok,true);
 });
}

test("non-members cannot request HLS manifests or segments",()=>{
 for(const asset of [["master.m3u8"],["480p","segment_00001.ts"]]){
  assert.equal(authorizeRoomHlsAsset({uid:"stranger",room,member:null,activeSession:true,asset}).status,403);
 }
});

test("removed members and ungenerated or traversal assets are denied",()=>{
 assert.equal(authorizeRoomHlsAsset({uid:"member",room,member:{kicked:true},activeSession:true,asset:["master.m3u8"]}).status,403);
 assert.equal(authorizeRoomHlsAsset({uid:"member",room,member,activeSession:true,asset:["720p","segment_00001.ts"]}).status,404);
 assert.equal(authorizeRoomHlsAsset({uid:"member",room,member,activeSession:true,asset:["480p","..\\secret"]}).status,404);
 assert.equal(authorizeRoomHlsAsset({uid:"member",room:{...room,source:{...room.source,qualityStatus:"preparing"}},member,activeSession:true,asset:["master.m3u8"]}).status,404);
});
