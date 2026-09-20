import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load-module.mjs';
test('cycle 2 follow-up: explicit agent credential never inherits human session authority',async()=>{
 const {authorizeRequest}=load('lib/agent-auth.ts',{
  '@/auth':{auth:async()=>({user:{email:'human@example.test',allowedBrands:['example']}})},
  '@/lib/store':{agentTokenValidForBrand:()=>true,agentAuthorForBrand:()=>({name:'Agent',email:'agent@example.test'})},
 });
 assert.equal((await authorizeRequest(new Request('https://local',{headers:{authorization:'Bearer test-placeholder'}}),'example')).via,'agent-token');
});
