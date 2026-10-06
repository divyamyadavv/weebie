class OriginValidationError extends Error{
 constructor(){super("This request must come from the Weebie app.");this.status=403}
}

function firstHeaderValue(value){
 return value?.split(",")[0]?.trim()||"";
}

// This allowlist is only for local development and is ignored in production.
function developmentAllowedOrigins(){
 if(process.env.NODE_ENV==="production")return [];
 return String(process.env.DEV_ALLOWED_ORIGINS||"").split(",").map(value=>value.trim().replace(/\/+$/,"")).filter(Boolean);
}

function assertSameOrigin(request){
 const requestUrl=new URL(request.url);
 const forwardedHost=firstHeaderValue(request.headers.get("x-forwarded-host"));
 const expectedHost=forwardedHost||requestUrl.host;
 const forwardedProtocol=firstHeaderValue(request.headers.get("x-forwarded-proto"));
 const expectedProtocol=forwardedProtocol?`${forwardedProtocol.replace(/:$/,"")}:`:requestUrl.protocol;
 const expectedOrigin=`${expectedProtocol}//${expectedHost}`;
 const origin=request.headers.get("origin");

 if(!origin){
  if(request.method==="GET"&&request.headers.get("sec-fetch-site")==="same-origin")return;
  throw new OriginValidationError();
 }

 let parsedOrigin;
 try{parsedOrigin=new URL(origin)}catch{throw new OriginValidationError()}
 const allowedOrigins=developmentAllowedOrigins();
 const rewrittenLocalOrigin=parsedOrigin.origin===requestUrl.origin||parsedOrigin.origin==="http://localhost:3000";
 if(!["http:","https:"].includes(parsedOrigin.protocol)||(parsedOrigin.origin!==expectedOrigin&&!allowedOrigins.includes(parsedOrigin.origin)&&!(rewrittenLocalOrigin&&allowedOrigins.includes(expectedOrigin))))throw new OriginValidationError();
}

module.exports={assertSameOrigin,OriginValidationError};
