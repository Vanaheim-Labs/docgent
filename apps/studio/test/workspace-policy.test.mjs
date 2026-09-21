import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-module.mjs';

const { decideWorkspaceOperation: decide } = load('lib/workspace-policy.ts');
const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);
const clock = () => START;
const denied = { allowed: false, code: 'workspace_forbidden' };
function fixture() {
  return {
    authoritative: true,
    account: { id: 'a1', status: 'active' },
    workspace: { id: 'w1', ownerAccountId: 'a1', policy: 'commercial', status: 'active', provisioning: 'ready', revision: 1,
      createdAt: START, trialStartedAt: START, trialEndsAt: START + 14 * DAY,
      entitlement: { type: 'trial' } },
    membership: { workspaceId: 'w1', accountId: 'a1', role: 'owner', status: 'active' },
    profiles: [{ id: 'p1', workspaceId: 'w1' }],
    usage: { brandCount: 1, trialDocumentsCreated: 0, render: 'available' },
  };
}
function request(operation = 'source.read') {
  return { actor: { type: 'human', accountId: 'a1' }, workspaceId: 'w1', profileId: 'p1', operation };
}

test('active owner reads only its authoritative workspace and owned profile', () => {
  assert.deepEqual(decide(fixture(), request(), clock), { allowed: true });
  for (const change of [
    r => r.workspaceId = 'w2', r => r.actor.accountId = 'a2', r => r.profileId = 'p2',
  ]) {
    const r = request(); change(r);
    assert.deepEqual(decide(fixture(), r, clock), denied);
  }
  const s = fixture(); s.profiles[0].workspaceId = 'w2';
  assert.deepEqual(decide(s, request(), clock), denied);
});

test('live revocation and incomplete provisioning override ownership', () => {
  for (const [record, field, values] of [
    ['account', 'status', ['suspended', 'closed', 'revoked']],
    ['workspace', 'status', ['suspended', 'closed']],
    ['membership', 'status', ['revoked']],
    ['membership', 'role', ['editor']],
    ['workspace', 'provisioning', ['provisioning', 'provisioning_failed']],
  ]) for (const value of values) {
    const s = fixture(); s[record][field] = value;
    assert.equal(decide(s, request(), clock).allowed, false, `${record}.${field}=${value}`);
  }
});

function agentFixture(operation = 'source.read') {
  const s = fixture();
  s.credential = { id: 'c1', workspaceId: 'w1', creatorAccountId: 'a1', status: 'active',
    expiresAt: START + DAY, revokedAt: null, operations: [operation], profileIds: ['p1'] };
  const r = request(operation); r.actor = { type: 'agent', accountId: 'a1', credentialId: 'c1' };
  return { s, r };
}

test('agents require live matching credential scope, never human privileges', () => {
  const { s, r } = agentFixture();
  assert.deepEqual(decide(s, r, clock), { allowed: true });
  for (const change of [
    s => delete s.credential, s => s.credential.id = 'c2',
    s => s.credential.workspaceId = 'w2', s => s.credential.creatorAccountId = 'a2',
    s => s.credential.status = 'revoked', s => s.credential.revokedAt = START,
    s => s.credential.expiresAt = START, s => s.credential.operations = [],
    s => s.credential.profileIds = ['p2'], s => s.account.status = 'suspended',
    s => s.membership.status = 'revoked',
  ]) { const copy = structuredClone(s); change(copy); assert.equal(decide(copy, r, clock).allowed, false); }
  for (const operation of ['credential.issue', 'credential.revoke', 'billing.manage', 'account.read']) {
    const { s, r } = agentFixture(operation);
    assert.equal(decide(s, r, clock).allowed, false, operation);
    assert.equal(decide(fixture(), request(operation), clock).allowed, true, `owner ${operation}`);
  }
  for (const operation of ['review.complete', 'status.change']) {
    const { s, r } = agentFixture(operation);
    assert.equal(decide(s, r, clock).allowed, true, `agent ${operation} now allowed`);
    assert.equal(decide(fixture(), request(operation), clock).allowed, true, `owner ${operation}`);
  }
  const narrowed = agentFixture(); delete narrowed.r.profileId;
  assert.equal(decide(narrowed.s, narrowed.r, clock).allowed, false, 'narrowed credential cannot list all profiles');
  const unlimited = agentFixture(); unlimited.s.credential.profileIds = null; delete unlimited.r.profileId;
  assert.equal(decide(unlimited.s, unlimited.r, clock).allowed, true);
  assert.equal(decide(fixture(), { ...request(), actor: { type: 'robot', accountId: 'a1' } }, clock).allowed, false);
});

