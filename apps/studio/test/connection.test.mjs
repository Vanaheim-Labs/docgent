import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load-module.mjs';
const ctx={params:Promise.resolve({brand:'example'})};
function route({ok=true,status,configured=false}={}) {
 return load('app/api/auth/check/[brand]/route.ts',{
  '@/lib/agent-auth':{authorizeRequest:async()=>ok?{ok:true,via:'agent-token',author:{name:'Agent'}}:{ok:false}},
  '@/lib/store':{findBrand:()=>({name:'Example'}),storesFor:async()=>({git:{head:async()=>{if(status)throw Object.assign(new Error('SECRET upstream detail'),{status});return 'a'.repeat(40);}}})},
  '@/lib/pdf-cache':{cacheDriver:()=>configured?'r2':'memory'},
 });
}
test('cycle 5: missing and invalid credentials have distinct safe remedies',async()=>{
 for(const [header,code] of [[null,'credential_required'],['Bearer test-placeholder','credential_rejected']]){
  const res=await route({ok:false}).GET(new Request('https://local',{headers:header?{authorization:header}:{}}),ctx);
  const body=await res.json();assert.equal(res.status,401);assert.equal(body.code,code);assert.ok(body.hint);assert.equal(res.headers.get('cache-control'),'no-store');
 }
});
test('cycle 5: valid token does not falsely imply repository readiness',async()=>{
 for(const status of [401,403,404,429,503]){
  const res=await route({status}).GET(new Request('https://local'),ctx);const body=await res.json();
  assert.equal(res.status,200);assert.equal(body.valid,true);assert.equal(body.ready,false);
  assert.equal(body.checks.repository.ok,false);assert.ok(body.checks.repository.hint);assert.doesNotMatch(JSON.stringify(body),/SECRET/);
 }
});
test('cycle 5: diagnostics report free-flowing agent capabilities without promising archived releases',async()=>{
 const body=await (await route().GET(new Request('https://local'),ctx)).json();
 assert.equal(body.checks.repository.ok,true);
 assert.deepEqual(body.capabilities,{editDraft:true,edit:true,acceptRewrite:true,restore:true,changeStatus:true,approve:true,release:true,archiveRelease:false});
 assert.equal(body.checks.releaseArchive.ok,false);assert.ok(body.checks.releaseArchive.hint);
 assert.equal(body.checks.releaseArchive.verified,false);
});
