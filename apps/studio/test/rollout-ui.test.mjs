import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {load} from './load-module.mjs';
const require=createRequire(import.meta.url),react=require('react');
function nodes(n){if(!n||typeof n!=='object')return [];return [n,...[n.props?.children].flat(Infinity).flatMap(nodes)];}
for(const status of ['approved','released','superseded']) test(`rollout UI: direct edit URL for ${status} remains editable`,async()=>{
 const Editor=()=>null;
 const {default:EditPage}=load('app/[brand]/[slug]/edit/page.tsx',{
  '@/auth':{auth:async()=>({user:{email:'human@example.test',allowedBrands:['example']}})},
  'next/navigation':{redirect:()=>{throw Error('redirect');},notFound:()=>{throw Error('not found');}},
  'next/link':{default:()=>null},'@/components/UserChip':{UserChip:()=>null},'@/components/Editor':{Editor},
  '@/lib/vocabulary':{loadVocabulary:()=>({})},
  '@/lib/store':{repoSlug:()=> 'example',storesFor:async()=>({docs:{readDocument:async()=>({sha:'a'.repeat(40),content:'source',frontmatter:{status}})}})},
 });
 const tree=await EditPage({params:Promise.resolve({brand:'example',slug:'doc'})});
 assert.equal(nodes(tree).some(n=>n.type===Editor),true);
 assert.doesNotMatch(JSON.stringify(tree),/locked|new document/i);
});
const hooks={...react,useState:x=>[x,()=>{}],useMemo:f=>f(),useCallback:f=>f,useRef:()=>({current:0}),useEffect:()=>{}};
for(const status of ['approved','released','superseded']) test(`rollout UI: ${status} allows edit and restore`,()=>{
 const {VersionPanel}=load('components/VersionPanel.tsx',{'react':hooks});
 const {DocumentWorkspace}=load('components/DocumentWorkspace.tsx',{'react':hooks,'@/components/VersionPanel':{VersionPanel},'@/components/ReviewControls':{},'@/components/DiffView':{},'@/components/CommentsPanel':{},'@/lib/comments':{parseComments:()=>[]}});
 const tree=DocumentWorkspace({brand:'example',slug:'doc',timeline:[],canEdit:true,baseSha:'a'.repeat(40),docMeta:{status},pdfUrl:'/pdf'});
 const bar=nodes(tree).find(n=>typeof n.type==='function');
 assert.equal(bar.props.canEdit,true);
 assert.doesNotMatch(JSON.stringify(tree),/locked|new document/i);
 const panel=VersionPanel({brand:'example',slug:'doc',timeline:[{sha:'b'.repeat(40),shortSha:'bbbbbbb',version:1,author:{name:'Human'},subject:'old',isCurrent:false}],baseSha:'a'.repeat(40),onCompare:()=>{}});
 const restore=nodes(panel).find(n=>n.type==='button'&&n.props.children==='Restore');
 assert.equal(restore.props.disabled,false);
});
