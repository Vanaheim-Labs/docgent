import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';
import {serveFixture} from './workspace-fixture.mjs';
let server;
test.beforeAll(async()=>{server=await serveFixture();mkdirSync('.qa/workspace/screenshots',{recursive:true});});
test.afterAll(async()=>{await server.close();});
for(const fixture of ['short','long','complex']){
 test(`${fixture}: actual locally rendered output in desktop and mobile workspace`,async({page})=>{
  // These are real worker artifacts, not fabricated HTML/PDF. API transport is
  // intercepted to keep synthetic UI tests isolated from customer repositories.
  const html=readFileSync(`.qa/workspace/${fixture}.html`);
  const pdf=readFileSync(`.qa/workspace/${fixture}.pdf`);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill(route.request().url().endsWith('/html')?{contentType:'text/html',body:html}:{contentType:'application/pdf',body:pdf}));
  await page.setViewportSize({width:1440,height:1000});await page.goto(server.url);
  await page.getByRole('button',{name:'Editor only',exact:true}).click();
  await expect(page.frameLocator('iframe[title="Live preview"]').getByText('Synthetic fixture, not a customer document.')).toBeVisible();
  await page.screenshot({path:`.qa/workspace/screenshots/${fixture}-desktop.png`});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Source',exact:true}).click();await page.getByRole('button',{name:'Side by side',exact:true}).click();
  await page.getByRole('button',{name:'Show preview',exact:true}).click();
  await expect(page.getByRole('region',{name:'Read-only output'})).toBeVisible();
  await expect(page.frameLocator('iframe[title="Read-only output preview"]').getByText('Synthetic fixture, not a customer document.')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:`.qa/workspace/screenshots/${fixture}-mobile.png`});
  expect(errors).toEqual([]);
 });
}
