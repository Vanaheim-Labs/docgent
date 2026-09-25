import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require('react-dom/server');
// Execute real TS modules, replacing only server I/O boundaries.
function load(file, boundaries = {}) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  }});
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    (id) => id in boundaries ? boundaries[id] : require(id), module, module.exports);
  return module.exports;
}

const meta = {
  brand: 'laurion', brandName: 'TIFIN.AI Australia', slug: 'business-plan',
  title: 'An introduction to Tifin.ai Australia Pty Ltd', doctype: 'Business plan',
  version: 'v38', date: 'September 2026', status: 'Review', classification: 'Confidential',
};

test('preview renders a labelled metadata cover, not source or a PDF', async () => {
  const { SignInPreview } = load('components/SignInPreview.tsx', {
    './SignInPreview.css': {},
    '@/lib/brand-theme': { getBrandTheme: async () => ({
      palette: { band: '#101615', accent: '#93d5b7' }, darkBand: true, logoDataUri: null,
    }) },
  });
  const html = renderToStaticMarkup(await SignInPreview({ meta: {
    ...meta, description: '::native-cover{logo=SECRET_ASSET} PRIVATE_BODY',
  }, brand: meta.brand, slug: meta.slug }));
  assert.match(html, /Cover preview/);
  assert.match(html, /Document content is available after sign-in/);
  assert.match(html, /Sign in to view document/);
  assert.match(html, /<main/);
  assert.match(html, /callbackUrl=%2Flaurion%2Fbusiness-plan/);
  assert.doesNotMatch(html, /native-cover|SECRET_|PRIVATE_|iframe|\/api\/(render|preview|thumbnail)/);
});

test('preview keeps a pinned revision in its sign-in callback', async () => {
  const { SignInPreview } = load('components/SignInPreview.tsx', {
    './SignInPreview.css': {},
    '@/lib/brand-theme': { getBrandTheme: async () => ({ palette: {}, darkBand: false }) },
  });
  const html = renderToStaticMarkup(await SignInPreview({ meta, brand: meta.brand, slug: meta.slug, commitSha: 'abc123' }));
  assert.match(html, /callbackUrl=%2Flaurion%2Fbusiness-plan%3Fv%3Dabc123/);
  const { default: DocumentPage } = load('app/[brand]/[slug]/page.tsx', {
    '@/auth': { auth: async () => null },
    'next/navigation': { notFound: () => { throw new Error('404'); } },
    'next/link': {}, '@/lib/store': {}, '@/components/UserChip': {}, '@/components/DocumentWorkspace': {},
    '@/lib/metadata': { fetchDocPreviewMeta: async () => meta },
    '@/components/SignInPreview': { SignInPreview },
  });
  const page = await DocumentPage({ params: Promise.resolve({ brand: meta.brand, slug: meta.slug }), searchParams: Promise.resolve({ v: 'abc123' }) });
  assert.equal(page.props.commitSha, 'abc123');
});

test('sign-in passes the local callback to Google and rejects external destinations', async () => {
  for (const [callbackUrl, expected] of [
    ['/laurion/business-plan?v=abc123', '/laurion/business-plan?v=abc123'],
    [undefined, '/'], ['https://evil.example', '/'], ['//evil.example', '/'],
    ['/\\\\evil.example', '/'], ['/\nevil.example', '/'],
  ]) {
    let result;
    const { default: SignIn } = load('app/signin/page.tsx', {
      '@/auth': { auth: async () => null, signIn: async (...args) => { result = args; } },
      'next/navigation': { redirect: () => { throw new Error('unexpected redirect'); } },
    });
    const tree = await SignIn({ searchParams: Promise.resolve({ callbackUrl }) });
    function findForm(node) {
      if (!node || typeof node !== 'object') return null;
      if (node.type === 'form') return node;
      return [node.props?.children].flat(Infinity).map(findForm).find(Boolean);
    }
    await findForm(tree).props.action();
    assert.deepEqual(result, ['google', { redirectTo: expected }]);
  }
});

test('preview escapes metadata and handles missing optional fields on a light brand', async () => {
  const { SignInPreview } = load('components/SignInPreview.tsx', {
    './SignInPreview.css': {},
    '@/lib/brand-theme': { getBrandTheme: async () => ({ palette: { band: '#ffffff', accent: '#000000' }, darkBand: false }) },
  });
  const html = renderToStaticMarkup(await SignInPreview({
    meta: { title: '<script>alert(1)</script>', brandName: 'Example', description: '' }, brand: 'example', slug: 'minimal',
  }));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|undefined|null|preview-details/);
  assert.match(html, /--preview-band-ink:#12161c/);
});

test('signed-in visitors return to the requested document', async () => {
  const { default: SignIn } = load('app/signin/page.tsx', {
    '@/auth': { auth: async () => ({ user: {} }) },
    'next/navigation': { redirect: (url) => { throw new Error(url); } },
  });
  await assert.rejects(SignIn({ searchParams: Promise.resolve({ callbackUrl: '/laurion/business-plan?v=abc' }) }), { message: '/laurion/business-plan?v=abc' });
});

test('document page still denies a session without access to the brand', async () => {
  let storeTouched = false;
  const { default: DocumentPage } = load('app/[brand]/[slug]/page.tsx', {
    '@/auth': { auth: async () => ({ user: { allowedBrands: ['other'] } }) },
    'next/navigation': { notFound: () => { throw new Error('404'); } },
    'next/link': {}, '@/lib/store': { storesFor: () => { storeTouched = true; } },
    '@/components/UserChip': {}, '@/components/DocumentWorkspace': {},
    '@/lib/metadata': {}, '@/components/SignInPreview': {},
  });
  await assert.rejects(DocumentPage({ params: Promise.resolve({ brand: meta.brand, slug: meta.slug }), searchParams: Promise.resolve({}) }), { message: '404' });
  assert.equal(storeTouched, false);
});

test('missing documents return no public metadata', async () => {
  for (const missingBrand of [true, false]) {
    const { fetchDocPreviewMeta } = load('lib/metadata.ts', { '@/lib/store': {
      findBrand: () => missingBrand ? null : { name: 'Example' },
      storesFor: async () => { throw new Error('not found'); },
    } });
    assert.equal(await fetchDocPreviewMeta('example', 'missing'), null);
  }
});

test('public metadata never extracts native directives, assets or protected prose', async () => {
  for (const content of [
    '::native-cover{logo="data:image/svg+xml;base64,SECRET_ASSET"}\n\nPRIVATE_BODY',
    '::: summary\nPRIVATE_SUMMARY\n:::\n\nPRIVATE_BODY',
    'PRIVATE_BODY',
  ]) {
    const { fetchDocPreviewMeta } = load('lib/metadata.ts', {
      '@/lib/store': {
        findBrand: () => ({ name: meta.brandName }),
        storesFor: async () => ({ docs: { readDocument: async () => ({ frontmatter: meta, content }) } }),
      },
    });
    const result = await fetchDocPreviewMeta(meta.brand, meta.slug);
    assert.doesNotMatch(JSON.stringify(result), /native-cover|data:image|PRIVATE_|SECRET_/);
    assert.equal(result.description, 'Business plan (Review)');
  }
});
