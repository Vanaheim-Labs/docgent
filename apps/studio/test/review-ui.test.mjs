import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {load} from './load-module.mjs';
const require=createRequire(import.meta.url),react=require('react');
function nodes(n){if(!n||typeof n!=='object')return [];return [n,...[n.props?.children].flat(Infinity).flatMap(nodes)];}
test('cycle 2 UI: human explicitly reviews displayed source and submits that exact version',async()=>{
 let sent;const oldFetch=globalThis.fetch,oldWindow=globalThis.window;
 globalThis.fetch=async(u,o)=>{sent=JSON.parse(o.body);return Response.json({});};
 globalThis.window={location:{reload:()=>{}}};
 try{
  const {ReviewControls}=load('components/ReviewControls.tsx',{'react':{...react,useState:x=>[typeof x==='boolean'?true:x,()=>{}]}});
  const tree=ReviewControls({brand:'example',slug:'doc',baseSha:'a'.repeat(40),status:'review',source:'Exact reviewed source'});
  assert.ok(nodes(tree).find(n=>n.type==='pre'&&n.props.children==='Exact reviewed source'));
  const button=nodes(tree).find(n=>n.type==='button'&&n.props.children==='Approve');
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
 assert.match(text,/regenerable previews/);
 assert.doesNotMatch(text,/Release archives a new PDF/);
});
test('cycle 2 UI: historical or unidentified source cannot be approved',()=>{
 const {ReviewControls}=load('components/ReviewControls.tsx',{'react':{...react,useState:x=>[x,()=>{}]}});
 assert.equal(ReviewControls({brand:'example',slug:'doc',status:'review',source:'old'}),null);
});
