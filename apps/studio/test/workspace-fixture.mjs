import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import {load} from './load-module.mjs';
export const short='---\ntitle: Short fixture\nbrand: example\ndoctype: report\nversion: 1\ndate: 2026-09-25\n---\n\n# Summary\n\nA short paragraph.\n';
export const complex=short+'\n| Name | Value |\n| --- | --- |\n| Revenue | 42 |\n\n::: callout\nKeep **formatting** intact.\n:::\n\n::chart{type="bar" data="figures/chart.csv"}\n\n```unknown\nopaque content\n```\n';
export async function serveFixture(){
 const vocabulary=load('lib/vocabulary.ts',{'node:fs':{default:fs},'node:path':{default:path}}).loadVocabulary();
 const timeline=[{sha:'a'.repeat(40),shortSha:'aaaaaaa',version:2,subject:'docs(example/fixture): Clarify summary',isCurrent:true,author:{name:'Fixture author',date:'2026-09-25T00:00:00Z'}},{sha:'d'.repeat(40),shortSha:'ddddddd',version:1,subject:'docs(example/fixture): Add initial table',isCurrent:false,author:{name:'Other fixture author',date:'2026-09-24T00:00:00Z'}}];
 const props={brand:'example',slug:'fixture',initialContent:complex,initialSha:'b'.repeat(40),vocabulary,workspace:{title:'Short fixture',timeline,canEdit:true,initialEditing:false}};
 const result=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{Editor}from'./apps/studio/src/components/Editor';const props=${JSON.stringify(props)};window.fixtureProps=props;createRoot(document.getElementById('root')).render(<Editor {...props}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',platform:'browser',tsconfig:'apps/studio/tsconfig.json'});
 const css=readFileSync('apps/studio/src/app/globals.css','utf8')+readFileSync('apps/studio/src/app/workspace.css','utf8');
 const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.end(result.outputFiles[0].text);}else if(req.url==='/style.css'){res.setHeader('content-type','text/css');res.end(css);}else{res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
