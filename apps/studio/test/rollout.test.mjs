import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load-module.mjs';
const sha='a'.repeat(40), ctx={params:Promise.resolve({brand:'example',slug:'doc'})};
const auth={'@/lib/agent-auth':{authorizeRequest:async()=>({ok:true,via:'session',author:{name:'Human',email:'human@example.test'}})}};
for(const status of ['released','superseded']) test(`rollout: legacy ${status} PDF remains a regenerated preview including PNG assets`,async()=>{
 let rendered=0;
 const route=load('app/api/render/[brand]/[slug]/route.ts',{
 ...auth,'@/lib/release':{releaseKey:()=>{throw Error('archive must not be invoked');}},
 '@/lib/store':{storesFor:async()=>({git:{head:async()=>sha,tree:async()=>({entries:[{type:'file',path:'documents/doc/assets/image.png'}]})},docs:{readAt:async()=>({content:status,frontmatter:{status}})}})},
 '@/lib/pdf-cache':{cacheDriver:()=> 'memory',cacheKey:()=> 'preview',pdfStore:()=>({get:async()=>null,put:async()=>{}})},
 '@/lib/render':{collectAssetsFromGit:async(g,d,paths,ref)=>{assert.ok(paths.includes('assets/image.png'));assert.equal(ref,sha);return {'assets/image.png':'AA=='};},renderMarkdown:async(c,b,assets)=>{rendered++;assert.ok(assets['assets/image.png']);return {pdf:Buffer.from('%PDF-preview'),renderMs:1};}},
 });
 const res=await route.GET(new Request('https://local'),ctx);
 assert.equal(res.status,200);assert.equal(await res.text(),'%PDF-preview');assert.equal(rendered,1);assert.doesNotMatch(res.headers.get('cache-control'),/immutable/);
});
test('rollout: legacy release commits exact-SHA review without invoking incomplete archive or restricting assets',async()=>{
 let writes=0;
 const route=load('app/api/status/[brand]/[slug]/route.ts',{
 ...auth,'@/lib/release':{archiveRelease:async()=>{throw Error('archive unavailable / PNG unsupported');}},
 '@/lib/vocabulary':{loadVocabulary:()=>({frontmatter:{enums:{status:['released']}}})},
 '@/lib/store':{storesFor:async()=>({git:{tree:async()=>{throw Error('must not inventory assets');}},docs:{readDocument:async()=>({sha,content:'---\nstatus: approved\n---\n![image](assets/image.png)',frontmatter:{status:'approved'}}),saveDocument:async(b,s,c,o)=>{writes++;assert.equal(o.baseSha,sha);assert.match(o.message,new RegExp(`Reviewed-Blob: ${sha}`));assert.doesNotMatch(o.message,/Release-Artifact|Release-PDF/);return {changed:true,sha};}}})},
 });
 assert.equal((await route.POST(new Request('https://local',{method:'POST',body:JSON.stringify({to:'released',baseSha:sha})}),ctx)).status,200);assert.equal(writes,1);
});
test('rollout: configured cache cannot advertise a ready release archive',async()=>{
 const route=load('app/api/auth/check/[brand]/route.ts',{...auth,
 '@/lib/pdf-cache':{cacheDriver:()=> 'r2'},
 '@/lib/store':{findBrand:()=>({name:'Example'}),storesFor:async()=>({git:{head:async()=>sha}})},
 });
 const data=await (await route.GET(new Request('https://local'),ctx)).json();
 assert.equal(data.checks.releaseArchive.ok,false);assert.equal(data.checks.releaseArchive.code,'deferred');assert.equal(data.capabilities.archiveRelease,false);
});
test('rollout: deletion CAS race returns actionable 409, not 500',async()=>{
 const route=load('app/api/doc/[brand]/[slug]/route.ts',{...auth,
 '@/lib/editorial-policy':{editorialGuard:()=>null},'@/lib/vocabulary':{},'@/lib/validate-client':{},
 '../../../../../../../../packages/git-store/src/index.mjs':{NotFoundError:class extends Error{}},
 '@/lib/store':{storesFor:async()=>({docs:{readDocument:async()=>({sha,content:'draft'}),deleteDocument:async()=>{throw Object.assign(new Error('changed'),{name:'StaleWriteError'});}}})},
 });
 const res=await route.DELETE(new Request('https://local',{method:'DELETE',headers:{'if-match':sha}}),ctx);
 assert.equal(res.status,409);assert.equal((await res.json()).error,'stale');
});
