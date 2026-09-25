import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';
import {serveFixture} from './workspace-fixture.mjs';
let server;
test.beforeAll(async()=>{server=await serveFixture();mkdirSync('.qa/workspace/screenshots',{recursive:true});});
test.afterAll(async()=>server.close());
test.beforeEach(async({page})=>{
 await page.route('**/api/**',route=>route.fulfill(route.request().url().endsWith('/html')?{contentType:'text/html',body:readFileSync('.qa/workspace/short.html')}:{status:503,body:'Synthetic service offline'}));
});
test('context panels take focus, close with Escape and preserve usable panes',async({page})=>{
 await page.setViewportSize({width:900,height:900});await page.goto(server.url);
 await page.getByRole('button',{name:'Source',exact:true}).click();await page.getByRole('button',{name:'Side by side',exact:true}).click();
 for(const name of ['History','Details','Comments']){
  const trigger=page.getByRole('button',{name,exact:true});await trigger.click();
  const panel=page.locator('.workspace-context, .editor-comments-rail');
  await expect.poll(()=>panel.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
  expect((await page.locator('.pane-source').boundingBox()).width).toBeGreaterThanOrEqual(320);
  await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();
 }
});
test('initial HTML output paints the cover within the visible viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(server.url);
 await page.getByRole('button',{name:'Source',exact:true}).click();await page.getByRole('button',{name:'Side by side',exact:true}).click();await page.getByRole('button',{name:'Show preview',exact:true}).click();
 expect((await page.locator('.workspace-header').boundingBox()).height).toBeLessThan(250);
 await expect(page.locator('.workspace-format')).not.toBeVisible();
 const frame=page.frameLocator('iframe[title="Read-only output preview"]');
 await expect(frame.locator('.cover-title')).toBeInViewport();
 await page.screenshot({path:'.qa/workspace/screenshots/acceptance-mobile.png'});
});
