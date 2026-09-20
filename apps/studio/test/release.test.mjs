import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load-module.mjs';
const ctx={params:Promise.resolve({brand:'example',slug:'doc'})}, sha='a'.repeat(40);
const auth={'@/lib/agent-auth':{authorizeRequest:async()=>({ok:true,via:'session',author:{name:'Human',email:'human@example.test'}})}};
test('cycle 4: preview pins source and assets to the resolved commit, not moving HEAD',async()=>{
 const reads=[];
 const cache={pdfStore:()=>({get:async()=>null,put:async()=>{throw new Error('offline');}}),cacheKey:()=> 'key',cacheDriver:()=> 'memory'};
 const route=load('app/api/render/[brand]/[slug]/route.ts',{
  ...auth,'@/lib/pdf-cache':cache,'@/lib/release':{releaseKey:()=> 'release-key'},
  '@/lib/store':{storesFor:async()=>({git:{head:async()=>sha,tree:async(opts)=>{reads.push(opts.ref);return {entries:[]};}},docs:{timeline:async()=>[{sha}],readAt:async(b,s,ref)=>{reads.push(ref);return {content:'draft',frontmatter:{status:'draft'}};},readDocument:async()=>{reads.push('MOVING_HEAD');return {content:'draft'};}}})},
  '@/lib/render':{collectAssetsFromGit:async(g,d,p,ref)=>{reads.push(ref);return {};},renderMarkdown:async()=>({pdf:Buffer.from('%PDF-test'),renderMs:1})},
 });
 const res=await route.GET(new Request('https://local'),ctx);
 assert.equal(res.status,200);assert.ok(reads.length>=3);assert.ok(reads.every(x=>x===sha),JSON.stringify(reads));
});
test('cycle 4: mutable ref is rejected, never cached as immutable output',async()=>{
 let touched=false;
 const route=load('app/api/render/[brand]/[slug]/route.ts',{
 ...auth,'@/lib/store':{storesFor:async()=>{touched=true;throw new Error('unexpected');}},'@/lib/render':{},'@/lib/pdf-cache':{},'@/lib/release':{},
 });
 assert.equal((await route.GET(new Request('https://local?ref=main'),ctx)).status,400);assert.equal(touched,false);
});
test('cycle 4: durable driver propagates write failure and uses conditional creation',async()=>{
 const saved={...process.env};const oldFetch=globalThis.fetch;
 try{
  process.env.DOCGENT_PDF_CACHE_ENDPOINT='https://archive.invalid';process.env.DOCGENT_PDF_CACHE_BUCKET='test';process.env.DOCGENT_PDF_CACHE_TOKEN='test-placeholder';
  let headers;
  globalThis.fetch=async(url,opts)=>{headers=opts.headers;return new Response('',{status:503});};
  const {pdfStore}=load('lib/pdf-cache.ts');
  await assert.rejects(pdfStore().put('key',Buffer.from('pdf')));
  assert.equal(headers['If-None-Match'],'*');
 }finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
