/**
 * Pure policy only: no authentication, persistence or production callers.
 * `authoritative` is an adapter assertion, NOT an unforgeable security boundary.
 * Never construct this snapshot from request JSON or cached session grants.
 * Adapters must preserve explicit-token precedence, scope resource lookup before
 * I/O, and recheck fresh authority before mutation/worker dispatch. No stale
 * snapshot detection or cancellation of in-flight work is possible here.
 */
export interface AuthoritySnapshot {
  authoritative: true;
  account: { id: string; status: 'active' | 'suspended' | 'closed' };
  workspace: {
    id: string; ownerAccountId: string; policy: 'commercial' | 'internal';
    status: 'active' | 'suspended' | 'closed';
    provisioning: 'ready' | 'provisioning' | 'provisioning_failed'; revision: number;
    createdAt?: number; trialStartedAt?: number; trialEndsAt?: number;
    entitlement: { type: 'trial' } | { type: 'paid'; status: 'active'; paidThrough: number } | { type: 'internal' };
  };
  membership: { workspaceId: string; accountId: string; role: 'owner'; status: 'active' | 'revoked' };
  /** Complete owned visual-profile inventory, not the caller's filtered list. */
  profiles: { id: string; workspaceId: string }[];
  credential?: {
    id: string; workspaceId: string; creatorAccountId: string; status: 'active' | 'revoked';
    /** Null expiry means no expiry; null profileIds means all owned profiles. */
    expiresAt: number | null; revokedAt: number | null; operations: WorkspaceOperation[]; profileIds: string[] | null;
  };
  /** Lifetime trial creates exclude only server-owned samples; never decrement on deletion.
   * Render availability is trusted metering input, not a newly chosen numeric allowance.
   * Storage accounting/enforcement is deferred; no storage or deletion action is implied.
   */
  usage: { brandCount: number; trialDocumentsCreated: number; render: 'available' | 'exhausted' };
}
export interface PolicyRequest {
  actor: { type: 'human'; accountId: string } | { type: 'agent'; accountId: string; credentialId: string };
  workspaceId: string;
  profileId?: string;
  operation: WorkspaceOperation;
}
export type DenialCode = 'workspace_forbidden' | 'authority_unavailable' | 'provisioning_failed' |
  'provisioning_pending' | 'readonly_expired' | 'trial_expired' | 'paid_expired' |
  'document_limit' | 'brand_limit' | 'render_limit' | 'final_profile';
/** Allowance is a precheck, not a reservation or an editorial/CAS approval.
 * Reservation results require atomic check-and-reserve plus external-write reconciliation.
 * output.download is retrieval ONLY: unavailable output must never trigger render.new.
 * profile export/edit covers validated visual fields, never raw control YAML or secrets.
 */
export type PolicyDecision = { allowed: true; reservation?: 'trial_document' | 'brand' | 'render' } | { allowed: false; code: DenialCode };
const deny = (code: DenialCode = 'workspace_forbidden'): PolicyDecision => ({ allowed: false, code });
const DAY = 86_400_000;
const READS = ['source.read', 'history.read', 'output.download', 'source.export', 'profile.read', 'profile.export', 'asset.read', 'metadata.read'] as const;
const WRITES = ['document.create', 'document.edit', 'document.delete', 'document.restore', 'profile.create', 'profile.edit', 'profile.delete', 'render.new', 'review.complete', 'status.change', 'credential.issue'] as const;
const RECOVERY = ['account.read', 'credential.revoke', 'billing.manage'] as const;
const OPERATIONS: readonly string[] = [...READS, ...WRITES, ...RECOVERY, 'hosted.generate'];
export type WorkspaceOperation = typeof READS[number] | typeof WRITES[number] | typeof RECOVERY[number] | 'hosted.generate';

const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
// Leave room for elapsed-day arithmetic inside the ECMAScript timestamp range.
const instant = (value: unknown): value is number => count(value) && value <= 8_640_000_000_000_000 - 44 * DAY;

function validSnapshot(s: AuthoritySnapshot, now: number): boolean {
  const w = s.workspace;
  if (!s.account || !w || !s.membership || !s.usage || !w.entitlement) return false;
  if (![s.account.id, w.id, w.ownerAccountId, s.membership.accountId, s.membership.workspaceId].every(id) ||
      !count(w.revision) || !['active', 'suspended', 'closed'].includes(s.account.status) ||
      !['commercial', 'internal'].includes(w.policy) ||
      !['active', 'suspended', 'closed'].includes(w.status) ||
      !['ready', 'provisioning', 'provisioning_failed'].includes(w.provisioning)) return false;
  if (!Array.isArray(s.profiles) || (w.provisioning === 'ready' && s.profiles.length === 0) ||
      !s.profiles.every(p => p && id(p.id) && p.workspaceId === w.id) ||
      new Set(s.profiles.map(p => p.id)).size !== s.profiles.length ||
      !count(s.usage.brandCount) || s.usage.brandCount !== s.profiles.length ||
      !count(s.usage.trialDocumentsCreated) || !['available', 'exhausted'].includes(s.usage.render)) return false;
  if (w.provisioning !== 'ready') return w.policy === 'internal' ? w.entitlement.type === 'internal' : w.entitlement.type === 'trial';
  if (!instant(w.createdAt) || w.createdAt > now) return false;
  if (w.policy === 'internal') return w.entitlement.type === 'internal';
  if (!instant(w.trialStartedAt) || !instant(w.trialEndsAt) || w.trialStartedAt !== w.createdAt ||
      w.trialEndsAt !== w.trialStartedAt + 14 * DAY) return false;
  return w.entitlement.type === 'trial' || (w.entitlement.type === 'paid' && w.entitlement.status === 'active' &&
    instant(w.entitlement.paidThrough) && w.entitlement.paidThrough >= w.createdAt);
}

