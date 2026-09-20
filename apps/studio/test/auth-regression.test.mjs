import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load-module.mjs';
test('auth: malformed bearer never reaches token validation or ambient session',async()=>{
 for(const header of ['Basic example','Bearer','Bearer two tokens','Bearer a,b','Bearer a\tb']){
  let checked=0,session=0;
  const {authorizeRequest}=load('lib/agent-auth.ts',{
   '@/auth':{auth:async()=>{session++;return {user:{email:'human@example.test',allowedBrands:['example']}};}},
   '@/lib/store':{agentTokenValidForBrand:()=>{checked++;return true;},agentAuthorForBrand:()=>({name:'Agent',email:'agent@example.test'})},
  });
  assert.equal((await authorizeRequest(new Request('https://local',{headers:{authorization:header}}),'example')).ok,false,header);
  assert.equal(checked,0);assert.equal(session,0);
 }
});
test('auth: session provider failure denies access without leaking errors',async()=>{
 const {authorizeRequest}=load('lib/agent-auth.ts',{
  '@/auth':{auth:async()=>{throw new Error('private provider detail');}},'@/lib/store':{},
 });
 assert.deepEqual(await authorizeRequest(new Request('https://local'),'example'),{ok:false});
});
test('auth: rejected bearer cannot fall back to a valid human session',async()=>{
 const {authorizeRequest}=load('lib/agent-auth.ts',{
  '@/auth':{auth:async()=>({user:{email:'human@example.test',allowedBrands:['example']}})},
  '@/lib/store':{agentTokenValidForBrand:()=>false},
 });
 assert.deepEqual(await authorizeRequest(new Request('https://local',{headers:{authorization:'Bearer rejected'}}),'example'),{ok:false});
});
