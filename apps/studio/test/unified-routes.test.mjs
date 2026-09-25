import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load-module.mjs';
const doc={content:'# Fixture',sha:'b'.repeat(40),frontmatter:{title:'Fixture'}};
const Editor=()=>null;
const boundaries={
 '@/auth':{auth:async()=>({user:{allowedBrands:['example']}})},
 'next/navigation':{notFound:()=>{throw Error('notFound');},redirect:()=>{throw Error('redirect');}},
 'next/link':()=>null,
 '@/lib/store':{storesFor:async()=>({docs:{readDocument:async()=>doc,readAt:async()=>doc,timeline:async()=>[]}}),repoSlug:()=>''},
 '@/lib/vocabulary':{loadVocabulary:()=>({})},
 '@/lib/metadata':{fetchDocPreviewMeta:async()=>null},
 '@/components/UserChip':{UserChip:()=>null},
 '@/components/DocumentWorkspace':{DocumentWorkspace:()=>null},
 '@/components/SignInPreview':{SignInPreview:()=>null},
 '@/components/Editor':{Editor}
};
function find(node,type){if(!node)return null;if(node.type===type)return node;for(const c of [node.props?.children].flat(Infinity)){const r=find(c,type);if(r)return r;}return null;}
test('flagged edit route denies an unrelated brand before reading document content',async()=>{
 const old=process.env.DOCGENT_UNIFIED_WORKSPACE;process.env.DOCGENT_UNIFIED_WORKSPACE='1';let touched=false;
 try{const page=load('app/[brand]/[slug]/edit/page.tsx',{...boundaries,'@/auth':{auth:async()=>({user:{allowedBrands:['other']}})},'@/lib/store':{storesFor:async()=>{touched=true;return {docs:{readDocument:async()=>doc}};}}}).default;
 await assert.rejects(page({params:Promise.resolve({brand:'example',slug:'fixture'})}),/notFound/);assert.equal(touched,false);
 }finally{if(old===undefined)delete process.env.DOCGENT_UNIFIED_WORKSPACE;else process.env.DOCGENT_UNIFIED_WORKSPACE=old;}
});
test('feature flag routes reader and legacy /edit into the same editor shell with read-only historical state',async()=>{
 const old=process.env.DOCGENT_UNIFIED_WORKSPACE;process.env.DOCGENT_UNIFIED_WORKSPACE='1';
 try{
  for(const [file,editing,v] of [['page.tsx',false,undefined],['edit/page.tsx',true,undefined],['page.tsx',false,'a'.repeat(40)]]){
   const page=load(`app/[brand]/[slug]/${file}`,boundaries).default;
   const tree=await page({params:Promise.resolve({brand:'example',slug:'fixture'}),searchParams:Promise.resolve({v})});
   const editor=find(tree,Editor);assert.ok(editor,'shared Editor shell');
   assert.equal(editor.props.workspace.initialEditing,editing);
   assert.equal(editor.props.workspace.canEdit,!v);
  }
 }finally{if(old===undefined)delete process.env.DOCGENT_UNIFIED_WORKSPACE;else process.env.DOCGENT_UNIFIED_WORKSPACE=old;}
});
