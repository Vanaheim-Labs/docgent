import {cpSync,mkdirSync,mkdtempSync,writeFileSync,readFileSync,symlinkSync,openSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {encode} from 'next-auth/jwt';
const repo=process.cwd();
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function ready(url,process){for(let i=0;i<240;i++){if(process.exitCode!==null)throw new Error(`Fixture exited: ${process.exitCode}`);try{const r=await fetch(url);if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw new Error(`Fixture not ready: ${url}`);}
export async function startNextFixture({unified=true}={}){
 mkdirSync('.qa',{recursive:true});const root=mkdtempSync(resolve('.qa/next-'));const studio=join(root,'apps/studio');mkdirSync(studio,{recursive:true});
 for(const file of ['src','public','package.json','tsconfig.json','next-env.d.ts'])cpSync(join(repo,'apps/studio',file),join(studio,file),{recursive:true});
 for(const dir of ['packages','node_modules','vocabulary','brands']){try{symlinkSync(join(repo,dir),join(root,dir));}catch{}}
 cpSync(join(repo,'apps/studio/test/local-git-store.fixture.mjs'),join(studio,'src/lib/store.ts'));
 writeFileSync(join(studio,'next.config.mjs'),'export default {devIndicators:false};\n');
 const gitRoot=join(root,'git');mkdirSync(gitRoot);const git=(...args)=>execFileSync('git',args,{cwd:gitRoot,encoding:'utf8'}).trim();git('init','-b','main');git('config','user.name','Synthetic author');git('config','user.email','fixture@example.invalid');
 const source=readFileSync('.qa/workspace/short.md','utf8');
 for(let i=0;i<36;i++){const slug=i?'fixture-'+String(i).padStart(2,'0'):'fixture';const dir=join(gitRoot,'documents',slug);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'doc.md'),source.replace('Workspace fixture',`Synthetic report ${String(i).padStart(2,'0')}`));}
 git('add','.');git('commit','-m','Initial synthetic documents');const old=git('rev-parse','HEAD');
 const file=join(gitRoot,'documents/fixture/doc.md');writeFileSync(file,readFileSync(file,'utf8').replace('version: 1','version: 2')+'\nA later synthetic paragraph.\n');git('add','.');git('commit','-m','Second synthetic revision');
 const appPort=await port(),workerPort=await port();const secret=randomBytes(32).toString('hex'),key=randomBytes(32).toString('hex');
 // Allowlist environment: never pass inherited provider credentials to fixture.
 const env={PATH:process.env.PATH,HOME:process.env.HOME,DYLD_FALLBACK_LIBRARY_PATH:process.env.DYLD_FALLBACK_LIBRARY_PATH||'/opt/homebrew/lib',NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',AUTH_SECRET:secret,DOCGENT_UNIFIED_WORKSPACE:unified?'1':'0',DOCGENT_TEST_GIT:gitRoot,DOCGENT_RENDER_URL:`http://127.0.0.1:${workerPort}`,DOCGENT_API_KEY:key,DOCGENT_PIPELINE_DIR:join(repo,'apps/render-worker/pipeline')};
 const worker=spawn(join(repo,'.venv/bin/python'),['-m','flask','--app','server:app','run','--host','127.0.0.1','--port',String(workerPort)],{cwd:join(repo,'apps/render-worker'),env,stdio:['ignore',openSync(join(root,'worker.log'),'w'),openSync(join(root,'worker-errors.log'),'w')]});
 const app=spawn(process.execPath,[join(repo,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(appPort)],{cwd:studio,env,stdio:['ignore',openSync(join(root,'next.log'),'w'),openSync(join(root,'next-errors.log'),'w')]});
 const url=`http://127.0.0.1:${appPort}`;
 try{await ready(`http://127.0.0.1:${workerPort}/health`,worker);await ready(url+'/signin',app);}catch(e){app.kill();worker.kill();throw new Error(`${e.message}; logs: ${root}`);}
 return {url,root,gitRoot,old,git,close:async()=>{app.kill();worker.kill();},login:async(context,allowedBrands=['example'],subject='synthetic-fixture')=>{
  const token=await encode({secret,salt:'authjs.session-token',token:{sub:subject,providerAccountId:subject,name:'Synthetic author',email:'fixture@example.invalid',allowedBrands,provider:'google'},maxAge:3600});
  await context.addCookies([{name:'authjs.session-token',value:token,url,httpOnly:true,sameSite:'Lax'}]);
 }};
}
