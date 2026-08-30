# ChainMove `stellar.toml` Plan

> **Status: planning only.** ChainMove has not issued a production `CMOVE`
> asset on Stellar Mainnet. Every account, URL, and asset value below is a
> placeholder until the production-readiness checklist is complete.

This document describes how ChainMove should publish SEP-1 metadata for a
future Stellar asset. The metadata lets wallets, explorers, exchanges, and
users verify which domain claims responsibility for an issuer and understand
what its asset represents.

## Expected location

The public file must be available at the fixed, case-sensitive path:

```text
https://<canonical-domain>/.well-known/stellar.toml
```

For a Next.js deployment in this repository, the eventual static file would
normally live at:

```text
public/.well-known/stellar.toml
```

That repository path maps to `/.well-known/stellar.toml` at runtime. Do not add
the production file until ChainMove controls the canonical HTTPS domain and
has finalized the issuer accounts and reviewed metadata.

The host must:

- use a valid HTTPS certificate;
- serve the file publicly without authentication;
- allow cross-origin reads with `Access-Control-Allow-Origin: *`;
- keep `ORG_URL` on the same domain that hosts the file; and
- be set as the issuing account's `home_domain` with a Stellar
  `set_options` operation on the matching network.

Domain ownership is part of the trust link. Publishing a file on an unrelated
preview or contributor domain does not verify a ChainMove issuer.

## Testnet and Mainnet

Testnet and Mainnet have separate ledgers, accounts, issuer keys, and asset
identities. An asset is identified by both its code and issuer, so a Testnet
`CMOVE` and a Mainnet `CMOVE` are not the same asset.

| Area | Stellar Testnet | Stellar Mainnet |
| --- | --- | --- |
| Purpose | Integration testing and metadata review | Production asset discovery |
| Domain | Prefer an explicit test domain such as `testnet.<canonical-domain>` | Use the canonical production domain |
| Issuer | Testnet public key funded for testing | Reviewed production issuer public key |
| Metadata status | Mark currency metadata as `status = "test"` | Use the reviewed production status and terms |
| Account security | Disposable test accounts are acceptable | Multisig, custody, rotation, and recovery controls required |
| User claim | Clearly label all assets as test-only | Publish only after legal, security, and operational approval |

Each environment should serve its own file at its own domain's fixed
`/.well-known/stellar.toml` path. Never copy Testnet account IDs into the
Mainnet file or present Testnet issuance as production.

## Placeholder CMOVE metadata

The following example is a design template, not a deployable production file.
Angle-bracket values must be replaced with verified public information.
Private keys, secret seeds, recovery phrases, API keys, and signing material
must never appear in `stellar.toml`.

```toml
# PLANNING EXAMPLE ONLY — CMOVE IS NOT LIVE ON STELLAR MAINNET.
ACCOUNTS = ["<STELLAR_ISSUER_PUBLIC_KEY>"]

[DOCUMENTATION]
ORG_NAME = "ChainMove"
ORG_URL = "https://<canonical-domain>"
ORG_DESCRIPTION = "Mobility finance platform for vehicle ownership and driver financing."
ORG_LOGO = "https://<canonical-domain>/images/chainmove-asset-logo.png"
ORG_OFFICIAL_EMAIL = "support@<canonical-domain>"
ORG_GITHUB = "Chainmove"

[[CURRENCIES]]
code = "CMOVE"
issuer = "<STELLAR_ISSUER_PUBLIC_KEY>"
name = "ChainMove"
desc = "Placeholder metadata for a future ChainMove mobility-finance asset."
conditions = "Test metadata only. No production issuance or redemption is available."
status = "test"
display_decimals = 7
is_asset_anchored = false
image = "https://<canonical-domain>/images/chainmove-asset-logo.png"
```

The final description and conditions must accurately explain holder rights,
transfer restrictions, redemption terms, fees, and jurisdictional limits.
Do not advertise yield, ownership, redemption, anchoring, or regulatory status
unless the corresponding product and legal controls are actually live.

## Production readiness checklist

Before publishing Mainnet metadata:

- [ ] Confirm the canonical domain, HTTPS configuration, CORS header, and
      availability of `/.well-known/stellar.toml`.
- [ ] Complete legal and compliance review of the asset, holder rights,
      restrictions, jurisdictions, and public claims.
- [ ] Create separate Mainnet issuer and distribution accounts; document their
      roles without exposing any secret signing material.
- [ ] Configure issuer multisig, thresholds, custody, backup, recovery, key
      rotation, and incident-response procedures.
- [ ] Verify the Mainnet issuer public key and all other public account IDs
      independently before publication.
- [ ] Set the issuer account's `home_domain` to the exact canonical domain on
      Stellar Mainnet.
- [ ] Replace every placeholder with reviewed organization, contact, logo,
      asset, and conditions information.
- [ ] Decide whether CMOVE is anchored or regulated and add only the SEP fields
      and service endpoints that ChainMove actually supports.
- [ ] Validate TOML syntax and SEP-1 structure, then resolve the file through a
      Stellar SDK or equivalent client.
- [ ] Confirm wallets and explorers identify the asset by the intended
      `(code, issuer)` pair.
- [ ] Review cache/CDN behavior and establish an owner and process for metadata
      updates.
- [ ] Obtain final security, operations, compliance, and maintainer approval
      before announcing issuance.

## References

- [Stellar: Publish Information About an Asset](https://developers.stellar.org/docs/tokens/publishing-asset-info)
- [SEP-0001: Stellar Info File](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md)
- [Stellar network overview](https://developers.stellar.org/docs/networks)
