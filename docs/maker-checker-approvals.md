# Maker-Checker Approvals

Four-eyes approval workflow for sensitive admin operations. See
[authorization-policies.md](./authorization-policies.md) for the broader
authorization model this sits alongside.

## Why

A single admin action can directly move money, correct a ledger, or grant
another account admin privileges. This system separates the admin who
**requests** a sensitive change from the admin who **approves and executes**
it, so a compromised or mistaken single account cannot act alone.

## Gated operations

| Operation | Route | Always requires approval | Low-risk exemption (still audited) |
| --- | --- | --- | --- |
| `reconciliation.remediate` | `POST /api/admin/reconciliation/remediate` | Any action that posts, reverses, or updates a transaction | Marking a discrepancy `IGNORE` |
| `integrity.repair.apply` | `POST /api/admin/data-integrity/repair` (`action: "apply"`) | Strategies that touch a balance or funding total (`RECONCILE_WALLET_BALANCE`, `RECALCULATE_LOAN_FUNDING`, `RECALCULATE_POOL_FUNDING`, `REOPEN_OR_RECONCILE_CONTRACT`) | Structural-only repairs (e.g. `UNSET_ORPHANED_DRIVER_ID`, `SYNC_VEHICLE_STATUS`) |
| `user.role_reassign` | `PUT /api/users/[id]` (role field) | Granting or removing the `admin` role | Lateral `driver` <-> `investor` changes |

Exemption rules are code-level constants in `lib/approvals/executors.ts`, not
runtime-configurable — changing what's exempt requires an engineering PR and
review, the same as any other authorization rule. An exempt action still
creates an `ApprovalRequest` row (status `executed`) and an audit log entry,
so exemptions never bypass the audit trail; they only skip the wait for a
second approver.

## Lifecycle

```
pending --approve--> approved --(claim)--> executing --> executed
   |                                           |
   |--reject-->  rejected                      '--> execution_failed
   |--cancel--> cancelled
   |--(past expiresAt)--> expired
```

`stale` is reached from `executing` if the target resource changed since the
request was created (see Staleness below).

1. **Request.** A sensitive admin route calls `createApprovalRequest()`
   instead of executing directly. The executor for that operation type
   resolves a concrete, server-side `command` (never raw client JSON),
   builds a sanitized before/after preview, and snapshots the target's
   `resourceVersion`. Business rules are checked once here so a doomed
   request fails immediately instead of sitting in the queue.
2. **Queue.** `GET /api/admin/approvals` lists pending/decided requests;
   `GET /api/admin/approvals/[id]` returns full detail including the
   append-only decision `history`. Both are also rendered at
   `/dashboard/admin/governance`.
3. **Decide.** A **different** admin calls approve or reject
   (`POST /api/admin/approvals/[id]/approve` / `.../reject`). The requester
   cannot approve their own request (`self_approval`), an expired request
   cannot be decided (`expired`), and the requester's admin permission is
   re-checked at this point in case it was revoked while the request sat
   pending (`requester_permission_revoked`).
4. **Execute.** Approval immediately triggers execution in the same call.
   The resourceVersion is re-checked (`stale_resource`), business rules are
   re-validated a second time, and only then does the executor run the
   underlying operation (`remediateDiscrepancy`, `applyRepair`, or a role
   save) and record the resulting `resultRefs` (transaction/audit log ids).

Every status transition is a single atomic
`findOneAndUpdate({_id, status: <expected>}, ...)`. A transition that finds
no matching document (because another request already claimed it) fails with
a `conflict` error — this is what makes concurrent approvers and
duplicate/replayed approval calls safe: only one wins.

## Staleness vs. business-rule revalidation

`resourceVersion` (the target's `updatedAt` at request-creation time) is a
**secondary** safety net — a direct `updateOne`/migration script that
bypasses Mongoose timestamps could defeat it. The primary guarantee is each
executor's `revalidate()`, which re-checks the actual business precondition
(discrepancy still `unresolved`, finding not already `REPAIRED`, at least one
admin remaining) immediately before executing, regardless of whether the
version check passed.

## In-flight uniqueness

`ApprovalRequest` has a partial unique index on `(targetType, targetId)`
restricted to `pending`/`approved`/`executing`. At most one request can be
in flight against a given target at a time, so two independently-approved
requests can never race each other into the same execution.

## Idempotent execution

Both `remediateDiscrepancy` and `applyRepair` check for a transaction they
may have already posted (by gateway reference, or by
`metadata.findingFingerprint`) before creating a new one. If a prior
execution attempt partially completed and failed before the request could be
marked `executed`, re-running it reuses the existing transaction instead of
double-applying the financial change.

## Recovery

- A `pending` request past `expiresAt` is lazily flipped to `expired` the
  next time it's read or decided.
- A request stuck in `executing` for more than 5 minutes (e.g. the process
  crashed mid-execution) is lazily flipped to `execution_failed` on next
  read, so it surfaces as actionable rather than silently stuck.
- `execution_failed` and `stale` are terminal — a human reviews what
  happened and raises a fresh approval request; there is no automatic retry.

## Emergency override

An approver may pass `emergencyOverride: true` with an
`emergencyOverrideReason` of at least 30 characters when approving. This does
**not** bypass any check — self-approval, expiry, staleness, and business-rule
revalidation all still apply identically. It only adds a distinct audit
marker (`approval.emergency_override.<operation>`, written through the
tamper-evident log) and flags the record, so an urgent decision is
searchable and reviewable after the fact rather than indistinguishable from
routine ones.

## Testing

`__tests__/lib/approvals/service.test.ts` covers self-approval rejection,
stale resource version, expired requests, duplicate approval/execution,
requester permission loss, concurrent approvers, rejected/cancelled requests,
execution failure handling, low-risk exemptions, in-flight uniqueness, and
privilege-crossing vs. lateral role changes.
