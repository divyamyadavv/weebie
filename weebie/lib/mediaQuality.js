export const QUALITY_LEVELS=[360,480,720,1080];

function asRecord(value){
 return value&&typeof value==="object"&&!Array.isArray(value)?value:{};
}

function dimension(value){
 try{
  const result=Number(value);
  return Number.isFinite(result)&&result>0?result:0;
 }catch{return 0}
}

export function normalizeQualityChoice(value){
 const text=String(value??"original").trim().toLowerCase();
 if(!text||text==="original")return "original";
 const match=/^(?:quality-)?(\d+)p?$/i.exec(text)||/^(\d+)$/.exec(text);
 if(!match)return "original";
 return `${Number(match[1])}p`;
}

export function getSourceMaxDimension(source={}){
 const value=asRecord(source),width=dimension(value.width),height=dimension(value.height);
 if(!width||!height)return 0;
 return Math.max(width,height);
}

export function isOriginalPlayable(source={},canPlayType=()=>false){
 const value=asRecord(source),tracks=asRecord(value.sourceTracks),mime=typeof value.mime==="string"?value.mime.trim():"";
 if(tracks.originalCompatible!==true||!mime||typeof canPlayType!=="function")return false;
 try{return Boolean(canPlayType(mime))}catch{return false}
}

export function buildQualityOptions(source={}){
 const value=asRecord(source),width=dimension(value.width),height=dimension(value.height);
 if(!width||!height)return [{id:"original",label:"Original",width,height,kind:"original"}];
 const generated=Array.isArray(value.qualities)?value.qualities.filter(item=>item&&typeof item==="object"&&!Array.isArray(item)):[];
 const seen=new Set();
 const options=[{id:"original",label:"Original",width,height,kind:"original"}];
 for(const target of QUALITY_LEVELS){
    if(target>height)continue;
  const qualityId=`${target}p`;
  const candidate=generated.find(item=>normalizeQualityChoice(item.id||item.label||item.quality||item.name||"original")===qualityId);
  if(!candidate)continue;
    if(candidate.ready!==true&&candidate.status!=="ready"&&candidate.available!==true)continue;
  const candidateWidth=Number(candidate.width)||0;
  const candidateHeight=Number(candidate.height)||0;
  if(!candidateWidth||candidateHeight!==target)continue;
  if(candidateWidth>width||candidateHeight>height)continue;
    const option={id:qualityId,label:`${target}p`,width:candidateWidth,height:candidateHeight,kind:"rendition",ready:true};
  if(seen.has(option.id))continue;
  seen.add(option.id);
  options.push(option);
 }
 return options;
}

export function resolveQualityOption(source={},requestedQuality){
 const value=asRecord(source),options=buildQualityOptions(value);
 const requested=normalizeQualityChoice(requestedQuality ?? value.quality ?? "original");
 return options.find(option=>option.id===requested)||options[0]||{id:"original",label:"Original",width:dimension(value.width),height:dimension(value.height),kind:"original"};
}

export function qualityLabel(source={},requestedQuality){
 return resolveQualityOption(source,requestedQuality).label||"Original";
}