const reads = ['source.read', 'history.read', 'output.download', 'source.export', 'profile.read', 'profile.export', 'asset.read', 'metadata.read'];
const writes = ['document.create', 'document.edit', 'document.delete', 'document.restore', 'profile.create', 'profile.edit', 'profile.delete', 'render.new', 'review.complete', 'status.change', 'credential.issue'];
test('trial expiry permits retrieval only until exact retention boundary', () => {
  const s = fixture();
  s.profiles.push({ id: 'p-extra', workspaceId: 'w1' }); s.usage.brandCount = 2;
  for (const op of [...reads, ...writes]) {
    assert.equal(decide(s, request(op), () => START + 14 * DAY - 1).allowed, true, `active ${op}`);
    assert.equal(decide(s, request(op), () => START + 14 * DAY).allowed, reads.includes(op), `expiry ${op}`);
    assert.equal(decide(s, request(op), () => START + 44 * DAY - 1).allowed, reads.includes(op), `readonly ${op}`);
    assert.equal(decide(s, request(op), () => START + 44 * DAY).allowed, false, `hold ${op}`);
  }
  for (const op of ['account.read', 'credential.revoke', 'billing.manage']) {
    assert.equal(decide(fixture(), request(op), () => START + 44 * DAY).allowed, true, op);
  }
  for (const op of ['unknown', 'membership.manage', 'binding.change', 'hosted.generate', 'constructor', '__proto__']) {
    assert.equal(decide(fixture(), request(op), clock).allowed, false, op);
  }
});

test('internal exemption comes only from authority and never bypasses ownership', () => {
  const internal = fixture(); internal.workspace.policy = 'internal';
  internal.profiles.push({ id: 'p-extra', workspaceId: 'w1' }); internal.usage.brandCount = 2;
  delete internal.workspace.trialStartedAt; delete internal.workspace.trialEndsAt;
  internal.workspace.entitlement = { type: 'internal' };
  for (const op of [...reads, ...writes, 'hosted.generate']) {
    assert.equal(decide(internal, request(op), () => START + 100 * DAY).allowed, true, op);
    assert.deepEqual(decide(internal, { ...request(op), workspaceId: 'w2' }, clock), denied);
  }
  const spoof = { ...request('document.edit'), kind: 'internal', policy: 'internal', email: 'owner@internal.example' };
  assert.equal(decide(fixture(), spoof, () => START + 15 * DAY).allowed, false);
  assert.equal(decide(fixture(), request('hosted.generate'), clock).allowed, false);
});

function internalAgentFixture(operation) {
  const { s, r } = agentFixture(operation);
  s.workspace.policy = 'internal'; s.workspace.entitlement = { type: 'internal' };
  delete s.workspace.trialStartedAt; delete s.workspace.trialEndsAt;
  s.credential.expiresAt = null;
  s.profiles = Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, workspaceId: 'w1' }));
  s.usage = { brandCount: 4, trialDocumentsCreated: 99, render: 'exhausted' };
  return { s, r };
}

