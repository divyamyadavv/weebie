const {authorizeRoomVideo}=require("./roomVideoAccess.cjs");
const QUALITY_ID=/^(?:360|480|720|1080)p$/;
const GENERATION_ID=/^[a-f0-9-]{36}$/;

function authorizeRoomHlsAsset({uid,room,member,activeSession,asset}){
 const roomAccess=authorizeRoomVideo({uid,room,member,activeSession});
 if(!roomAccess.ok)return roomAccess;
 const source=room.source||{};
 if(source.qualityStatus!=="ready"||!GENERATION_ID.test(String(source.qualityGenerationId||"")))return {ok:false,status:404,message:"Prepared HLS qualities are not available for this room."};
 const parts=Array.isArray(asset)?asset.map(String):[];
 if(parts.length===1&&parts[0]==="master.m3u8"){
    if(!(source.qualities||[]).some(item=>QUALITY_ID.test(String(item.id||""))&&item.status==="ready"&&item.ready===true&&Number(item.width)>0&&Number(item.height)>0))return {ok:false,status:404,message:"No HLS renditions are available."};
  return {...roomAccess,kind:"master",generationId:source.qualityGenerationId};
 }
 if(parts.length===2&&parts[0]==="subtitles"&&/^stream_\d+\.vtt$/.test(parts[1])){
  const subtitle=(source.sourceTracks?.subtitles||[]).find(item=>item.ready&&item.asset===parts.join("/"));
  if(!subtitle)return {ok:false,status:404,message:"This subtitle rendition is not available."};
  return {...roomAccess,kind:"subtitle",generationId:source.qualityGenerationId};
 }
 if(parts.length!==2||!QUALITY_ID.test(parts[0]))return {ok:false,status:404,message:"This HLS asset is not available."};
 const quality=(source.qualities||[]).find(item=>item.id===parts[0]&&item.status==="ready"&&item.ready===true&&Number(item.width)>0&&Number(item.height)>0);
 if(!quality)return {ok:false,status:404,message:"This HLS rendition is not available."};
 if(parts[1]==="index.m3u8")return {...roomAccess,kind:"playlist",generationId:source.qualityGenerationId,quality};
 if(/^segment_\d{5}\.ts$/.test(parts[1]))return {...roomAccess,kind:"segment",generationId:source.qualityGenerationId,quality};
 return {ok:false,status:404,message:"This HLS asset is not available."};
}

module.exports={authorizeRoomHlsAsset};
