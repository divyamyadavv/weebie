const test=require("node:test");
const assert=require("node:assert/strict");
const {afterEach,beforeEach}=test;
const {assertSameOrigin,OriginValidationError}=require("../lib/requestOrigin.cjs");

const originalEnvironment={
 NODE_ENV:process.env.NODE_ENV,
 DEV_ALLOWED_ORIGINS:process.env.DEV_ALLOWED_ORIGINS
};

beforeEach(()=>{
 process.env.NODE_ENV="development";
 delete process.env.DEV_ALLOWED_ORIGINS;
});

afterEach(()=>{
 if(originalEnvironment.NODE_ENV===undefined)delete process.env.NODE_ENV;
 else process.env.NODE_ENV=originalEnvironment.NODE_ENV;
 if(originalEnvironment.DEV_ALLOWED_ORIGINS===undefined)delete process.env.DEV_ALLOWED_ORIGINS;
 else process.env.DEV_ALLOWED_ORIGINS=originalEnvironment.DEV_ALLOWED_ORIGINS;
});

function request(origin,headers={},url="http://localhost:3000/api/drive/select"){
 const values={origin,...headers};
 return {
  url,
  method:"POST",
  headers:{get:name=>values[name]??null}
 };
}

test("rejects a tunnel Origin when no development allowlist is configured",()=>{
 assert.throws(()=>assertSameOrigin(request("https://d5ndb11x-3000.inc1.devtunnels.ms")),OriginValidationError);
});

test("allows configured development tunnel Origins with or without a trailing slash",()=>{
 const origin="https://d5ndb11x-3000.inc1.devtunnels.ms";
 process.env.DEV_ALLOWED_ORIGINS=origin;
 assert.doesNotThrow(()=>assertSameOrigin(request(origin)));

 process.env.DEV_ALLOWED_ORIGINS=`${origin}/`;
 assert.doesNotThrow(()=>assertSameOrigin(request(origin)));
});

test("rejects a listed tunnel Origin in production",()=>{
 process.env.NODE_ENV="production";
 process.env.DEV_ALLOWED_ORIGINS="https://d5ndb11x-3000.inc1.devtunnels.ms";
 assert.throws(()=>assertSameOrigin(request("https://d5ndb11x-3000.inc1.devtunnels.ms")),OriginValidationError);
});

test("rejects an unlisted foreign Origin and a missing Origin on POST",()=>{
 process.env.DEV_ALLOWED_ORIGINS="https://allowed.example";
 assert.throws(()=>assertSameOrigin(request("https://foreign.example")),OriginValidationError);
 assert.throws(()=>assertSameOrigin(request(null)),OriginValidationError);
});

test("accepts normal same-origin requests",()=>{
 assert.doesNotThrow(()=>assertSameOrigin(request("http://localhost:3000")));
});

test("accepts the forwarded host and protocol for a tunneled request",()=>{
 assert.doesNotThrow(()=>assertSameOrigin(request("https://weebie.example",{
  "x-forwarded-host":"weebie.example",
  "x-forwarded-proto":"https"
 })));
});

test("accepts a localhost Origin rewritten by the tunnel only when its forwarded origin is allowlisted",()=>{
 process.env.DEV_ALLOWED_ORIGINS="https://d5ndb11x-3000.inc1.devtunnels.ms";
 const headers={
  "x-forwarded-host":"d5ndb11x-3000.inc1.devtunnels.ms",
  "x-forwarded-proto":"https"
 };
 assert.doesNotThrow(()=>assertSameOrigin(request("http://localhost:3000",headers)));
 assert.doesNotThrow(()=>assertSameOrigin(request("http://localhost:3000",headers,"https://d5ndb11x-3000.inc1.devtunnels.ms/api/drive/select")));
});
