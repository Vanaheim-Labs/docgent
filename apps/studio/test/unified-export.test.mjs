import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-module.mjs';
const revision = 'a'.repeat(40);
const head = 'b'.repeat(40);
test('DOCX rejects mutable and malformed revision references before rendering', async () => {
  const route=load('app/api/export/[brand]/[slug]/route.ts',{
    '@/lib/agent-auth':{authorizeRequest:async()=>({ok:true})},
    '@/lib/store':{storesFor:async()=>{throw new Error('must not read');}},
    '@/lib/render':{}
  });
  for(const ref of ['main','abc','../other','A'.repeat(40)]) {
    const res=await route.GET(new Request(`https://local?format=docx&ref=${encodeURIComponent(ref)}`),{params:Promise.resolve({brand:'example',slug:'fixture'})});
    assert.equal(res.status,400);
  }
});
const ctx = { params: Promise.resolve({brand:'example',slug:'fixture'}) };
test('DOCX exports the requested immutable revision, including assets and receipt', async () => {
  const seen = [];
  const route = load('app/api/export/[brand]/[slug]/route.ts', {
    '@/lib/agent-auth': {authorizeRequest: async()=>({ok:true})},
    '@/lib/store': {storesFor:async()=>({git:{head:async()=>head,tree:async({ref})=>{seen.push(ref);return {entries:[]};}},docs:{readAt:async(b,s,ref)=>{seen.push(ref);return {content:'fixture',frontmatter:{}};}}})},
    '@/lib/render': {collectAssetsFromGit:async(g,d,p,ref)=>{seen.push(ref);return {};}}
  });
  const oldFetch=globalThis.fetch, oldUrl=process.env.DOCGENT_RENDER_URL, oldKey=process.env.DOCGENT_API_KEY;
  process.env.DOCGENT_RENDER_URL='https://fixture.invalid'; process.env.DOCGENT_API_KEY='test-only';
  globalThis.fetch=async()=>new Response('fixture-docx');
  try {
    const res=await route.GET(new Request(`https://local/api/export/example/fixture?format=docx&ref=${revision}`),ctx);
    assert.equal(res.status,200);
    assert.ok(seen.length>0);
    assert.deepEqual([...new Set(seen)],[revision]);
    assert.equal(res.headers.get('x-docgent-revision'),revision);
    assert.match(res.headers.get('content-disposition'),/aaaaaaa/);
  } finally { globalThis.fetch=oldFetch; for(const [k,v] of Object.entries({DOCGENT_RENDER_URL:oldUrl,DOCGENT_API_KEY:oldKey})) {if(v===undefined) delete process.env[k]; else process.env[k]=v;} }
});