for (const operation of [...reads, 'document.create', 'document.edit', 'profile.create', 'profile.delete', 'render.new', 'hosted.generate']) {
  test(`internal agents ignore commercial usage but retain live authority: ${operation}`, () => {
    const { s, r } = internalAgentFixture(operation);
    const later = () => START + 100 * DAY;
    assert.deepEqual(decide(s, r, later), { allowed: true });
    assert.deepEqual(decide(s, { ...r, actor: request().actor }, later), { allowed: true }, 'human also exempt');
    for (const change of [
      s => s.credential.status = 'revoked', s => s.credential.revokedAt = START,
      s => s.credential.expiresAt = later(), s => s.membership.status = 'revoked',
      s => s.account.status = 'suspended', s => s.workspace.status = 'closed',
      s => s.credential.operations = [], s => s.credential.workspaceId = 'w2',
      s => s.credential.creatorAccountId = 'a2', s => s.credential.profileIds = ['p2'],
      s => s.profiles[0].workspaceId = 'w2',
    ]) {
      const copy = structuredClone(s); change(copy);
      assert.deepEqual(decide(copy, r, later), denied);
    }
    for (const changed of [
      { ...r, workspaceId: 'w2' }, { ...r, profileId: 'p2' },
      { ...r, actor: { ...r.actor, accountId: 'a2' } },
      { ...r, actor: { ...r.actor, credentialId: 'c2' } },
    ]) assert.deepEqual(decide(s, changed, later), denied);
    const unfiltered = { ...r }; delete unfiltered.profileId;
    assert.deepEqual(decide(s, unfiltered, later), denied, 'narrowed credential requires profile scope');
  });
}

for (const operation of ['credential.issue', 'credential.revoke', 'billing.manage', 'account.read']) {
  test(`internal agents cannot acquire credential/billing/account privilege: ${operation}`, () => {
    const { s, r } = internalAgentFixture(operation);
    assert.deepEqual(decide(s, r, clock), denied, 'even explicitly scoped credential is insufficient');
    const owner = { ...r, actor: request().actor };
    assert.deepEqual(decide(s, owner, clock), { allowed: true });
    s.membership.status = 'revoked';
    assert.deepEqual(decide(s, owner, clock), denied, 'revoked owner cannot use recovery privileges');
  });
}
for (const operation of ['review.complete', 'status.change']) {
  test(`internal agents with explicit credential scope can perform: ${operation}`, () => {
    const { s, r } = internalAgentFixture(operation);
    assert.deepEqual(decide(s, r, clock), { allowed: true }, 'scoped agent allowed');
    const owner = { ...r, actor: request().actor };
    assert.deepEqual(decide(s, owner, clock), { allowed: true });
  });
}

for (const operation of ['review.complete', 'status.change']) {
  for (const policy of ['commercial', 'internal']) {
    test(`${policy} agent ${operation} requires explicit live operation scope`, () => {
      const { s, r } = policy === 'internal' ? internalAgentFixture(operation) : agentFixture(operation);
      assert.deepEqual(decide(s, r, clock), { allowed: true });
      for (const change of [
        s => s.credential.operations = [],
        s => s.credential.operations = ['document.edit'],
        s => s.credential.operations = [operation === 'review.complete' ? 'status.change' : 'review.complete'],
        s => s.credential.status = 'revoked',
        s => s.credential.expiresAt = START,
        s => s.credential.profileIds = [],
        s => s.membership.status = 'revoked',
        s => s.account.status = 'suspended',
      ]) {
        const copy = structuredClone(s); change(copy);
        assert.deepEqual(decide(copy, r, clock), denied);
      }
      assert.deepEqual(decide(s, { ...r, workspaceId: 'w2' }, clock), denied);
      if (policy === 'commercial') {
        s.credential.expiresAt = null;
        assert.deepEqual(decide(s, r, () => START + 14 * DAY), { allowed: false, code: 'trial_expired' });
      }
    });
  }
}

test('trusted active paid term replaces trial deadline without resetting trial', () => {
  const s = fixture(); s.workspace.entitlement = { type: 'paid', status: 'active', paidThrough: START + 60 * DAY };
  assert.equal(decide(s, request('document.edit'), () => START + 60 * DAY - 1).allowed, true);
  assert.equal(decide(s, request('document.edit'), () => START + 60 * DAY).allowed, false);
  assert.equal(decide(s, request(), () => START + 90 * DAY - 1).allowed, true);
  assert.equal(decide(s, request(), () => START + 90 * DAY).allowed, false);
  for (const status of ['past_due', 'cancelled', undefined]) {
    s.workspace.entitlement.status = status;
    assert.equal(decide(s, request(), clock).allowed, false, `unknown billing ${status}`);
  }
});

