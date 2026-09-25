import {test,expect} from '@playwright/test';
import {serveFixture,complex} from './workspace-fixture.mjs';
let server;
test.beforeAll(async()=>{server=await serveFixture();});
test.afterAll(async()=>server.close());
test.beforeEach(async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({status:502,body:'Synthetic unavailable'}));
 await page.route('**/api/doc/**',r=>r.fulfill({json:{content:complex,sha:'b'.repeat(40)}}));
});
async function propose(page){
 await page.route('**/api/rewrite/example/fixture',r=>r.fulfill({json:r.request().method()==='GET'?{models:[{id:'fixture',label:'Synthetic',provider:'openai'}]}:{baseSha:'b'.repeat(40),scope:{kind:'section',heading:'Summary'},instruction:'Tighten',model:{id:'fixture',label:'Synthetic',provider:'openai'},span:{start:0,end:1},before:complex,after:complex+' Changed',proposed:complex+' Changed',diagnostics:[],valid:true}}));
 await page.goto(server.url);await page.getByRole('button',{name:'Outline',exact:true}).click();await page.getByRole('button',{name:'Direct a rewrite of Summary',exact:true}).click();await page.getByPlaceholder('Tighten this.',{exact:false}).fill('Tighten');await page.getByRole('button',{name:'Rewrite',exact:true}).click();await expect(page.getByRole('button',{name:'Accept',exact:true})).toBeVisible();
}
test('pending proposal is invalidated on read-only transition and never returns',async({page})=>{
 await propose(page);await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('link',{name:'View',exact:true}).last().click();
 await expect(page.getByRole('button',{name:'Accept',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Return to latest',exact:true}).click();await expect(page.getByRole('button',{name:'Accept',exact:true})).toHaveCount(0);
});
test('in-flight acceptance cannot show success or overwrite a retained draft after history transition',async({page})=>{
 let release,requested=false;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/rewrite/**/accept',async r=>{requested=true;await gate;await r.fulfill({json:{sha:'c'.repeat(40),commit:{sha:'e'.repeat(40)}}}).catch(()=>{});});
 await propose(page);await page.getByRole('button',{name:'Accept',exact:true}).click();await expect.poll(()=>requested).toBe(true);
 await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('link',{name:'View',exact:true}).last().click();release();
 await expect(page.locator('.proposal-overlay')).toHaveCount(0);await expect(page.getByText('Accepted —',{exact:false})).toHaveCount(0);
 await expect(page.getByRole('status',{name:'Save status'})).toContainText('Conflict');
 await page.getByRole('button',{name:'Return to latest',exact:true}).click();await page.getByRole('button',{name:'Markdown',exact:true}).click();expect((await page.locator('.cm-line').allTextContents()).join('\n').trim()).toBe(complex.trim());
});
test('ProposalReview independently refuses acceptance without mutation capability',async({page})=>{
 let writes=0;await page.route('**/api/rewrite/**/accept',r=>{writes++;return r.fulfill({json:{sha:'c'.repeat(40)}});});
 await propose(page);await page.evaluate(()=>{const proposal={baseSha:null,scope:{kind:'section',heading:'Summary'},instruction:'Synthetic',model:{id:'fixture',label:'Synthetic'},span:{start:0,end:1},before:'Before',after:'After',proposed:'After',diagnostics:[],valid:true};window.fixtureReview(proposal,false);});
 await expect(page.getByRole('button',{name:'Accept',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Accept',exact:true}).evaluate(button=>button.click());expect(writes).toBe(0);expect(await page.evaluate(()=>window.accepted)).toBeUndefined();
});
test('comparison responses cannot reappear under a newly selected revision',async({page})=>{
 let release;const gate=new Promise(resolve=>release=resolve);let requested=false;
 await page.route('**/api/diff/**',async r=>{requested=true;await gate;await r.fulfill({status:502,body:'Old comparison failure'});});
 await page.goto(server.url);await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('button',{name:'Compare',exact:true}).click();await expect.poll(()=>requested).toBe(true);await page.getByRole('link',{name:'View',exact:true}).last().click();release();await expect(page.getByText('Comparison failed.',{exact:false})).toHaveCount(0);await expect(page.locator('.diff-view')).toHaveCount(0);
});
test('historical selection cannot apply a pending recovery buffer',async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('docgent.draft:synthetic-fixture:example/fixture',JSON.stringify({content:'# Private recovery',baseSha:'b'.repeat(40)})));
 await page.goto(server.url);await expect(page.getByRole('button',{name:'Recover draft',exact:true})).toBeVisible();await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('link',{name:'View',exact:true}).last().click();await expect(page.getByRole('button',{name:'Recover draft',exact:true})).toBeDisabled();
});
test('read-only outline retains navigation but cannot strike reorder or rewrite',async({page})=>{
 let writes=0;page.on('request',r=>{if(['POST','PUT'].includes(r.method())&&!r.url().includes('/preview/'))writes++;});
 await page.goto(server.url);await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('link',{name:'View',exact:true}).last().click();await page.getByRole('button',{name:'Outline',exact:true}).click();
 await expect(page.getByRole('button',{name:'Summary',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'Strike Summary',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Direct a rewrite of Summary',exact:true})).toBeDisabled();
 await expect(page.locator('.outline-row').first()).toHaveAttribute('draggable','false');
 await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('link',{name:'View',exact:true}).last().click();
 await page.getByRole('button',{name:'Outline',exact:true}).click();
 await expect(page.getByRole('button',{name:'Strike Summary',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Direct a rewrite of Summary',exact:true})).toBeDisabled();
 await page.keyboard.press('ControlOrMeta+s');await page.waitForTimeout(3200);expect(writes).toBe(0);
 await page.getByRole('button',{name:'Return to latest',exact:true}).click();await page.getByRole('button',{name:'Markdown',exact:true}).click();
 expect((await page.locator('.cm-line').allTextContents()).join('\n').trim()).toBe(complex.trim());
});
