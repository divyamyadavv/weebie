const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {logoDestination,landingDestination}=require("../lib/authNavigation.cjs");

const root=path.join(__dirname,"..");

test("logo navigation follows the current authenticated user",()=>{
 assert.equal(logoDestination({uid:"user-1"}),"/dashboard");
 assert.equal(logoDestination(null),"/");
 assert.equal(logoDestination({uid:"user-1"},"/custom"),"/custom");
});

test("landing routing waits for auth and sends signed-in users to the proper destination",()=>{
 assert.equal(landingDestination(null,false),null);
 assert.equal(landingDestination({uid:"user-1"},false),"/dashboard");
 assert.equal(landingDestination({uid:"user-1"},true),"/verify-email?next=%2Fdashboard");
 const page=fs.readFileSync(path.join(root,"app/page.js"),"utf8");
 assert.match(page,/if\(loading\|\|destination\)return/);
 assert.match(page,/router\.replace\(destination\)/);
});

test("shared shell keeps protected routes behind the existing auth-loading guard",()=>{
 const shell=fs.readFileSync(path.join(root,"components/Shell.js"),"utf8");
 assert.match(shell,/if\(loading\|\|!user\|\|requiresVerification\)return/);
 assert.match(shell,/r\.replace\(`\/login\?next=/);
});

test("login keeps an intended protected destination and defaults to the dashboard",()=>{
 const form=fs.readFileSync(path.join(root,"components/AuthForm.js"),"utf8");
 assert.match(form,/requested\?\.startsWith\("\/"\).*:"\/dashboard"/);
 assert.match(form,/r\.replace\(destination\(\)\)/);
});

test("desktop, mobile, room, and public logos use auth-aware navigation",()=>{
 const files=[
  "components/Shell.js",
  "app/room/[code]/page.js",
  "app/page.js",
  "components/AuthForm.js",
  "app/verify-email/page.js"
 ];
 for(const file of files){
  const source=fs.readFileSync(path.join(root,file),"utf8");
  assert.match(source,/components\/Logo|from "\.\/Logo"|from "\.\.\/components\/Logo"/,file);
 }
 const logo=fs.readFileSync(path.join(root,"components/Logo.js"),"utf8");
 assert.match(logo,/aria-disabled=\{loading\|\|undefined\}/);
 assert.match(logo,/if\(loading\)event\.preventDefault\(\)/);
});