test('profile deletion preserves a usable ready workspace through the final-profile boundary', () => {
  for (const policy of ['trial', 'paid', 'internal']) for (const actor of ['human', 'agent']) {
    const { s, r } = agentFixture('profile.delete');
    if (actor === 'human') r.actor = request().actor;
    s.credential.profileIds = null;
    if (policy === 'paid') s.workspace.entitlement = { type: 'paid', status: 'active', paidThrough: START + DAY };
    if (policy === 'internal') {
      s.workspace.policy = 'internal'; s.workspace.entitlement = { type: 'internal' };
    }
    s.profiles.push({ id: 'p2', workspaceId: 'w1' }); s.usage.brandCount = 2;
    assert.equal(decide(s, r, clock).allowed, true, `${policy}/${actor}: two profiles`);
    // Synthetic transition only: the policy does not execute or reserve mutations.
    s.profiles = s.profiles.filter(p => p.id !== r.profileId); s.usage.brandCount = 1;
    r.profileId = 'p2';
    assert.deepEqual(decide(s, r, clock), { allowed: false, code: 'final_profile' }, `${policy}/${actor}: final profile`);
    for (const operation of ['profile.create', 'source.read', 'account.read', 'credential.revoke', 'billing.manage']) {
      const owner = { ...request(operation), profileId: 'p2' };
      assert.equal(decide(s, owner, clock).allowed, true, `${policy}: remains usable for ${operation}`);
    }
    s.profiles = []; s.usage.brandCount = 0;
    const owner = request('account.read'); delete owner.profileId;
    assert.deepEqual(decide(s, owner, clock), denied, 'corrupt empty ready snapshot remains invalid');
  }
});

test('creation quotas require reservations, never block edits or existing outputs', () => {
  for (const count of [0, 1, 2, 3, 4]) {
    const s = fixture(); s.usage.trialDocumentsCreated = count;
    const result = decide(s, request('document.create'), clock);
    assert.equal(result.allowed, count < 3, `lifetime docs ${count}`);
    if (count < 3) assert.equal(result.reservation, 'trial_document');
    assert.equal(decide(s, request('document.edit'), clock).allowed, true);
  }
  for (const count of [1, 2, 3, 4]) {
    const s = fixture(); s.usage.brandCount = count;
    s.profiles = Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, workspaceId: 'w1' }));
    assert.equal(decide(s, request('profile.create'), clock).allowed, count < 3, `profiles ${count}`);
    if (count < 3) assert.equal(decide(s, request('profile.create'), clock).reservation, 'brand');
    assert.equal(decide(s, request('profile.edit'), clock).allowed, true);
  }
  const s = fixture(); s.usage.render = 'exhausted';
  assert.deepEqual(decide(s, request('render.new'), clock), { allowed: false, code: 'render_limit' });
  for (const op of [...reads, 'document.edit']) assert.equal(decide(s, request(op), clock).allowed, true, op);
  assert.equal(decide(fixture(), request('render.new'), clock).reservation, 'render');
  const paid = fixture(); paid.workspace.entitlement = { type: 'paid', status: 'active', paidThrough: START + DAY };
  paid.usage.trialDocumentsCreated = 99;
  assert.equal(decide(paid, request('document.create'), clock).allowed, true);
  const spoof = { ...request('document.create'), sample: true };
  const full = fixture(); full.usage.trialDocumentsCreated = 3;
  assert.equal(decide(full, spoof, clock).allowed, false);
});

