import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-module.mjs';
import { parseFrontmatter } from '@docgent/core/yaml';
import * as version from '../../../packages/core/src/version.mjs';

const sha='a'.repeat(40), ctx={params:Promise.resolve({brand:'example',slug:'doc'})};
const content=status=>`---\nstatus: ${status}\nversion: 1\n---\nBody`;
function setup(kind,status='draft') {
 const writes=[];
 const boundaries={
  '@/auth':{auth:async()=>({user:{email:'human@example.test',allowedBrands:['example']}})},
  '@/lib/agent-auth':{authorizeRequest:async()=>({ok:true,via:'session',author:{name:'Human',email:'human@example.test'}})},
  '@/lib/store':{storesFor:async()=>({docs:{readDocument:async()=>({sha,content:content(status),frontmatter:{status,version:'1'}}),readAt:async()=>({content:content('approved')+'old',frontmatter:{status:'approved',version:'1'}}),timeline:async()=>[],saveDocument:async(...args)=>{writes.push(args);return {changed:true,sha};}}})},
  '@/lib/vocabulary':{loadVocabulary:()=>({})},'@/lib/validate-client':{validateMarkdown:()=>[]},'@/lib/models':{findModel:()=>null},
  '../../../../../../../../packages/git-store/src/index.mjs':{},
  '../../../../../../../../packages/core/src/version.mjs':version,
 };
 // Load the production guard when it exists; RED executes today's routes without it.
 try {boundaries['@/lib/editorial-policy']=load('lib/editorial-policy.ts',{'@docgent/core/yaml':{parseFrontmatter}});}catch(e){if(e.code!=='ENOENT')throw e;}
 const file=kind==='accept'?'rewrite/[brand]/[slug]/accept':`${kind}/[brand]/[slug]`;
 return {route:load(`app/api/${file}/route.ts`,boundaries),writes};
}
async function call(kind,status,body){
 const x=setup(kind,status);const method=kind==='doc'?'PUT':'POST';
 const res=await x.route[method](new Request('https://local',{method,body:JSON.stringify(body)}),ctx);
 return {...x,res};
}
for(const kind of ['doc','accept','restore']) {
 test(`cycle 3: ${kind} refuses edits retaining approved/released status`,async()=>{
  for(const status of ['approved','released','superseded']){
   const {res,writes}=await call(kind,status,{content:content(status)+'edit',baseSha:sha,instruction:'edit',ref:'b'.repeat(40)});
   assert.equal(res.status,409);assert.equal(writes.length,0);
  }
 });
 test(`cycle 3: ${kind} requires current explicit SHA`,async()=>{
  for(const baseSha of [undefined,'b'.repeat(40)]){
   const {res,writes}=await call(kind,'draft',{content:content('draft')+'edit',baseSha,instruction:'edit',ref:'b'.repeat(40)});
   assert.equal(res.status,baseSha?409:428);assert.equal(writes.length,0);
  }
 });
}
for(const kind of ['doc','accept'])test(`cycle 3: ${kind} cannot promote raw frontmatter`,async()=>{
 const {res,writes}=await call(kind,'draft',{content:content('approved'),baseSha:sha,instruction:'edit'});
 assert.equal(res.status,409);assert.equal(writes.length,0);
});
test('cycle 3: draft saves and accepted internal rewrites still work',async()=>{
 for(const kind of ['doc','accept','restore']){
  const {res,writes}=await call(kind,'draft',{content:content('draft')+'edit',baseSha:sha,instruction:'edit',ref:'b'.repeat(40)});
  assert.equal(res.status,200);assert.equal(writes.length,1);assert.match(writes[0][2],/status: draft/);
 }
});
