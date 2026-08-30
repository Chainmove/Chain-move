# TypeScript build gate

Production builds fail on TypeScript errors. `next.config.mjs` no longer sets
`typescript.ignoreBuildErrors`, so `next build` type-checks the whole project —
including the route contracts Next.js generates under `.next/types` — before it
emits any deployment artifact.

## Why the flag mattered

The codebase spans money movement, KYC, on-chain contract calls, and admin
tooling. With the flag on, a handler whose signature drifted from the framework
contract, or a service returning a shape its caller no longer expects, still
produced a green build and shipped. The type error surfaced as a runtime failure
against real user records instead of as a failed build.

Removing the flag immediately surfaced eleven such errors: every route built
with `defineRoute` declared its Next.js context argument as optional and loosely
typed, which does not satisfy the generated `RouteContext` contract. That is now
`NextRouteContext` in `lib/api/route-handler.ts`, declared exactly as the
framework passes it.

## The gate

| Stage | Command | Covers |
| --- | --- | --- |
| Local, pre-PR | `npm run typecheck` | All `.ts`/`.tsx` sources, including tests |
| CI | `npm run typecheck` | Same, deterministically (incremental cache disabled) |
| CI | `npm run typecheck:gate` | Proves the gate still rejects a type error |
| CI | `npm run build` | Sources plus generated route and page types |

`npm run typecheck` passes `--incremental false`. A stale `.tsbuildinfo` can
otherwise let a check pass by reusing an earlier result, which makes the gate
non-deterministic across machines and CI caches.

`npm run typecheck` runs before `.next/types` exists, so it cannot see the
generated route contracts. `npm run build` is the step that checks those, and it
runs on every pull request; neither step substitutes for the other.

## Verifying the gate

`npm run typecheck:gate` (`scripts/check-typecheck-gate.ts`) asserts two things:

1. `next.config.mjs` does not enable `typescript.ignoreBuildErrors` or
   `eslint.ignoreDuringBuilds`.
2. No tracked `.ts`/`.tsx` file carries a file-level `@ts-nocheck`, which would
   exempt a whole file from the gate.
3. Introducing a deliberate type error makes the typecheck fail. The script
   writes a probe file under `lib/`, runs `tsc`, requires a non-zero exit that
   names the probe, and deletes the probe again.

The third check is what keeps the gate honest: it fails if compiler strictness
or the `tsconfig.json` include list is weakened to the point where the type
error would no longer be seen.

## Suppressions

Strictness stays as configured in `tsconfig.json` (`strict: true`). Do not:

- reintroduce `typescript.ignoreBuildErrors` or `eslint.ignoreDuringBuilds`,
- add `@ts-nocheck` to a source file,
- relax a `tsconfig.json` compiler option to clear an error.

`skipLibCheck: true` remains the one standing exception. It applies only to
declaration files inside `node_modules` — third-party generated typings the
repository cannot fix — and does not weaken checking of any first-party code.

If a type is genuinely unrepresentable, narrow the suppression to the single
line with `@ts-expect-error` and a comment explaining why. `@ts-expect-error`
itself errors once the underlying problem is fixed, so the suppression cannot
outlive its reason.
