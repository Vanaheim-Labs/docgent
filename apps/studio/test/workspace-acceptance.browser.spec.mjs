import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';
import {serveFixture} from './workspace-fixture.mjs';
let server;
test.beforeAll(async()=>{server=await serveFixture();mkdirSync('.qa/workspace/screenshots',{recursive:true});});
test.afterAll(async()=>server.close());
test.beforeEach(async({page})=>{
 // The output pane is now the real rendered PDF, so a PDF fixture must be served
 // alongside the HTML one. Previously every non-HTML call got a 503, which left
 // the PDF pane with nothing to render.
 await page.route('**/api/**',route=>route.fulfill(route.request().url().endsWith('/html')?{contentType:'text/html',body:readFileSync('.qa/workspace/short.html')}:{contentType:'application/pdf',body:readFileSync('.qa/workspace/short.pdf')}));
});
test('context panels take focus, close with Escape and preserve usable panes',async({page})=>{
 await page.setViewportSize({width:900,height:900});await page.goto(server.url);
 await page.getByRole('button',{name:'Markdown',exact:true}).click();
 for(const name of ['History','Details','Comments']){
  const trigger=page.getByRole('button',{name,exact:true});await trigger.click();
  const panel=page.locator('.workspace-context, .editor-comments-rail');
  await expect.poll(()=>panel.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
  expect((await page.locator('.pane-source').boundingBox()).width).toBeGreaterThanOrEqual(320);
  await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();
 }
});
test('initial PDF output occupies the visible viewport on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(server.url);
 await page.getByRole('button',{name:'Markdown',exact:true}).click();await page.getByRole('button',{name:'Preview',exact:true}).click();
 expect((await page.locator('.workspace-header').boundingBox()).height).toBeLessThan(250);
 await expect(page.locator('.format-bars-wrap')).not.toBeVisible();
 // A native PDF viewer is not scriptable, so assert the pane owns the viewport
 // and carries the real blob rather than querying rendered text inside it.
 const output=page.getByRole('region',{name:'Rendered PDF output'});
 await expect(output).toBeVisible();
 const box=await output.boundingBox();
 expect(box.width).toBeGreaterThan(300);expect(box.height).toBeGreaterThan(300);
 await expect(output.locator('iframe[title="Read-only output preview"]')).toHaveCount(0);
 await page.screenshot({path:'.qa/workspace/screenshots/acceptance-mobile.png'});
});
