# Authorization policy inventory

All API handlers are declared in `lib/authorization/inventory.ts`. Undeclared routes fail the inventory test. Public entries are limited to authentication/bootstrap, verified provider webhooks, and disabled legacy endpoints. Every other entry declares a typed central action.

## Authorization matrix

| Action | Admin | Investor | Driver | Resource constraints |
| --- | --- | --- | --- | --- |
| `investment:read` | Any | Own only | Denied | Ownership loaded from `Investment.investorId` |
| `investment:create` | Denied | KYC approved | Denied | Principal ID is used server-side |
| `loan:read` | Any | Denied | Own only | Ownership loaded from `Loan.driverId` |
| `loan:create` | Denied | Denied | KYC approved | Principal ID overrides body IDs |
| `loan:approve` | Allowed | Denied | Denied | Only Pending/Under Review resources |
| `contract:read` | Any | Denied | Own only | `HirePurchaseContract.driverUserId` |
| `repayment:record` | Administrative workflow | Denied | Own only | Contract must be ACTIVE |
| `kyc:document:read` | Reviewer | Own only | Own only | Owner loaded by document reference |
| `kyc:review`, `admin:report` | Allowed | Denied | Denied | Admin role required |
| `wallet:read` | Any | Own only | Own only | Principal-derived query |
| `wallet:adjust` | Privileged admin/service flow | Denied | Denied | Privileged-operation flag required |

## Standard behavior

- Missing authentication returns 401.
- Role or prerequisite denial returns 403.
- Missing resources and ownership failures return the same 404 response to conceal existence.
- Denial audit records contain action, resource type, and reason only. Request bodies, emails, document references, financial values, and resource IDs are excluded.

## Migrated routes

The central layer is used by investments, loans, KYC documents, wallet summary, administrative KYC/reporting routes, and the shared authenticated route guard. The inventory documents remaining endpoints and prevents new sensitive handlers from shipping without a declared action.
