# Security Policy

ChainMove handles authentication, payments, KYC documents, internal balances, and future Stellar-backed mobility finance records. Treat security issues seriously and keep reports responsible.

## Supported branches

Security fixes should target `main` unless a maintainer asks otherwise.

## Reporting a vulnerability

Please do not open a public GitHub issue for exploitable vulnerabilities or leaked credentials. Contact the maintainer privately first:

- Email: okoyeemmanuelobiajulu@gmail.com

Include:

- a clear description of the issue
- affected file paths or routes
- steps to reproduce in a safe local/test environment
- impact and suggested fix, if known

Do not include real production credentials in reports.

## Secret handling rules

- Never commit `.env.local`, production credentials, bearer tokens, database URLs, payment provider secrets, webhook secrets, or signing material.
- Use `.env.example` placeholders for documentation.
- Keep `MONGODB_URI`, `JWT_SECRET`, `PRIVY_APP_SECRET`, `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, and `BLOB_READ_WRITE_TOKEN` on the server only.
- Client-side files may only use variables prefixed with `NEXT_PUBLIC_`.
- Contributor PR checks must use mock values and must not require maintainer credentials.
- Maintainer-only credentials such as treasury signing material, chain deployment keys, and production payment secrets should only be used in protected deployment workflows.

## Areas requiring extra review

Request maintainer review when touching:

- Privy token verification and profile sync
- session cookies and JWT signing
- admin authorization and role checks
- Paystack transaction initialization, verification, DVA provisioning, or webhooks
- KYC upload, encryption, or document access
- MongoDB models storing user, wallet, payment, or KYC data
- Stellar account linking, asset issuance, Soroban contracts, or event indexing
- CI workflows and GitHub Actions secrets

## Dependency and workflow security

- Do not use `pull_request_target` for contributor code checks.
- Do not add deployment steps to untrusted pull request workflows.
- Do not print environment variables in CI logs.
- Use testnet, sandbox, and mock services for open-source contributions.

## Current security improvement backlog

- Add a dedicated `KYC_DOCUMENT_ENCRYPTION_KEY` repository secret instead of falling back to auth/session secrets.
- Add first-class mock services for Paystack, Resend, and Stellar.
- Add tests for Paystack webhook signature validation.
- Add tests for Privy token validation and role selection.
- Add a secret scanning checklist to PR review.

## Reporting Vulnerabilities

Please do not create public GitHub issues for security vulnerabilities.

Report vulnerabilities privately to the maintainers.

Include:

- Description
- Impact
- Reproduction steps
- Suggested remediation

## Sensitive Information

Never expose:

- Production API keys
- JWT secrets
- Database credentials
- Payment provider secrets
- Stellar private keys

## Stellar Security

Stellar private keys must:

- Never be committed
- Never be stored in frontend source code
- Never be embedded in client bundles
- Never appear in screenshots or examples

Use environment variables for all secrets.

## Responsible Disclosure

Allow maintainers reasonable time to investigate and remediate before public disclosure.
