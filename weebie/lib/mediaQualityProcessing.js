import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {pipeline} from "node:stream/promises";
import {HttpError} from "./serverFirebase";
import {streamDriveFile} from "./driveServer";
import {mediaToolStatus,resolveQualityStorageRoot} from "./mediaQualityRuntime.cjs";

export const QUALITY_PRESETS=[360,480,720,1080];
const ROOM_CODE_PATTERN=/^[A-Z0-9]{6,20}$/;
const GENERATION_PATTERN=/^[a-f0-9-]{36}$/;

export function qualityStorageRoot(){
 try{return resolveQualityStorageRoot()}
 catch(error){throw new HttpError(503,error.message)}
}

export function qualityGenerationDirectory(roomCode,generationId){
 const code=String(roomCode||"").toUpperCase();
 if(!ROOM_CODE_PATTERN.test(code)||!GENERATION_PATTERN.test(String(generationId||"")))throw new HttpError(400,"Invalid quality generation reference.");
 return path.join(qualityStorageRoot(),code,generationId);
}

export function ffmpegStatus(){
 return mediaToolStatus();
}

function ensureMediaTools(){
 const status=ffmpegStatus();
 if(!status.ready)throw new HttpError(503,"FFmpeg/FFprobe is unavailable in this server runtime. Configure FFMPEG_PATH and FFPROBE_PATH to installed binaries before preparing qualities.");
 return status;
}

async function ensureStorageAvailable(){
 const root=qualityStorageRoot();
 try{
  await fs.mkdir(root,{recursive:true});
  const probe=path.join(root,`.weebie-write-${randomUUID()}`);
  await fs.writeFile(probe,"");
  await fs.rm(probe,{force:true});
 }catch{
  throw new HttpError(503,"Quality storage is not writable. Configure WEEBIE_MEDIA_DIR to a private writable directory with enough durable space for the source and all renditions.");
 }
 return root;
}

function runJson(binary,args){
 try{return JSON.parse(execFileSync(binary,args,{encoding:"utf8",maxBuffer:16*1024*1024,stdio:["ignore","pipe","pipe"]}))}
 catch{throw new HttpError(422,"FFprobe could not inspect the selected Drive video.")}
}

function summarizeProbe(probe){
 const streams=(probe.streams||[]).map(stream=>({index:Number(stream.index),type:String(stream.codec_type||"unknown"),codec:String(stream.codec_name||"unknown"),width:Number(stream.width)||0,height:Number(stream.height)||0,language:String(stream.tags?.language||"und"),title:String(stream.tags?.title||""),channels:Number(stream.channels)||0}));
 const video=streams.find(stream=>stream.type==="video");
 if(!video?.width||!video?.height)throw new HttpError(415,"The selected Drive file has no inspectable video stream.");
 return {width:video.width,height:video.height,duration:Number(probe.format?.duration)||0,videoCodec:video.codec,audio:streams.filter(stream=>stream.type==="audio"),subtitles:streams.filter(stream=>stream.type==="subtitle"),streams};
}

function isCommonBrowserSource(mime,inspection){
 const normalized=String(mime||"").toLowerCase(),video=inspection.videoCodec,audio=inspection.audio.map(stream=>stream.codec);
 if(normalized==="video/mp4")return video==="h264"&&audio.every(codec=>codec==="aac"||codec==="mp3");
 if(normalized==="video/webm")return ["vp8","vp9","av1"].includes(video)&&audio.every(codec=>codec==="opus"||codec==="vorbis");
 if(normalized==="video/ogg")return video==="theora"&&audio.every(codec=>codec==="vorbis"||codec==="opus");
 return false;
}

async function saveDriveSource(ownerUid,fileId,target){
 const streamed=await streamDriveFile(ownerUid,fileId,null);
 await fs.mkdir(path.dirname(target),{recursive:true});
 try{await pipeline(streamed.response.body,await fs.open(target,"w").then(file=>file.createWriteStream()))}
 catch{throw new HttpError(500,"The selected Drive video could not be downloaded for the explicitly requested quality preparation.")}
}

function writeHlsRendition(sourcePath,directory,targetHeight){
 const playlist=path.join(directory,"index.m3u8"),segments=path.join(directory,"segment_%05d.ts");
 const maxRate=Math.round(targetHeight*targetHeight*0.0045),bufferSize=maxRate*2;
 try{
  execFileSync(process.env.FFMPEG_PATH||"ffmpeg",["-hide_banner","-loglevel","error","-y","-i",sourcePath,"-map","0:v:0","-map","0:a?","-vf",`scale=-2:${targetHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`,"-c:v","libx264","-preset","veryfast","-b:v",`${maxRate}k`,"-maxrate",`${maxRate}k`,"-bufsize",`${bufferSize}k`,"-pix_fmt","yuv420p","-c:a","aac","-b:a","128k","-ac","2","-f","hls","-hls_time","6","-hls_playlist_type","vod","-hls_flags","independent_segments","-hls_segment_filename",segments,playlist],{stdio:"ignore"});
 }catch{throw new HttpError(422,`FFmpeg failed while generating the ${targetHeight}p HLS rendition.`)}
 return playlist;
}

