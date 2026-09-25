import {test,expect} from '@playwright/test';
import {startNextFixture} from './next-fixture.mjs';
let server;
test.beforeAll(async()=>{test.setTimeout(120000);server=await startNextFixture();});
test.afterAll(async()=>server?.close());
test('restored icon formatting remains named and keyboard operable',async({page,context})=>{
 test.setTimeout(120000);await server.login(context);await page.goto(server.url+'/example/fixture/edit');await page.getByRole('button',{name:'Markdown',exact:true}).click();
 const toolbar=page.getByRole('toolbar',{name:'Formatting',exact:true});
 await expect(toolbar.getByRole('button',{name:'Bold — ⌘B',exact:true})).toBeVisible();
 await page.locator('.cm-content').press('ControlOrMeta+End');await page.keyboard.insertText('\nKeyboard formatting paragraph');
 const heading=toolbar.getByRole('button',{name:'H4',exact:true});await heading.focus();await heading.press('Enter');await expect(page.locator('.cm-content')).toContainText('#### Keyboard formatting paragraph');
 await page.locator('.cm-content').press('ControlOrMeta+End');await page.keyboard.insertText('\n');
 const bold=toolbar.getByRole('button',{name:'Bold — ⌘B',exact:true});await bold.focus();await bold.press('Enter');await expect(page.locator('.cm-content')).toContainText('**bold text**');
});
test('desktop context panels preserve a readable output and a separate controls row',async({page,context})=>{
 test.setTimeout(120000);await server.login(context);await page.setViewportSize({width:1440,height:1000});await page.goto(server.url+'/example/fixture/edit');
 await page.getByRole('button',{name:'Markdown',exact:true}).click();
 await page.getByRole('button',{name:'Outline',exact:true}).click();await page.getByRole('button',{name:'Comments',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'Document outline'})).toHaveCount(0);
 const output=await page.locator('.workspace-output').boundingBox();expect(output.width).toBeGreaterThanOrEqual(600);
 const title=await page.locator('.workspace-header h1').boundingBox();const tools=await page.getByRole('group',{name:'Document tools',exact:true}).boundingBox();expect(tools.y).toBeGreaterThanOrEqual(title.y+title.height);
 await page.getByRole('button',{name:'Outline',exact:true}).click();await expect(page.locator('.editor-comments-rail')).toHaveCount(0);await expect(page.getByRole('navigation',{name:'Document outline'})).toBeVisible();
});
test('full Markdown and vocabulary tools are discoverable without an Insert gate',async({page,context})=>{
 test.setTimeout(120000);await server.login(context);await page.setViewportSize({width:1440,height:1000});await page.goto(server.url+'/example/fixture/edit');
 await page.getByRole('button',{name:'Markdown',exact:true}).click();
 const formatting=page.getByRole('toolbar',{name:'Formatting',exact:true});
 await expect(formatting).toBeVisible();
 for(const name of ['P','H1','H2','H3','H4'])await expect(formatting.getByRole('button',{name,exact:true})).toBeVisible();
 await expect(page.getByRole('toolbar',{name:'Docgent vocabulary blocks',exact:true})).toBeVisible();
 await page.locator('.cm-content').press('ControlOrMeta+End');await page.keyboard.insertText('\nToolbar regression paragraph');
 await formatting.getByRole('button',{name:'H4',exact:true}).click();await expect(page.locator('.cm-content')).toContainText('#### Toolbar regression paragraph');
 await page.getByRole('button',{name:'More blocks',exact:true}).click();await expect(page.getByRole('menu')).toBeVisible();
 await page.getByRole('button',{name:'More blocks',exact:true}).click();
 await page.locator('.cm-content').press('ControlOrMeta+End');await page.keyboard.insertText('\n');
 await formatting.getByRole('button',{name:/^summary —/}).click();await expect(page.locator('.cm-content')).toContainText('::: summary');
 await formatting.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.cm-content')).not.toContainText('::: summary');
 await formatting.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('.cm-content')).toContainText('::: summary');
});
