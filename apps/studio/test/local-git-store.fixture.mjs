// Test-only transport adapter. Copied into an isolated Next tree by next-fixture.mjs.
// Never imported by application code; no network or customer repository access.
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {GitStore,NotFoundError,StaleWriteError} from '../../../../packages/git-store/src/index.mjs';
import {DocumentStore} from '../../../../packages/git-store/src/documents.mjs';
const root=process.env.DOCGENT_TEST_GIT;
if(!root || process.env.NODE_ENV==='production' || !root.includes('/.qa/next-')) throw new Error('Local Git fixture unavailable');
const run=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
class LocalGit extends GitStore {
 constructor(){super({owner:'synthetic',repo:'fixture',token:'unused-local-transport',fetchImpl:()=>{throw new Error('Network forbidden');}});}
 async head(){return run('rev-parse','HEAD');}
 async readFile(path,{ref='HEAD'}={}){try{return {content:execFileSync('git',['show',`${ref}:${path}`],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']}),sha:run('rev-parse',`${ref}:${path}`)};}catch{throw new NotFoundError(path);}}
 async readFileAt(path,ref){return this.readFile(path,{ref});}
 async readBlob(sha){return execFileSync('git',['cat-file','-p',sha],{cwd:root,encoding:'utf8'});}
 async tree({ref='HEAD',prefix=''}={}){return {sha:await this.head(),entries:run('ls-tree','-r',ref).split('\n').filter(Boolean).map(line=>{const [meta,path]=line.split('\t');return {path,type:'file',sha:meta.split(' ')[2]};}).filter(e=>e.path.startsWith(prefix))};}
 async history(path,{limit=50}={}){return run('log',`-${limit}`,'--format=%H', '--',path).split('\n').filter(Boolean).map(sha=>({sha,shortSha:sha.slice(0,7),subject:run('show','-s','--format=%s',sha),message:run('show','-s','--format=%B',sha),author:{name:run('show','-s','--format=%an',sha),email:run('show','-s','--format=%ae',sha),date:run('show','-s','--format=%aI',sha)},url:''}));}
 async writeFile(path,content,{sha,message,author}={}){
  // Synchronous compare/write/commit is atomic with respect to this test process.
  const absolute=resolve(root,path);if(!absolute.startsWith(root+'/documents/'))throw new Error('Fixture path refused');
  let current;try{current=run('rev-parse',`HEAD:${path}`);}catch{}
  if(current!==sha)throw new StaleWriteError(path,{expected:sha,actual:current});
  const next=execFileSync('git',['hash-object','--stdin'],{cwd:root,input:content,encoding:'utf8'}).trim();
  if(current===next)return {changed:false,sha:current};
  mkdirSync(dirname(absolute),{recursive:true});writeFileSync(absolute,content);run('add','--',path);run('-c',`user.name=${author?.name||'Synthetic author'}`,'-c',`user.email=${author?.email||'fixture@example.invalid'}`,'commit','-m',message||'Synthetic edit');
  return {changed:true,sha:next,commit:{sha:await this.head()}};
 }
}
const git=new LocalGit();const docs=new DocumentStore(git);
export const brands=()=>[{id:'example',name:'Synthetic example',repo:'synthetic/fixture',access:{emails:['fixture@example.invalid'],domains:[]}}];
export const findBrand=id=>brands().find(b=>b.id===id);
export const brandsForEmail=email=>email==='fixture@example.invalid'?brands():[];
export const storesFor=async brand=>{if(!findBrand(brand))throw new Error('Unknown synthetic brand');return {git,docs};};
export const repoSlug=()=> 'synthetic/fixture';
export const agentTokenValidForBrand=()=>false;
export const agentAuthorForBrand=()=>({name:'Synthetic author',email:'fixture@example.invalid'});
export async function listAllDocuments(){const result=await docs.listDocuments({brand:'example',withFrontmatter:true});return {errors:[],documents:result.documents.map(d=>({...d,brandName:'Synthetic example',title:d.frontmatter.title,dateMs:null,lastCommit:{at:1,name:'Synthetic author',email:null,subject:'Fixture',isAgent:false}}))};}
