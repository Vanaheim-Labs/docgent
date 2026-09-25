import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function component(file){
 const code=buildSync({entryPoints:[new URL(`../src/components/${file}.tsx`,import.meta.url).pathname],bundle:true,jsx:'automatic',write:false,platform:'node',format:'cjs',packages:'external',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname}).outputFiles[0].text;
 const module={exports:{}};const testRequire=name=>name==='next/navigation'?{useRouter:()=>({refresh(){}})}:require(name);new Function('require','module','exports',code)(testRequire,module,module.exports);return module.exports;
}
test('unified editor keeps navigation and independent authoring and layout controls in its header',()=>{
 const {Editor}=component('Editor');
 const html=renderToStaticMarkup(React.createElement(Editor,{brand:'example',slug:'fixture',initialContent:'# Short\n\nHello',initialSha:'a'.repeat(40),vocabulary:{blocks:[],inlineIds:[],frontmatter:{required:[],optional:[],enums:{}}},workspace:{title:'Short fixture',timeline:[],canEdit:true,initialEditing:false}}));
 assert.match(html,/aria-label="Application navigation"/);
 assert.match(html,/Short fixture/);
 assert.match(html,/aria-label="Authoring mode"/);
 assert.match(html,/aria-label="Workspace layout"/);
 assert.match(html,/Preview only/);
 assert.match(html,/Editor only/);
 assert.match(html,/Side by side/);
 assert.match(html,/Read-only preview/);
});
