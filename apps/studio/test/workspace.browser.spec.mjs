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