/** Invalid runtime data denies, even if a TypeScript caller bypasses the types. */
export function decideWorkspaceOperation(s: AuthoritySnapshot | null, r: PolicyRequest, clock: () => number): PolicyDecision {
  try {
    if (!s || s.authoritative !== true) return deny('authority_unavailable');
    const now = clock();
    if (!instant(now) || !validSnapshot(s, now)) return deny();
    return evaluate(s, r, now);
  } catch {
    // Do not expose malformed authority, IDs, token details or clock errors.
    return deny();
  }
}

function evaluate(s: AuthoritySnapshot, r: PolicyRequest, now: number): PolicyDecision {
  if (!r || !r.actor || !id(r.workspaceId) || !id(r.actor.accountId) || !OPERATIONS.includes(r.operation) ||
      (r.profileId !== undefined && !id(r.profileId)) ||
      (['render.new', 'profile.edit', 'profile.delete'].includes(r.operation) && !r.profileId)) return deny();
  if (r.workspaceId !== s.workspace.id || r.actor.accountId !== s.account.id ||
      s.workspace.ownerAccountId !== s.account.id || s.membership.accountId !== s.account.id ||
      s.membership.workspaceId !== s.workspace.id ||
      (r.profileId !== undefined && !s.profiles.some(p => p.id === r.profileId && p.workspaceId === s.workspace.id))) return deny();
  if (s.membership.status !== 'active' || s.membership.role !== 'owner') return deny();
  if (r.actor.type === 'human' && ['account.read', 'credential.revoke'].includes(r.operation)) return { allowed: true };
  if (s.account.status !== 'active' || s.workspace.status !== 'active') return deny();
  if (s.workspace.provisioning !== 'ready') return deny(
    s.workspace.provisioning === 'provisioning_failed' ? 'provisioning_failed' : 'provisioning_pending');
  if (r.actor.type === 'agent') {
    const c = s.credential;
    if (!c || !id(c.id) || c.id !== r.actor.credentialId || c.workspaceId !== s.workspace.id ||
        c.creatorAccountId !== s.account.id || c.status !== 'active' || c.revokedAt !== null ||
        (c.expiresAt !== null && (!instant(c.expiresAt) || now >= c.expiresAt)) ||
        !Array.isArray(c.operations) || !c.operations.every(op => OPERATIONS.includes(op)) || !c.operations.includes(r.operation) ||
        (c.profileIds !== null && (!Array.isArray(c.profileIds) ||
          !c.profileIds.every(profile => id(profile) && s.profiles.some(p => p.id === profile)) ||
          !r.profileId || !c.profileIds.includes(r.profileId)))) return deny();
    if (['credential.issue', 'credential.revoke', 'billing.manage', 'account.read'].includes(r.operation)) return deny();
  } else if (r.actor.type !== 'human') return deny();
  // Preserve the ready-workspace invariant for every policy, including internal.
  // Future mutation adapters must atomically enforce this against concurrent deletes.
  if (r.operation === 'profile.delete' && s.profiles.length === 1) return deny('final_profile');
  if (s.workspace.policy === 'internal') return { allowed: true };
  if (r.operation === 'hosted.generate') return deny();
  const entitlement = s.workspace.entitlement;
  if (entitlement.type === 'paid' && entitlement.status !== 'active') return deny();
  const endsAt = entitlement.type === 'paid' ? entitlement.paidThrough : s.workspace.trialEndsAt!;
  if (!(RECOVERY as readonly string[]).includes(r.operation)) {
    if (now >= endsAt + 30 * DAY) return deny('readonly_expired');
    if (now >= endsAt && !(READS as readonly string[]).includes(r.operation)) return deny(entitlement.type === 'paid' ? 'paid_expired' : 'trial_expired');
  }
  if (r.operation === 'document.create' && entitlement.type === 'trial') {
    return s.usage.trialDocumentsCreated < 3 ? { allowed: true, reservation: 'trial_document' } : deny('document_limit');
  }
  if (r.operation === 'profile.create') {
    return s.usage.brandCount < 3 ? { allowed: true, reservation: 'brand' } : deny('brand_limit');
  }
  if (r.operation === 'render.new') {
    return s.usage.render === 'available' ? { allowed: true, reservation: 'render' } : deny('render_limit');
  }
  return { allowed: true };
}
