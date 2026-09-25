import {test,expect} from '@playwright/test';
import {serveFixture,complex} from './workspace-fixture.mjs';
let server;
test.beforeAll(async()=>{server=await serveFixture();});
test.afterAll(async()=>{await server.close();});
test.beforeEach(async({page})=>{
 await page.route('**/api/**',async route=>{
  if(route.request().url().endsWith('/html'))return route.fulfill({contentType:'text/html',body:'<!doctype html><p data-source-line="10">A short paragraph.</p>'});
  return route.fulfill({status:502,body:'Fixture renderer unavailable'});
 });
});
test('new document uses the existing guarded save endpoint and opens the preserved edit route',async({page})=>{
 let payload;
 await page.route('**/api/doc/example/new-fixture',async route=>{payload=route.request().postDataJSON();await route.fulfill({json:{changed:true,sha:'a'.repeat(40)}});});
 await page.goto(server.url+'/library');await page.getByRole('button',{name:'New document',exact:true}).click();
 await page.getByLabel('Document title').fill('New fixture');await page.getByLabel('Document URL name').fill('new-fixture');
 await page.getByRole('button',{name:'Create document',exact:true}).click();await expect(page).toHaveURL(/example\/new-fixture\/edit$/);
 expect(payload.baseSha).toBeUndefined();expect(payload.content).toContain('title: "New fixture"');expect(payload.content).toContain('status: draft');
});
test('library filters use metadata and survive opening a document and returning',async({page})=>{
 await page.goto(server.url+'/library');
 await page.getByRole('searchbox',{name:'Search documents'}).fill('Useful description');
 await expect(page.getByRole('link',{name:/Alpha report/})).toBeVisible();await expect(page.getByRole('link',{name:/Beta memo/})).toHaveCount(0);
 await page.getByLabel('Document type').selectOption('report');await page.getByLabel('Status filter').selectOption('draft');await page.getByLabel('Brand filter').selectOption('example');
 await page.getByRole('link',{name:/Alpha report/}).click();
 await page.goBack();
 await expect(page.getByRole('searchbox',{name:'Search documents'})).toHaveValue('Useful description');await expect(page.getByLabel('Document type')).toHaveValue('report');
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page.getByRole('link',{name:/Beta memo/})).toBeVisible();
 await page.getByLabel('Sort documents').selectOption('title-az');expect(await page.locator('.queue-row-title').allTextContents()).toEqual(['Alpha report','Beta memo']);
});
test('context controls expose details and comments without legacy export or a wall of insert blocks',async({page})=>{
 await page.goto(server.url);
 await expect(page.getByRole('button',{name:'Export ↓',exact:true})).not.toBeVisible();
 await page.getByRole('button',{name:'Details',exact:true}).click();await expect(page.getByRole('complementary',{name:'Details panel'})).toContainText('example');
 await page.getByRole('button',{name:'Comments',exact:true}).click();await expect(page.getByText('No open comments.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'+ Add',exact:true})).not.toBeVisible();
 await page.getByRole('button',{name:'Editor only',exact:true}).click();
 await page.getByRole('button',{name:'Insert',exact:true}).click();
 await expect(page.getByRole('toolbar',{name:'Docgent vocabulary blocks'})).toBeVisible();
});
test('visual mode refuses lossy edits to formatted or complex blocks and leaves source byte-equivalent',async({page})=>{
 await page.route('**/api/preview/**/html',route=>route.fulfill({contentType:'text/html',body:'<p data-source-line="20">Keep <strong>formatting</strong> intact.</p>'}));
 await page.goto(server.url);await page.getByRole('button',{name:'Editor only',exact:true}).click();
 const paragraph=page.frameLocator('iframe[title="Live preview"]').getByText('Keep formatting intact.');
 await paragraph.click();
 await expect(page.getByRole('status',{name:'Visual editing notice'})).toContainText('Source');
 await expect(paragraph).not.toHaveAttribute('contenteditable','true');
 await page.getByRole('button',{name:'Source',exact:true}).click();
 expect((await page.locator('.cm-line').allTextContents()).join('\n').trim()).toBe(complex.trim());
});
test('history preview is read-only and returning to latest preserves the current draft',async({page})=>{
 await page.goto(server.url);await page.getByRole('button',{name:'Source',exact:true}).click();await page.getByRole('button',{name:'Editor only',exact:true}).click();
 await page.locator('.cm-content').press('ControlOrMeta+End');await page.keyboard.type(' Keep while viewing history');
 await page.getByRole('button',{name:'History',exact:true}).click();
 await expect(page.getByText('Add initial table',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'View',exact:true}).last().click();
 await expect(page.getByRole('status',{name:'Historical revision'})).toContainText('ddddddd');
 await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Return to latest',exact:true}).click();
 await page.getByRole('button',{name:'Editor only',exact:true}).click();
 await expect(page.locator('.cm-content')).toContainText('Keep while viewing history');
 await page.getByRole('button',{name:'Compare',exact:true}).click();
 await expect(page.getByText('Comparison failed',{exact:false})).toBeVisible();
});
test('overlapping save shortcuts serialize writes and retain edits typed during a save',async({page})=>{
 const writes=[];let release;
 const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/doc/**',async route=>{writes.push(route.request().postDataJSON());if(writes.length===1)await gate;await route.fulfill({json:{sha:'c'.repeat(40),revision:'a'.repeat(40)}});});
 await page.goto(server.url);await page.getByRole('button',{name:'Source',exact:true}).click();await page.getByRole('button',{name:'Editor only',exact:true}).click();
 await page.locator('.cm-content').press('ControlOrMeta+End');await page.keyboard.type(' First edit');await page.keyboard.press('ControlOrMeta+s');
 await expect.poll(()=>writes.length).toBe(1);
 await page.keyboard.type(' During save');await page.keyboard.press('ControlOrMeta+s');
 await page.waitForTimeout(100);expect(writes.length).toBe(1);release();
 await expect.poll(()=>writes.length,{timeout:6000}).toBe(2);
 expect(writes[1].baseSha).toBe('c'.repeat(40));expect(writes[1].content).toContain('During save');
});
test('conflict inspection cannot silently adopt the latest SHA and overwrite another author',async({page})=>{
 let writes=0;
 await page.route('**/api/doc/**',async route=>{
  if(route.request().method()==='PUT'){writes++;return route.fulfill({status:409,json:{message:'Changed by another author'}});}
  return route.fulfill({json:{sha:'d'.repeat(40),content:'# Other author'}});
 });
 await page.goto(server.url);await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByRole('status',{name:'Save status'})).toContainText('Conflict');
 await page.getByRole('button',{name:'Inspect latest',exact:true}).click();
 await expect(page.getByText('# Other author',{exact:true})).toBeVisible();
 await page.keyboard.press('ControlOrMeta+s');await page.waitForTimeout(3500);
 expect(writes).toBe(1);await expect(page.getByRole('status',{name:'Save status'})).toContainText('Conflict');
});
test('save failure retains a recoverable draft across reload and never exports stale content',async({page})=>{
 let exported=false;
 await page.route('**/api/doc/**',route=>route.fulfill({status:503,json:{error:'fixture offline'}}));
 await page.route('**/api/export/**',route=>{exported=true;return route.fulfill({body:'must not happen'});});
 await page.goto(server.url);
 await page.getByRole('button',{name:'Source',exact:true}).click();await page.getByRole('button',{name:'Editor only',exact:true}).click();
 await page.locator('.cm-content').press('ControlOrMeta+End');await page.keyboard.type(' Retain my draft');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByRole('status',{name:'Save status'})).toContainText('failed');
 await page.getByRole('button',{name:'Export latest DOCX',exact:true}).click();
 await expect(page.getByRole('status',{name:'Export status'})).toContainText('failed');expect(exported).toBe(false);
 page.on('dialog',dialog=>dialog.accept());await page.reload();
 await page.getByRole('button',{name:'Recover draft',exact:true}).click();
 await page.getByRole('button',{name:'Editor only',exact:true}).click();
 await expect(page.locator('.cm-content')).toContainText('Retain my draft');
});
test('preview failures keep the last good output and retry the same draft',async({page})=>{
 let fail=false;let requests=0;
 await page.route('**/api/preview/**/html',async route=>{requests++;return route.fulfill(fail?{status:502,body:'fixture render failed'}:{contentType:'text/html',body:'<p data-source-line="12">Last good fixture</p>'});});
 await page.goto(server.url);
 await page.getByRole('button',{name:'Visual',exact:true}).click();
 await page.getByRole('button',{name:'Editor only',exact:true}).click();
 await expect(page.frameLocator('iframe[title="Live preview"]').getByText('Last good fixture')).toBeVisible();
 fail=true;
 await page.getByRole('button',{name:'Source',exact:true}).click();
 await page.locator('.cm-content').press('ControlOrMeta+End');await page.keyboard.type(' Extra');
 await expect(page.getByRole('status',{name:'Preview status'})).toContainText('failed');
 await page.getByRole('button',{name:'Visual',exact:true}).click();
 await expect(page.frameLocator('iframe[title="Live preview"]').getByText('Last good fixture')).toBeVisible();
 fail=false;const before=requests;
 await page.getByRole('button',{name:'Retry preview',exact:true}).click();
 await expect(page.getByRole('status',{name:'Preview status'})).toContainText('up to date');expect(requests).toBeGreaterThan(before);
});
test('latest export saves first and downloads only that exact saved revision',async({page})=>{
 const calls=[];const revision='a'.repeat(40);
 await page.route('**/api/doc/**',async route=>{calls.push('save');await route.fulfill({json:{sha:'c'.repeat(40),revision,commit:{sha:revision}}});});
 await page.route('**/api/export/**',async route=>{calls.push(route.request().url());await route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',headers:{'x-docgent-revision':revision},body:'explicit fixture bytes'});});
 await page.goto(server.url);
 await page.getByRole('button',{name:'Export latest DOCX',exact:true}).click();
 await expect(page.getByRole('status',{name:'Export status'})).toContainText('aaaaaaa');
 expect(calls[0]).toBe('save');expect(calls[1]).toContain(`ref=${revision}`);
});
test('desktop panes have usable minimum widths and mobile offers a single-pane toggle',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.goto(server.url);
 await page.getByRole('button',{name:'Source',exact:true}).click();
 await page.getByRole('button',{name:'Side by side',exact:true}).click();
 const source=await page.locator('.pane-source').boundingBox();
 const preview=await page.getByRole('region',{name:'Read-only output'}).boundingBox();
 expect(source.width).toBeGreaterThanOrEqual(320);expect(preview.width).toBeGreaterThanOrEqual(320);
 expect(preview.x).toBeGreaterThanOrEqual(source.x+source.width);
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('button',{name:'Show preview',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Show preview',exact:true}).click();
 await expect(page.getByRole('region',{name:'Read-only output'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement.tagName)).not.toBe('BODY');
});
test('independent modes preserve source and offer a read-only output beside either editor',async({page})=>{
 await page.goto(server.url);
 await expect(page.getByRole('button',{name:'Preview only',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Source',exact:true}).click();
 await page.getByRole('button',{name:'Side by side',exact:true}).click();
 await expect(page.locator('.cm-content')).toBeVisible();
 await expect(page.getByRole('region',{name:'Read-only output'})).toBeVisible();
 const before=await page.locator('.cm-content').innerText();
 await page.getByRole('button',{name:'Visual',exact:true}).click();
 await expect(page.getByRole('button',{name:'Side by side',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Source',exact:true}).click();
 expect(await page.locator('.cm-content').innerText()).toBe(before);
 await page.reload();
 await page.getByRole('button',{name:'Editor only',exact:true}).click();
 await expect(page.getByRole('button',{name:'Source',exact:true})).toHaveAttribute('aria-pressed','true');
});