const corruptions = {
  'missing workspace': s => delete s.workspace,
  'missing account': s => delete s.account,
  'missing membership': s => delete s.membership,
  'missing profiles': s => delete s.profiles,
  'empty profiles': s => s.profiles = [],
  'duplicate profiles': s => s.profiles.push({ ...s.profiles[0] }),
  'mixed profile ownership': s => s.profiles.push({ id: 'p2', workspaceId: 'w2' }),
  'missing usage': s => delete s.usage,
  'unknown policy': s => s.workspace.policy = 'enterprise',
  'internal entitlement mismatch': s => s.workspace.policy = 'internal',
  'unknown entitlement': s => s.workspace.entitlement = { type: 'free' },
  'missing entitlement': s => delete s.workspace.entitlement,
  'missing start': s => delete s.workspace.trialStartedAt,
  'missing end': s => delete s.workspace.trialEndsAt,
  'NaN end': s => s.workspace.trialEndsAt = NaN,
  'infinite end': s => s.workspace.trialEndsAt = Infinity,
  'string end': s => s.workspace.trialEndsAt = String(s.workspace.trialEndsAt),
  'extended trial': s => s.workspace.trialEndsAt += 1,
  'reversed trial': s => s.workspace.trialEndsAt = START - 1,
  'creation mismatch': s => s.workspace.createdAt -= 1,
  'missing revision': s => delete s.workspace.revision,
  'fractional revision': s => s.workspace.revision = 1.5,
  'negative documents': s => s.usage.trialDocumentsCreated = -1,
  'NaN documents': s => s.usage.trialDocumentsCreated = NaN,
  'fractional brands': s => s.usage.brandCount = 1.5,
  'inconsistent brands': s => s.usage.brandCount = 2,
  'unknown render usage': s => s.usage.render = 'maybe',
  'blank matching IDs': s => { s.account.id = ''; s.workspace.ownerAccountId = ''; s.membership.accountId = ''; },
  'blank profile': s => s.profiles[0].id = '',
  'unsafe paid timestamp': s => s.workspace.entitlement = { type: 'paid', status: 'active', paidThrough: Number.MAX_SAFE_INTEGER },
  'missing paid timestamp': s => s.workspace.entitlement = { type: 'paid', status: 'active' },
};
for (const [label, change] of Object.entries(corruptions)) test(`corrupt authority denies: ${label}`, () => {
  const s = fixture(); change(s);
  assert.deepEqual(decide(s, request(), clock), denied);
});

