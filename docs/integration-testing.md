# Financial integration testing

## Commands

- npm run test:integration runs the deterministic financial scenario suite.
- npm test runs the faster unit/component suite and excludes integration tests.

The integration command starts a disposable, single-node MongoDB replica set. It needs no
maintainer credentials and removes the database after each scenario. The first local run may
download a MongoDB test binary; CI never uses production data.

## Architecture

The integration Vitest configuration selects a Node environment and one test file at a time so
transaction and concurrency behavior is repeatable. The setup module owns database startup,
environment defaults, cleanup, and shutdown. Scenario code invokes exported App Router handlers
with standard Request objects, then inspects the same Mongoose models used in production.

The harness contains deterministic factories for every financial aggregate, Paystack, Privy/JWKS,
Resend, and Stellar adapters with one-shot failure injection, a fetch guard that rejects every
unregistered external request, and shared wallet, capacity, deduplication, and ledger assertions.

## Fixture rules

Use .test email addresses and obviously synthetic references. Never copy API keys, real account
numbers, KYC content, access tokens, or production payloads into fixtures. Prefer fixed timestamps
and explicit transaction references. Create records through factories and override only fields
important to the scenario.

Every test starts with an empty database. Do not depend on test order or retain a document between
tests. Authentication fixtures are passed in a test-only request header consumed by the mocked
authentication boundary; route authorization and database ownership checks still execute normally.

## Debugging

Run a focused scenario with npm run test:integration -- -t "credits duplicate".

An unhandled-network error identifies the origin that needs an explicit mock adapter. Transaction
failures should be diagnosed from the scenario response plus the shared invariant that failed.
Diagnostics deliberately omit fixture secrets and raw provider payloads.

## Adding scenarios

1. Start with factories and call a real route handler through jsonRequest.
2. Inject provider behavior through ProviderHarness and include a failure case for new adapters.
3. Assert the HTTP response and persisted models.
4. Finish with shared invariant helpers instead of duplicating balance arithmetic.
5. Confirm the scenario passes alone and in the complete integration command.
