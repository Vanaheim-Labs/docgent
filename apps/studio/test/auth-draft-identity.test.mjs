import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './load-module.mjs';

function callbacks() {
  let config;
  load('auth.ts', {
    'next-auth': {default: options => { config = options; return {}; }},
    'next-auth/providers/google': {default: options => options},
    '@/lib/store': {brandsForEmail: () => [{id: 'example'}]},
  });
  return config.callbacks;
}
async function signIn(auth, sub, providerAccountId, provider = 'google') {
  return auth.jwt({token: {sub, email: 'fixture@example.invalid'},
    account: {provider, providerAccountId}, profile: {email: 'fixture@example.invalid'}});
}
async function owner(auth, token) {
  return (await auth.session({session: {user: {}}, token})).user.draftOwner;
}

test('draft owner survives fresh sign-ins with different Auth.js subjects', async () => {
  const auth = callbacks();
  const first = await signIn(auth, 'login-uuid-one', 'stable-account');
  const second = await signIn(auth, 'login-uuid-two', 'stable-account');
  const firstOwner = await owner(auth, first);
  assert.match(firstOwner, /^[a-f0-9]{64}$/);
  assert.equal(await owner(auth, second), firstOwner);
  assert.equal(first.providerAccountId, 'stable-account');
});

test('draft owners separate accounts even with the same subject and email', async () => {
  const auth = callbacks();
  const first = await owner(auth, await signIn(auth, 'same-subject', 'account-one'));
  const second = await owner(auth, await signIn(auth, 'same-subject', 'account-two'));
  assert.notEqual(first, second);
});

test('draft owners are namespaced by provider', async () => {
  const auth = callbacks();
  const first = await owner(auth, await signIn(auth, 'same-subject', 'same-account', 'google'));
  const second = await owner(auth, await signIn(auth, 'same-subject', 'same-account', 'other'));
  assert.notEqual(first, second);
});

test('JWT refresh preserves stable identity without a fresh account or profile', async () => {
  const auth = callbacks();
  const token = await signIn(auth, 'initial-subject', 'stable-account');
  const before = await owner(auth, token);
  const refreshed = await auth.jwt({token: {...token, sub: 'changed-subject', email: 'changed@example.invalid'}});
  assert.equal(refreshed.providerAccountId, 'stable-account');
  assert.equal(await owner(auth, refreshed), before);
});

test('old tokens never derive a draft owner from subject or email', async () => {
  const auth = callbacks();
  for (const token of [
    {provider: 'google', sub: 'legacy-subject', email: 'fixture@example.invalid'},
    {provider: 'google', email: 'fixture@example.invalid'},
    {provider: 'google', providerAccountId: ''},
    {provider: 'google', providerAccountId: 123},
    {providerAccountId: 'stable-account'},
  ]) {
    const refreshed = await auth.jwt({token});
    assert.equal(await owner(auth, refreshed), undefined);
  }
});

test('missing stable identity clears any preexisting session draft owner', async () => {
  const auth = callbacks();
  const session = await auth.session({session: {user: {draftOwner: 'stale-owner'}},
    token: {provider: 'google', sub: 'legacy-subject', email: 'fixture@example.invalid'}});
  assert.equal(session.user.draftOwner, undefined);
});
