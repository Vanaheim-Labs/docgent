import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {load} from './load-module.mjs';
import {parseFrontmatter} from '@docgent/core/yaml';
import {GitStore,NotFoundError} from '../../../packages/git-store/src/index.mjs';
import {DocumentStore} from '../../../packages/git-store/src/documents.mjs';
const require=createRequire(import.meta.url),sha='a'.repeat(40),ctx={params:Promise.resolve({brand:'example',slug:'doc'})};
test('cycle 3 follow-up: delete cannot bypass signed-off lock or caller precondition',async()=>{
 for(const [status,baseSha,expected] of [['released',sha,409],['approved',sha,409],['draft',undefined,428],['draft','b'.repeat(40),409],['draft',sha,200]]){
  let writes=0,passed;
  const route=load('app/api/doc/[brand]/[slug]/route.ts',{
   '@/lib/editorial-policy':load('lib/editorial-policy.ts',{'@docgent/core/yaml':{parseFrontmatter}}),
   '@/lib/agent-auth':{authorizeRequest:async()=>({ok:true,via:'agent-token',author:{name:'Agent'}})},
   '@/lib/store':{storesFor:async()=>({docs:{readDocument:async()=>({sha,content:`---\nstatus: ${status}\n---\nBody`,frontmatter:{status}}),deleteDocument:async(b,s,opts)=>{writes++;passed=opts.baseSha;return {deleted:true};}}})},
   '@/lib/vocabulary':{},'@/lib/validate-client':{},'../../../../../../../../packages/git-store/src/index.mjs':{NotFoundError},
  });
  const res=await route.DELETE(new Request('https://local',{method:'DELETE',headers:baseSha?{'If-Match':baseSha}:{}}),ctx);
  assert.equal(res.status,expected);assert.equal(writes,expected===200?1:0);if(writes)assert.equal(passed,baseSha);
 }
});
test('cycle 3 follow-up: document delete never replaces caller SHA after a race',async()=>{
 const git=new GitStore({owner:'test',repo:'test',token:'test-placeholder'});
 let deleted=false;
 git.readFile=async()=>({sha:'b'.repeat(40)});
 git.deleteFile=async()=>{deleted=true;return {};};
 await assert.rejects(new DocumentStore(git).deleteDocument('example','doc',{baseSha:sha}),{name:'StaleWriteError'});
 assert.equal(deleted,false);
});
test('cycle 3 follow-up: restore button sends the version supplied at page load',async()=>{
 const oldFetch=globalThis.fetch,oldWindow=globalThis.window;let payload;
 const react=require('react');
 const {VersionPanel}=load('components/VersionPanel.tsx',{'react':{...react,useState:x=>[x,()=>{}],useCallback:f=>f,useEffect:()=>{}}});
 globalThis.window={confirm:()=>true,location:{}};
 globalThis.fetch=async(url,opts)=>{payload=JSON.parse(opts.body);return Response.json({});};
 try{
  const tree=VersionPanel({brand:'example',slug:'doc',baseSha:sha,timeline:[{sha:'b'.repeat(40),shortSha:'bbbbbbb',version:1,isCurrent:false,author:{},subject:'old'}],onCompare:()=>{}});
  function walk(node){if(!node||typeof node!=='object')return [];return [node,...[node.props?.children].flat(Infinity).flatMap(walk)];}
  const button=walk(tree).find(n=>n.type==='button'&&n.props.children==='Restore');
  await button.props.onClick();assert.equal(payload.baseSha,sha);
 }finally{globalThis.fetch=oldFetch;globalThis.window=oldWindow;}
});
