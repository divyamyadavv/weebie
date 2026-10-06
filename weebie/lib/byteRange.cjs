function parseByteRange(value,size){
 if(!value)return null;
 const match=/^bytes=(\d*)-(\d*)$/.exec(value.trim());
 if(!match||(!match[1]&&!match[2]))return {invalid:true};
 if(!Number.isSafeInteger(size)||size<0)return {invalid:true};
 if(size===0){
  const start=match[1]?Number(match[1]):null,end=match[2]?Number(match[2]):null;
  if((start!==null&&!Number.isSafeInteger(start))||(end!==null&&!Number.isSafeInteger(end))||(start===null&&(!end||end<=0))||(start!==null&&end!==null&&end<start))return {invalid:true};
  return {start,end,length:null,header:value.trim(),sizeUnknown:true,suffix:!match[1]};
 }
 if(size===0)return {invalid:true};
 let start,end;
 if(!match[1]){
  const suffix=Number(match[2]);
  if(!Number.isSafeInteger(suffix)||suffix<=0)return {invalid:true};
  start=Math.max(0,size-suffix);end=size-1;
 }else{
  start=Number(match[1]);end=match[2]?Number(match[2]):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)return {invalid:true};
  end=Math.min(end,size-1);
 }
 return {start,end,length:end-start+1,header:`bytes=${start}-${end}`};
}

function parseContentRange(value,requested){
 const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(value||""));
 if(!match)return null;
 const start=Number(match[1]),end=Number(match[2]),size=Number(match[3]);
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||!Number.isSafeInteger(size)||size<=0||start>end||end>=size)return null;
 if(requested?.start!==null&&requested?.start!==undefined&&start!==requested.start)return null;
 if(requested?.suffix&&end-start+1>requested.end)return null;
 if(!requested?.suffix&&requested?.end!==null&&requested?.end!==undefined&&end>requested.end)return null;
 return {start,end,size,length:end-start+1};
}

module.exports={parseByteRange,parseContentRange};