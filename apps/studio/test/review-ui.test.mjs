import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {load} from './load-module.mjs';
const require=createRequire(import.meta.url),react=require('react');
function nodes(n){if(!n||typeof n!=='object')return [];return [n,...[n.props?.children].flat(Infinity).flatMap(nodes)];}
test('review is optional and status submits the exact displayed version',async()=>{
 let sent;const oldFetch=globalThis.fetch,oldWindow=globalThis.window;
 globalThis.fetch=async(u,o)=>{sent=JSON.parse(o.body);return Response.json({});};
 globalThis.window={location:{reload:()=>{}}};
 try{
  const {ReviewControls}=load('components/ReviewControls.tsx',{'react':{...react,useState:x=>[x,()=>{}]}});
  const tree=ReviewControls({brand:'example',slug:'doc',baseSha:'a'.repeat(40),status:'review',source:'Exact reviewed source'});
  assert.ok(nodes(tree).find(n=>n.type==='pre'&&n.props.children==='Exact reviewed source'));
  const button=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Approve');
  assert.equal(button.props.disabled,false);
  assert.equal(nodes(tree).some(n=>n.type==='input'&&n.props.type==='checkbox'),false);
  await button.props.onClick();assert.deepEqual(sent,{to:'approved',baseSha:'a'.repeat(40)});
 }finally{globalThis.fetch=oldFetch;globalThis.window=oldWindow;}
});
test('release status UI does not promise a stored PDF',()=>{
 const {ReviewControls}=load('components/ReviewControls.tsx',{'react':{...react,useState:x=>[x,()=>{}]}});
 const tree=ReviewControls({brand:'example',slug:'doc',baseSha:'a'.repeat(40),status:'approved',source:'Reviewed source'});
 const elements=nodes(tree);
 assert.ok(elements.find(n=>n.type==='button'&&n.props.children==='Mark as released'));
 const text=elements.flatMap(n=>[n.props?.children].flat(Infinity)).filter(x=>typeof x==='string').join(' ');
 assert.match(text,/No PDF is archived/);
 assert.match(text,/not evidence that the current content was reviewed/);
 assert.doesNotMatch(text,/automatically return to review|locks this issue/);
 assert.match(text,/regenerable previews/);
 assert.doesNotMatch(text,/Release archives a new PDF/);
});
test('all lifecycle statuses expose every other valid status without a gate',()=>{
 const {ReviewControls}=load('components/ReviewControls.tsx',{'react':{...react,useState:x=>[x,()=>{}]}});
 const statuses=['draft','review','approved','released','superseded'];
 for(const status of statuses){
  const tree=ReviewControls({brand:'example',slug:'doc',baseSha:'a'.repeat(40),status,source:'source'});
  const buttons=nodes(tree).filter(n=>n.type==='button');
  assert.deepEqual(buttons.map(n=>n.key).sort(),statuses.filter(s=>s!==status).sort());
  assert.ok(buttons.every(n=>!n.props.disabled));
 }
});
test('cycle 2 UI: historical or unidentified source cannot be approved',()=>{
 const {ReviewControls}=load('components/ReviewControls.tsx',{'react':{...react,useState:x=>[x,()=>{}]}});
 assert.equal(ReviewControls({brand:'example',slug:'doc',status:'review',source:'old'}),null);
});
