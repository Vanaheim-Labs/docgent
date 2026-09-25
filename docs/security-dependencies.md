# Dependency security remediation — local evidence

No deployment, push, secret/configuration changes or forced major upgrade. Lifecycle scripts were disabled on install; verification used the direct Next build instead of the brands-cloning prebuild.

## Narrow final dependency changes

| Dependency | Final resolution | Reason / compatibility |
|---|---|---|
| `next` | 15.5.23 → **15.5.25** | Patch update for reported security findings. React 19.0.0 satisfies its published peer range. |
| `next-auth` | 5.0.0-beta.25 → **5.0.0-beta.32** | Same beta line; published peers accept Next 15 and React 19. Resolves `@auth/core` **0.41.3**. |
| Next's `postcss` | 8.4.31 → **8.5.23** | Narrow root override `overrides.next.postcss`. Next still pins 8.4.31; normal update alone cannot remove the advisories affecting ≤8.5.22. Same PostCSS major, engines compatible, production build verified; override remains an explicit maintenance obligation until upstream changes its pin. |
| `sharp` | 0.34.5 / 0.35.3 → **0.35.4** | Normal npm update/deduplication, **no sharp override**. Next 15.5.25's published optional range is `^0.34.3 || ^0.35.4`; existing `@vercel/og` 1.0.1 accepts this version. Matching platform/libvips optional packages are retained in the lock. |
| `@vercel/og` | **1.0.1 retained** | Manifest remains `^1.0.1`; lock keeps 1.0.1/satori 0.29.0. Tested 1.0.2 during remediation introduced pinned vulnerable fflate through satori 0.33.3; rolled that unrelated package update back rather than overriding its incompatible dependency chain. |
| `fflate` | **0.7.5** | Normal update within the existing opentype dependency range after restoring OG 1.0.1. No override. |

`@auth/core` updates its own transitive jose/oauth/preact dependencies; these follow the provider's dependency declarations, not independent arbitrary overrides. Lockfile size reduction is largely deduplication of two sharp platform dependency trees, plus Auth.js changes and npm workspace placement of OG/satori. It is not removal of Linux support.

## Commands and observed results

- Inspected `npm view next@15.5.25 dependencies peerDependencies optionalDependencies --json` and the corresponding next-auth/OG metadata before finalizing changes.
- Installed exact Next/Auth.js versions using `npm install --workspace apps/studio --save-exact ... --ignore-scripts`.
- Updated sharp via npm within declared ranges. No `--force`, no incompatible sharp override, no Next 16 upgrade.
- Added the scoped PostCSS override via `npm pkg set`; `npm update postcss --ignore-scripts` was necessary because an ordinary install initially retained the old invalid locked resolution. Final `npm ls` resolved PostCSS 8.5.23 correctly.
- After restoring OG 1.0.1 and updating fflate, `npm audit --omit=dev` reported **0 vulnerabilities**.
- `npm ci --ignore-scripts`: **success**, 65 packages added, 71 audited, zero vulnerabilities. This confirms the final lock is reproducible locally, rather than relying on stale node_modules.
- After clean install, `npm test`: **80 passed, 0 failed, 0 skipped**.
- `npm exec --workspace apps/studio -- next build`: **success**, Next 15.5.25, compilation, lint/types, static generation and traces.
- Final `npm audit --omit=dev`: **found 0 vulnerabilities**; `git diff --check`: success.

## Auth regression evidence

`apps/studio/test/auth-regression.test.mjs` exercises actual `authorizeRequest` code, not a stubbed authorization result. First run had 2 expected failures: malformed bearer with embedded spaces could reach validation; a thrown session-provider error escaped. Both were fixed with strict bearer syntax and safe denial on auth-provider failure. The already-safe invalid-token/ambient-session case also passes. Existing exact-SHA review, brand authorization, explicit credential precedence, source-preview and sign-in callback tests still pass on the new dependency graph.

These are boundary tests with synthetic credentials and a substituted session provider. They do not exercise Google, real cookies, signing keys, remote token storage or a deployed Next/Auth.js request pipeline. Real authorized staging sign-in and independent review remain deployment gates. A clean audit reports known dependency advisories at this run, not proof of complete application security.
