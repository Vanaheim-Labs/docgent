import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-module.mjs';
const sha = 'a'.repeat(40);
const ctx = { params: Promise.resolve({ brand: 'example', slug: 'doc' }) };
const request = body => new Request('https://local/api/status/example/doc', {method:'POST', body:JSON.stringify(body)});
function setup(via = 'session') {
  const writes = [];
  const route = load('app/api/status/[brand]/[slug]/route.ts', {
    '@/lib/release': {},
    '@/lib/agent-auth': { authorizeRequest: async () => ({ok:true, via, author:{name:'Human',email:'human@example.test'}}) },
    '@/lib/vocabulary': {loadVocabulary:()=>({frontmatter:{enums:{status:['draft','review','approved','released','superseded']}}})},
    '@/lib/store': {storesFor:async()=>({docs:{
      readDocument:async()=>({sha,content:'---\nstatus: review\n---\nBody',frontmatter:{status:'review'}}),
      saveDocument:async(...args)=>{writes.push(args);return {sha:'b'.repeat(40),changed:true};},
    }})},
  });
  return {route,writes};
}
test('cycle 4: agent token can change status directly (human-only gate removed)', async()=>{
 const {route,writes}=setup('agent-token');
 assert.equal((await route.POST(request({to:'approved',baseSha:sha,author:'Human'}),ctx)).status,200);
 assert.equal(writes.length,1);
});
test('cycle 2: approval requires an explicitly inspected current blob',async()=>{
 for(const baseSha of [undefined,null,'','HEAD','b'.repeat(40)]) {
  const {route,writes}=setup();
  assert.equal((await route.POST(request({to:'approved',baseSha}),ctx)).status,baseSha?.length===40?409:428);
  assert.equal(writes.length,0);
 }
});
test('cycle 2: exact human approval records version and server identity',async()=>{
 const {route,writes}=setup();
 assert.equal((await route.POST(request({to:'approved',baseSha:sha}),ctx)).status,200);
 assert.match(writes[0][3].message,new RegExp(`Reviewed-Blob: ${sha}`));
 assert.equal(writes[0][3].baseSha,sha);
});
test('cycle 2: session authorization enforces brand membership at the route boundary',async()=>{
 const {authorizeRequest}=load('lib/agent-auth.ts',{
  '@/auth':{auth:async()=>({user:{email:'human@example.test',allowedBrands:['other']}})},
  '@/lib/store':{agentTokenValidForBrand:()=>false},
 });
 assert.equal((await authorizeRequest(new Request('https://local'), 'example')).ok,false);
});
