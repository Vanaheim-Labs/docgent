import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {load} from './load-module.mjs';
const require=createRequire(import.meta.url),react=require('react');
function nodes(n){if(!n||typeof n!=='object')return [];return [n,...[n.props?.children].flat(Infinity).flatMap(nodes)];}
for(const status of ['approved','released','superseded']) test(`rollout UI: direct edit URL for ${status} has no editor`,async()=>{
 const Editor=()=>null;
 const {default:EditPage}=load('app/[brand]/[slug]/edit/page.tsx',{
  '@/auth':{auth:async()=>({user:{email:'human@example.test',allowedBrands:['example']}})},
  'next/navigation':{redirect:()=>{throw Error('redirect');},notFound:()=>{throw Error('not found');}},
  'next/link':{default:()=>null},'@/components/UserChip':{},'@/components/Editor':{Editor},
  '@/lib/vocabulary':{loadVocabulary:()=>({})},
  '@/lib/store':{repoSlug:()=> 'example',storesFor:async()=>({docs:{readDocument:async()=>({sha:'a'.repeat(40),content:'source',frontmatter:{status}})}})},
 });
 const tree=await EditPage({params:Promise.resolve({brand:'example',slug:'doc'})});
 assert.equal(nodes(tree).some(n=>n.type===Editor),false);
 assert.match(JSON.stringify(tree),status==='approved'?/review/:/new document/i);
});
const hooks={...react,useState:x=>[x,()=>{}],useMemo:f=>f(),useCallback:f=>f,useRef:()=>({current:0}),useEffect:()=>{}};
for(const status of ['approved','released','superseded']) test(`rollout UI: ${status} hides edit and disables restore with recovery`,()=>{
 const {VersionPanel}=load('components/VersionPanel.tsx',{'react':hooks});
 const {DocumentWorkspace}=load('components/DocumentWorkspace.tsx',{'react':hooks,'@/components/VersionPanel':{VersionPanel},'@/components/ReviewControls':{},'@/components/DiffView':{},'@/components/CommentsPanel':{},'@/lib/comments':{parseComments:()=>[]}});
 const tree=DocumentWorkspace({brand:'example',slug:'doc',timeline:[],canEdit:true,baseSha:'a'.repeat(40),docMeta:{status},pdfUrl:'/pdf'});
 const bar=nodes(tree).find(n=>typeof n.type==='function');
 assert.equal(bar.props.canEdit,false);
 assert.match(JSON.stringify(tree),status==='approved'?/Return.*review/:/new document/i);
 const panel=VersionPanel({brand:'example',slug:'doc',timeline:[{sha:'b'.repeat(40),shortSha:'bbbbbbb',version:1,author:{name:'Human'},subject:'old',isCurrent:false}],baseSha:'a'.repeat(40),editLockReason:'Locked: create a new document',onCompare:()=>{}});
 const restore=nodes(panel).find(n=>n.type==='button'&&n.props.children==='Restore');
 assert.equal(restore.props.disabled,true);assert.match(restore.props.title,/Locked/);
});
