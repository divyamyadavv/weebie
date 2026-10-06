const test=require("node:test");
const assert=require("node:assert/strict");
const {parseByteRange,parseContentRange}=require("../lib/byteRange.cjs");

test("parses closed and open-ended byte ranges",()=>{
 assert.deepEqual(parseByteRange("bytes=0-1",100),{start:0,end:1,length:2,header:"bytes=0-1"});
 assert.deepEqual(parseByteRange("bytes=50-",100),{start:50,end:99,length:50,header:"bytes=50-99"});
});

test("parses suffix ranges and clamps the end",()=>{
 assert.deepEqual(parseByteRange("bytes=-10",100),{start:90,end:99,length:10,header:"bytes=90-99"});
 assert.deepEqual(parseByteRange("bytes=95-120",100),{start:95,end:99,length:5,header:"bytes=95-99"});
});

test("rejects malformed, multi-range, empty, and unsatisfiable requests",()=>{
 for(const value of ["items=0-1","bytes=","bytes=0-1,4-5","bytes=100-", "bytes=-0"])assert.deepEqual(parseByteRange(value,100),{invalid:true});
 assert.equal(parseByteRange(null,100),null);
});

test("preserves valid byte ranges when Drive metadata has no file size",()=>{
 assert.deepEqual(parseByteRange("bytes=0-",0),{start:0,end:null,length:null,header:"bytes=0-",sizeUnknown:true,suffix:false});
 assert.deepEqual(parseByteRange("bytes=100-199",0),{start:100,end:199,length:null,header:"bytes=100-199",sizeUnknown:true,suffix:false});
 assert.deepEqual(parseByteRange("bytes=-500",0),{start:null,end:500,length:null,header:"bytes=-500",sizeUnknown:true,suffix:true});
 assert.deepEqual(parseByteRange("bytes=not-a-range",0),{invalid:true});
});

test("accepts an upstream range bounded by the requested range",()=>{
 assert.deepEqual(parseContentRange("bytes 0-1048575/8000000",parseByteRange("bytes=0-",8000000)),{start:0,end:1048575,size:8000000,length:1048576});
 assert.deepEqual(parseContentRange("bytes 100-199/8000000",parseByteRange("bytes=100-200",0)),{start:100,end:199,size:8000000,length:100});
 assert.equal(parseContentRange("bytes 100-199/8000000",parseByteRange("bytes=101-",0)),null);
 assert.equal(parseContentRange("bytes 0-2/8000000",parseByteRange("bytes=-2",0)),null);
 assert.deepEqual(parseContentRange("bytes 7999998-7999999/8000000",parseByteRange("bytes=-2",0)),{start:7999998,end:7999999,size:8000000,length:2});
});