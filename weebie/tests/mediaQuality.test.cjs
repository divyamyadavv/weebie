const test=require("node:test");
const assert=require("node:assert/strict");
const {buildQualityOptions,getSourceMaxDimension,isOriginalPlayable,normalizeQualityChoice,qualityLabel,resolveQualityOption}=require("../lib/mediaQuality.js");

test("720p source does not offer 1080p quality when no generated variant exists",()=>{
 const options=buildQualityOptions({width:1280,height:720,qualities:[]});
 assert.equal(options.some(option=>option.id==="1080p"),false);
 assert.equal(options.some(option=>option.id==="original"),true);
});

test("Original-only source never exposes fake lower qualities",()=>{
 const options=buildQualityOptions({width:480,height:270,qualities:[]});
 const ids=options.map(option=>option.id);
 assert.deepEqual(ids,["original"]);
});

test("Generated quality variants are exposed only when they are real and within source resolution",()=>{
 const options=buildQualityOptions({width:1920,height:1080,qualities:[{id:"480p",label:"480p",width:854,height:480,ready:true},{id:"1080p",label:"1080p",width:1920,height:1080,ready:true},{id:"1440p",label:"1440p",width:2560,height:1440,ready:true}]});
 const ids=options.map(option=>option.id);
 assert.equal(ids.includes("360p"),false);
 assert.equal(ids.includes("480p"),true);
 assert.equal(ids.includes("1080p"),true);
 assert.equal(ids.includes("1440p"),false);
});

test("pending and unverified renditions are never shown as available choices",()=>{
 const options=buildQualityOptions({width:1920,height:1080,qualities:[{id:"480p",width:854,height:480,status:"preparing"},{id:"720p",width:1280,height:720,ready:false},{id:"1080p",width:1920,height:1080,ready:true,filePath:"/private/path"}]});
 assert.deepEqual(options.map(option=>option.id),["original","1080p"]);
 assert.equal(Object.hasOwn(options[1],"filePath"),false);
});

test("Original is offered only after server codec and browser MIME checks pass",()=>{
 const source={mime:"video/mp4",sourceTracks:{originalCompatible:true}};
 assert.equal(isOriginalPlayable(source,mime=>mime==="video/mp4"),true);
 assert.equal(isOriginalPlayable({...source,sourceTracks:{originalCompatible:false}},()=>true),false);
 assert.equal(isOriginalPlayable(source,()=>""),false);
});

test("quality helpers safely handle null, undefined, empty, and malformed sources",()=>{
 for(const source of [null,undefined,{},[],"video",7,{sourceTracks:null,mime:null,width:Symbol("bad"),height:"invalid",qualities:[null,"720p",{id:{},width:Symbol("bad"),height:720,ready:true}]}]){
  assert.doesNotThrow(()=>isOriginalPlayable(source,()=>true));
  assert.doesNotThrow(()=>buildQualityOptions(source));
  assert.doesNotThrow(()=>getSourceMaxDimension(source));
  assert.doesNotThrow(()=>resolveQualityOption(source));
  assert.doesNotThrow(()=>qualityLabel(source));
 }
 assert.equal(isOriginalPlayable(null),false);
 assert.equal(isOriginalPlayable(undefined),false);
 assert.equal(isOriginalPlayable({}),false);
 assert.deepEqual(buildQualityOptions(null).map(option=>option.id),["original"]);
 assert.deepEqual(buildQualityOptions({qualities:[null,{id:"720p",status:"ready",width:1280,height:720}]}).map(option=>option.id),["original"]);
 assert.equal(getSourceMaxDimension(null),0);
 assert.equal(qualityLabel(null),"Original");
});

test("quality choice normalization accepts 720p and original values",()=>{
 assert.equal(normalizeQualityChoice("720p"),"720p");
 assert.equal(normalizeQualityChoice("720"),"720p");
 assert.equal(normalizeQualityChoice("ORIGINAL"),"original");
});
