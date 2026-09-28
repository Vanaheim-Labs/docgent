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

  await expect(page.frameLocator('iframe[title="Live preview"]').getByText('Synthetic fixture, not a customer document.')).toBeVisible();
  await expect(page.frameLocator('iframe[title="Live preview"]').locator('.cover-title')).toBeInViewport();
  await page.screenshot({path:`.qa/workspace/screenshots/${fixture}-desktop.png`});
  await page.frameLocator('iframe[title="Live preview"]').getByText('Synthetic fixture, not a customer document.').scrollIntoViewIfNeeded();
  await page.screenshot({path:`.qa/workspace/screenshots/${fixture}-desktop-body.png`});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Markdown',exact:true}).click();
  await page.getByRole('button',{name:'Preview',exact:true}).click();
  // The output pane is now the real rendered PDF, not an HTML srcDoc mirror, so
  // its internals are not scriptable. Headless Chromium reports
  // navigator.pdfViewerEnabled === false, so this environment legitimately takes
  // the download-link fallback; a browser with an inline viewer gets the iframe.
  // Assert whichever surface this browser supports, and that both carry the real
  // rendered PDF blob rather than falling back to an HTML mirror.
  const output=page.getByRole('region',{name:'Rendered PDF output'});
  await expect(output).toBeVisible();
  const inlineViewer=await page.evaluate(()=>navigator.pdfViewerEnabled===true);
  if(inlineViewer){
   const pdfFrame=page.locator('iframe[title="Rendered PDF preview"]');
   await expect(pdfFrame).toBeVisible();
   await expect(pdfFrame).toHaveAttribute('src',/^blob:/);
  }else{
   const download=output.getByRole('link',{name:/Download the rendered PDF/});
   await expect(download).toBeVisible();
   await expect(download).toHaveAttribute('href',/^blob:/);
  }
  // The pane must never reuse the left pane's HTML render.
  await expect(output.locator('iframe[title="Read-only output preview"]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:`.qa/workspace/screenshots/${fixture}-mobile.png`});
  expect(errors).toEqual([]);
 });
}