test('corrupt requests, clocks and credentials fail closed', () => {
  for (const r of [null, {}, { ...request(), actor: null }, { ...request(), profileId: '' }, { ...request(), operation: null }]) {
    assert.deepEqual(decide(fixture(), r, clock), denied);
  }
  for (const now of [NaN, Infinity, -1, START - 1, String(START), Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(decide(fixture(), request(), () => now), denied);
  }
  assert.deepEqual(decide(fixture(), request(), () => { throw new Error('private details'); }), denied);
  for (const change of [
    c => delete c.expiresAt, c => c.expiresAt = NaN, c => c.expiresAt = 'tomorrow',
    c => delete c.revokedAt, c => c.operations = ['unknown'], c => c.operations = 'source.read',
    c => c.profileIds = ['p2'], c => c.profileIds = 'p1', c => delete c.profileIds,
  ]) {
    const { s, r } = agentFixture(); change(s.credential);
    assert.deepEqual(decide(s, r, clock), denied);
  }
  for (const op of ['render.new', 'profile.edit', 'profile.delete']) {
    const r = request(op); delete r.profileId;
    assert.deepEqual(decide(fixture(), r, clock), denied);
  }
});

test('safe owner account status remains available during provisioning and suspension', () => {
  for (const state of ['provisioning', 'provisioning_failed']) {
    const s = fixture(); s.workspace.provisioning = state;
    delete s.workspace.createdAt; delete s.workspace.trialStartedAt; delete s.workspace.trialEndsAt;
    s.profiles = []; s.usage.brandCount = 0;
    const r = request('account.read'); delete r.profileId;
    assert.deepEqual(decide(s, r, clock), { allowed: true });
    assert.equal(decide(s, { ...r, operation: 'source.read' }, clock).allowed, false);
    assert.deepEqual(decide(s, { ...r, workspaceId: 'w2' }, clock), denied);
  }
  for (const field of ['account', 'workspace']) for (const state of ['suspended', 'closed']) {
    const s = fixture(); s[field].status = state;
    for (const operation of ['account.read', 'credential.revoke']) assert.equal(decide(s, request(operation), clock).allowed, true);
    assert.equal(decide(s, request('billing.manage'), clock).allowed, false);
    assert.equal(decide(s, request(), clock).allowed, false);
  }
});

function secondFixture() {
  const s = fixture();
  s.account.id = 'a2'; s.workspace.id = 'w2'; s.workspace.ownerAccountId = 'a2';
  s.membership.accountId = 'a2'; s.membership.workspaceId = 'w2';
  s.profiles = [{ id: 'p2', workspaceId: 'w2' }];
  return s;
}
for (const operation of [...reads, ...writes, 'credential.revoke', 'billing.manage', 'account.read']) {
  test(`two unrelated workspaces isolate ${operation}`, () => {
    const a = fixture(); const b = secondFixture();
    for (const s of [a, b]) {
      s.profiles.push({ id: `${s.workspace.id}-extra`, workspaceId: s.workspace.id }); s.usage.brandCount = 2;
    }
    const ra = request(operation);
    const rb = { ...request(operation), actor: { type: 'human', accountId: 'a2' }, workspaceId: 'w2', profileId: 'p2' };
    assert.equal(decide(a, ra, clock).allowed, true);
    assert.equal(decide(b, rb, clock).allowed, true);
    assert.deepEqual(decide(a, rb, clock), denied);
    assert.deepEqual(decide(b, ra, clock), denied);
    assert.deepEqual(decide(a, { ...ra, profileId: 'p2' }, clock), denied);
    assert.deepEqual(decide(b, { ...rb, actor: ra.actor }, clock), denied);
  });
}

test('agent operation scopes also obey expiry, quotas and revocation', () => {
  for (const operation of [...reads, 'document.edit', 'document.create', 'render.new']) {
    const { s, r } = agentFixture(operation); s.credential.expiresAt = null;
    assert.equal(decide(s, r, clock).allowed, true, operation);
    assert.equal(decide(s, r, () => START + 14 * DAY).allowed, reads.includes(operation), operation);
    assert.equal(decide(s, r, () => START + 44 * DAY).allowed, false, operation);
    s.credential.status = 'revoked';
    assert.deepEqual(decide(s, r, clock), denied);
  }
  const { s, r } = agentFixture('render.new'); s.usage.render = 'exhausted';
  assert.deepEqual(decide(s, r, clock), { allowed: false, code: 'render_limit' });
  const creation = agentFixture('document.create'); creation.s.usage.trialDocumentsCreated = 3;
  assert.deepEqual(decide(creation.s, creation.r, clock), { allowed: false, code: 'document_limit' });
});

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
test('policy is mutation-free with detached privacy-safe results and one clock read', () => {
  const { s, r } = agentFixture(); const before = structuredClone({ s, r }); freeze(s); freeze(r);
  let calls = 0;
  const result = decide(s, r, () => { calls++; return START; });
  assert.deepEqual(result, { allowed: true }); assert.equal(calls, 1);
  result.allowed = false; result.secret = 'injected';
  assert.deepEqual(decide(s, r, clock), { allowed: true });
  assert.deepEqual({ s, r }, before);
  for (const bad of [null, { ...r, workspaceId: 'private-repo-and-token' }]) {
    const result = decide(s, bad, clock);
    assert.deepEqual(result, denied);
    result.code = 'tampered';
    assert.deepEqual(decide(s, bad, clock), denied);
  }
});

test('unavailable authority fails closed without reflecting caller data', () => {
  assert.deepEqual(decide(null, request(), clock), { allowed: false, code: 'authority_unavailable' });
});
