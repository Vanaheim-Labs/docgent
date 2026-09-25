import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {startNextFixture} from './next-fixture.mjs';
let server;
test.beforeAll(async()=>{test.setTimeout(120000);server=await startNextFixture();});
test.afterAll(async()=>server?.close());
test('dirty Next Back, Forward and reload require confirmation and retain the draft',async({page,context})=>{
 test.setTimeout(120000);await server.login(context);await page.goto(server.url);
 await page.getByRole('link',{name:/Synthetic report 00/}).click();
 await page.getByRole('button',{name:'Source',exact:true}).click();await page.getByRole('button',{name:'Editor only',exact:true}).click();
 // A same-document forward destination exists, just as with Next list navigation.
 await page.evaluate(()=>{history.pushState({...history.state},'',location.href+'?context=next');history.back();});
 await expect(page).not.toHaveURL(/context=next/);
 await page.locator('.cm-content').press('ControlOrMeta+End');await page.keyboard.insertText('\n\n::unknownfixture{}\nKeep this unsaved draft.');
 const dialogs=[];page.on('dialog',async d=>{dialogs.push(d.type());await d.dismiss();});
 await page.evaluate(()=>history.back());
 await expect.poll(()=>dialogs.length).toBe(1);
 await expect(page.locator('.cm-content')).toContainText('Keep this unsaved draft.');
 await page.evaluate(()=>history.forward());await expect.poll(()=>dialogs.length).toBe(2);
 await page.reload({timeout:3000}).catch(()=>{});await expect.poll(()=>dialogs.length).toBe(3);
 await expect(page.locator('.cm-content')).toContainText('Keep this unsaved draft.');
});
test('Documents returns to the same query, filters and scroll position',async({page,context})=>{
 test.setTimeout(120000);await server.login(context);await page.setViewportSize({width:1200,height:650});await page.goto(server.url+'/?bucket=in-progress');
 await page.getByRole('searchbox',{name:'Search documents'}).fill('Synthetic');
 const target=page.getByRole('link',{name:/Synthetic report 25/});await target.scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>({window:scrollY,content:document.querySelector('.content').scrollTop}));expect(before.window+before.content).toBeGreaterThan(100);
 await target.click();await page.getByRole('link',{name:'Documents',exact:true}).click();
 await expect(page).toHaveURL(/\?bucket=in-progress$/);
 await expect(page.getByRole('searchbox',{name:'Search documents'})).toHaveValue('Synthetic');
 await expect.poll(()=>page.evaluate(()=>scrollY+document.querySelector('.content').scrollTop)).toBeGreaterThan(100);
});
test('restore appends a real Git revision and never discards a pending draft',async({page,context})=>{
 test.setTimeout(120000);await server.login(context);await page.goto(server.url+'/example/fixture');
 await page.getByRole('button',{name:'Source',exact:true}).click();await page.getByRole('button',{name:'Editor only',exact:true}).click();
 await expect(page.locator('.cm-content')).toContainText('Synthetic fixture');
 await page.locator('.cm-content').press('ControlOrMeta+End');await page.keyboard.insertText('\n\n::unknownfixture{}\nRestore must retain me.');
 await expect(page.getByRole('status',{name:'Save status'})).toContainText('Unsaved');
 await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('button',{name:/Show 1 more/}).click();await expect(page.getByRole('button',{name:'Restore',exact:true})).toBeDisabled();
 await page.getByRole('link',{name:'View',exact:true}).last().click();
 await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Restore',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Return to latest',exact:true}).click();await page.getByRole('button',{name:'Editor only',exact:true}).click();await expect(page.locator('.cm-content')).toContainText('Restore must retain me.');
 page.on('dialog',d=>d.accept());await page.reload();await expect(page.getByRole('button',{name:'Recover draft',exact:true})).toBeVisible();
 // Keep the recoverable draft pending while restoring saved content.
 const before=Number(server.git('rev-list','--count','HEAD'));
 await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('button',{name:/Show 1 more/}).click();await page.getByRole('button',{name:'Restore',exact:true}).click();
 await expect.poll(()=>Number(server.git('rev-list','--count','HEAD'))).toBe(before+1);
 await expect(page.getByRole('button',{name:'Recover draft',exact:true})).toBeVisible();
 const saved=server.git('show','HEAD:documents/fixture/doc.md');expect(saved).toContain('version: 3');expect(saved).not.toContain('A later synthetic paragraph.');expect(server.git('log','-1','--format=%B')).toContain('Restored-From: '+server.old);
 await page.getByRole('button',{name:'Recover draft',exact:true}).click();await page.getByRole('button',{name:'Editor only',exact:true}).click();await expect(page.locator('.cm-content')).toContainText('Restore must retain me.');await expect(page.getByRole('status',{name:'Save status'})).toContainText('Conflict');
});
test('comments persist through real saves while historical and unrelated-brand views cannot mutate',async({page,context})=>{
 test.setTimeout(120000);await server.login(context);await page.goto(server.url+'/example/fixture-01/edit');
 await page.getByRole('button',{name:'Comments',exact:true}).click();await page.getByRole('button',{name:'+ Add',exact:true}).click();
 await page.getByPlaceholder('Add a comment or instruction for agents…').fill('Synthetic review comment');await page.getByRole('button',{name:'Add ⌘⏎',exact:true}).click();
 await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('status',{name:'Save status'})).toHaveText('Saved');
 expect(server.git('show','HEAD:documents/fixture-01/doc.md')).toContain('Synthetic review comment');const commentRevision=server.git('rev-parse','HEAD');
 await page.getByRole('button',{name:'✓ Resolve',exact:true}).click();await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('status',{name:'Save status'})).toHaveText('Saved');
 await page.goto(server.url+'/example/fixture-01?v='+commentRevision);await page.getByRole('button',{name:'Comments',exact:true}).click();await expect(page.locator('.comment-body').filter({hasText:'Synthetic review comment'})).toBeVisible();await expect(page.getByRole('button',{name:'+ Add',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'✓ Resolve',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
 await server.login(context,['other']);expect((await page.request.put(server.url+'/api/doc/example/fixture-01',{data:{content:'Denied'}})).ok()).toBe(false);
});
test('flag rollback excludes unified reader, editor, filters and creation',async({page,context})=>{
 test.setTimeout(120000);const legacy=await startNextFixture({unified:false});try{
  await legacy.login(context);await page.goto(legacy.url);await expect(page.getByRole('button',{name:'New document',exact:true})).toHaveCount(0);await expect(page.getByRole('searchbox',{name:'Search documents'})).toHaveCount(0);
  await page.getByRole('link',{name:/Synthetic report 00/}).click();await expect(page.locator('.doc-workspace')).toBeVisible();await expect(page.locator('.workspace-header')).toHaveCount(0);
  await page.goto(legacy.url+'/example/fixture/edit');await expect(page.locator('.editor')).toHaveAttribute('data-unified','false');await expect(page.locator('.workspace-header')).toHaveCount(0);
 }finally{await legacy.close();}
});
test('live Next renderer paints readable initial output on desktop and mobile',async({page,context})=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await server.login(context);await page.setViewportSize({width:1440,height:1000});await page.goto(server.url+'/example/fixture-02');
 await expect(page.getByRole('status',{name:'Preview status'})).toContainText('Preview up to date',{timeout:60000});
 await expect(page.frameLocator('iframe[title="Read-only output preview"]').locator('.cover-title')).toBeInViewport({timeout:60000});
 await page.screenshot({path:'.qa/workspace/screenshots/next-initial-desktop.png'});
 await page.getByRole('button',{name:'Side by side',exact:true}).click();
 await expect(page.frameLocator('iframe[title="Read-only output preview"]').locator('.cover-title')).toBeInViewport({timeout:60000});
 await page.screenshot({path:'.qa/workspace/screenshots/next-split-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Show preview',exact:true}).click();
 await expect(page.frameLocator('iframe[title="Read-only output preview"]').locator('.cover-title')).toBeInViewport();
 await page.screenshot({path:'.qa/workspace/screenshots/next-output-mobile.png'});expect(errors).toEqual([]);
});
test('real creation opens unified edit and exports the exact Git revision',async({page,context})=>{
 test.setTimeout(120000);await server.login(context);await page.goto(server.url);
 await page.getByRole('button',{name:'New document',exact:true}).click();await page.getByLabel('Document title').fill('Created synthetic report');await page.getByLabel('Document URL name').fill('created-fixture');
 await page.getByRole('button',{name:'Create document',exact:true}).click();await expect(page).toHaveURL(/example\/created-fixture\/edit$/);await expect(page.getByRole('heading',{name:'Created synthetic report'})).toBeVisible();
 expect(server.git('show','HEAD:documents/created-fixture/doc.md')).toContain('Created synthetic report');
 // The test brand uses the renderer's synthetic vanaheim skin, not customer data.
 await page.getByRole('button',{name:'Source',exact:true}).click();await expect(page.locator('.cm-content')).toContainText('Created synthetic report');
 await page.locator('.cm-content').press('ControlOrMeta+a');await page.keyboard.insertText('---\ntitle: Created synthetic report\nbrand: vanaheim\ndoctype: report\nversion: 1\ndate: 2026-09-25\nstatus: draft\n---\n\n# Summary\n\nSynthetic creation and export.\n');
 await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('status',{name:'Save status'})).toHaveText('Saved');
 const responsePromise=page.waitForResponse(r=>r.url().includes('/api/export/example/created-fixture'));
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export latest DOCX',exact:true}).click();const response=await responsePromise;expect(response.status()).toBe(200);const revision=response.headers()['x-docgent-revision'];expect(revision).toBe(server.git('rev-parse','HEAD'));expect(response.url()).toContain('ref='+revision);const download=await downloadPromise;expect(readFileSync(await download.path()).subarray(0,2).toString()).toBe('PK');
 await expect(page.getByRole('status',{name:'Export status'})).toContainText(revision.slice(0,7));
});
test('real Next traversal retains list filters and rejects unauthenticated writes',async({page,context})=>{
 test.setTimeout(120000);
 expect((await page.request.put(server.url+'/api/doc/example/fixture',{data:{content:'unauthorised'}})).status()).toBe(401);
 await server.login(context);await page.goto(server.url);
 await page.getByRole('searchbox',{name:'Search documents'}).fill('Synthetic report');
 await page.getByLabel('Document type',{exact:true}).selectOption('report');
 await page.getByRole('link',{name:/Synthetic report 00/}).click();
 await expect(page.getByRole('heading',{name:'Synthetic report 00',level:1})).toBeVisible();
 await page.getByRole('button',{name:'Source',exact:true}).click();await page.getByRole('button',{name:'Editor only',exact:true}).click();
 await expect(page.locator('.cm-content')).toContainText('Synthetic fixture, not a customer document.');
 await page.goBack();await expect(page.getByRole('searchbox',{name:'Search documents'})).toHaveValue('Synthetic report');
 await expect(page.getByLabel('Document type',{exact:true})).toHaveValue('report');
});
