import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load-module.mjs';
const sha='b'.repeat(40),revision='a'.repeat(40),content='# Fixture';
const ctx={params:Promise.resolve({brand:'example',slug:'fixture'})};
function route(pinned=content){return load('app/api/doc/[brand]/[slug]/route.ts',{
 '@/lib/editorial-policy':{editorialGuard:()=>null},
 '@/lib/store':{storesFor:async()=>({git:{head:async()=>revision},docs:{readDocument:async()=>({content,sha}),readAt:async()=>({content:pinned}),saveDocument:async()=>({changed:false,sha,commit:null})}})},
 '@/lib/vocabulary':{loadVocabulary:()=>({})},'@/lib/validate-client':{validateMarkdown:()=>[]},
 '@/lib/agent-auth':{authorizeRequest:async()=>({ok:true,author:{name:'Fixture'}})},
 '../../../../../../../../packages/git-store/src/index.mjs':{NotFoundError:class extends Error{}}
});}
function request(){return new Request('https://local',{method:'PUT',body:JSON.stringify({content,baseSha:sha,captureRevision:true})});}
test('concurrent change between unchanged save and pinning fails closed instead of exporting another author',async()=>{
 const res=await route('# Concurrent content').PUT(request(),ctx);assert.equal(res.status,409);
});
test('unchanged save can return an immutable export revision verified against saved content',async()=>{
 const res=await route().PUT(request(),ctx);assert.equal(res.status,200);assert.equal((await res.json()).revision,revision);
});