function extractSubtitles(sourcePath,subtitleStreams,directory){
 const extracted=[];
 for(const stream of subtitleStreams){
  const file=`stream_${stream.index}.vtt`,target=path.join(directory,file);
  try{
   execFileSync(process.env.FFMPEG_PATH||"ffmpeg",["-hide_banner","-loglevel","error","-y","-i",sourcePath,"-map",`0:${stream.index}`,"-c:s","webvtt","-f","webvtt",target],{stdio:"ignore"});
   extracted.push({id:String(stream.index),label:stream.title||stream.language||`Subtitle ${extracted.length+1}`,language:stream.language,asset:`subtitles/${file}`,ready:true});
  }catch{}
 }
 return extracted;
}

function writeMasterPlaylist(directory,qualities){
 const lines=["#EXTM3U","#EXT-X-VERSION:3","#EXT-X-INDEPENDENT-SEGMENTS"];
 for(const quality of qualities){
  lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${quality.bandwidth},AVERAGE-BANDWIDTH=${quality.bandwidth},RESOLUTION=${quality.width}x${quality.height}`);
  lines.push(`${quality.id}/index.m3u8`);
 }
 return fs.writeFile(path.join(directory,"master.m3u8"),`${lines.join("\n")}\n`);
}

export async function prepareDriveQualitiesForRoom({roomCode,source,ownerUid}){
 ensureMediaTools();
 if(!source||source.type!=="drive"||!source.fileId)throw new HttpError(400,"This room has no Drive video selected.");
 await ensureStorageAvailable();
 const generationId=randomUUID(),outputDir=qualityGenerationDirectory(roomCode,generationId),sourcePath=path.join(outputDir,"source.download");
 await fs.mkdir(outputDir,{recursive:true});
 try{
  await saveDriveSource(ownerUid,source.fileId,sourcePath);
  const probe=runJson(process.env.FFPROBE_PATH||"ffprobe",["-v","error","-print_format","json","-show_streams","-show_format",sourcePath]);
  const inspection=summarizeProbe(probe),qualities=[];
  for(const target of QUALITY_PRESETS){
  if(target>inspection.height)continue;
   const directory=path.join(outputDir,`${target}p`);
   await fs.mkdir(directory,{recursive:true});
   const playlist=writeHlsRendition(sourcePath,directory,target);
  const variant=runJson(process.env.FFPROBE_PATH||"ffprobe",["-v","error","-show_streams","-of","json",playlist]);
  const video=variant.streams?.find(stream=>stream.codec_type==="video"),audioCount=(variant.streams||[]).filter(stream=>stream.codec_type==="audio").length,width=Number(video?.width)||0,height=Number(video?.height)||0;
  if(audioCount<inspection.audio.length)throw new HttpError(422,`FFmpeg did not preserve every audio track in the ${target}p rendition.`);
  if(!width||!height||width>inspection.width||height>inspection.height||height>target){await fs.rm(directory,{recursive:true,force:true});continue}
   qualities.push({id:`${target}p`,label:`${target}p`,width,height,bandwidth:Math.max(250000,Math.round(target*target*4.5)),status:"ready",ready:true});
  }
  const subtitlesDirectory=path.join(outputDir,"subtitles");
  await fs.mkdir(subtitlesDirectory,{recursive:true});
  const subtitles=extractSubtitles(sourcePath,inspection.subtitles,subtitlesDirectory);
  await writeMasterPlaylist(outputDir,qualities);
  await fs.rm(sourcePath,{force:true});
  const warnings=[];
  if(!qualities.length)warnings.push("No lower-resolution HLS rendition could be generated; Original remains available.");
  if(inspection.subtitles.length!==subtitles.length)warnings.push(`${inspection.subtitles.length-subtitles.length} embedded subtitle track(s) could not be converted to WebVTT.`);
    return {status:"ready",qualityGenerationId:generationId,sourceResolution:{width:inspection.width,height:inspection.height},duration:inspection.duration,sourceTracks:{video:{codec:inspection.videoCodec,width:inspection.width,height:inspection.height},audio:inspection.audio.map(({index,codec,language,title,channels})=>({index,codec,language,title,channels})),subtitleStreams:inspection.subtitles.map(({index,codec,language,title})=>({index,codec,language,title})),subtitles,originalCompatible:isCommonBrowserSource(source.mime,inspection),preservedAudio:inspection.audio.length>0,preservedSubtitles:subtitles.length},qualities,warnings};
 }catch(error){
  await fs.rm(outputDir,{recursive:true,force:true}).catch(()=>{});
  throw error;
 }
}

export async function cleanupQualityArtifacts(roomCode,generationId){
 try{await fs.rm(qualityGenerationDirectory(roomCode,generationId),{recursive:true,force:true})}catch{}
}
