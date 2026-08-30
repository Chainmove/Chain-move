import { Keypair } from "@stellar/stellar-sdk"
import { getStellarConfig } from "@/lib/stellar/config"
import type { SignerAdapter } from "./types"

export class CustodyAdapterError extends Error {}

/**
 * Testnet-only reference adapter for local development, CI, and dry-runs of
 * the approval/rotation orchestration. It never reads or persists any
 * secret: each signerId gets an ephemeral, process-local ed25519 keypair
 * generated in memory (`Keypair.random()`), so no key material can ever
 * reach an env var, log line, database document, or the repository. The
 * network is read from the shared Stellar config, not a caller-supplied
 * value, and the constructor throws unless mock testnet mode is active -
 * this adapter is structurally incapable of being wired to a mainnet
 * signer set.
 *
 * Because keys are ephemeral, this adapter cannot control a specific
 * pre-funded testnet account across process restarts. It exists to exercise
 * the custody control plane (thresholds, envelopes, rotation, audit trail)
 * end-to-end, not to move real testnet funds. Production deployments must
 * inject a real KMS/HSM/external-signer adapter (see createExternalSignerAdapter
 * below and docs/custody-signer-rotation.md).
 */
export class LocalDevSignerAdapter implements SignerAdapter {
  readonly adapterId = "local-dev"
  private readonly keypairs = new Map<string, Keypair>()

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const config = getStellarConfig(env)
    if (config.network !== "testnet" || !config.mock) {
      throw new CustodyAdapterError(
        "LocalDevSignerAdapter requires STELLAR_NETWORK=testnet and ENABLE_MOCK_STELLAR=true",
      )
    }
  }

  private keypairFor(signerId: string): Keypair {
    let keypair = this.keypairs.get(signerId)
    if (!keypair) {
      keypair = Keypair.random()
      this.keypairs.set(signerId, keypair)
    }
    return keypair
  }

  async getPublicKey(signerId: string): Promise<string> {
    return this.keypairFor(signerId).publicKey()
  }

  async sign(signerId: string, payloadHash: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/i.test(payloadHash)) {
      throw new CustodyAdapterError("sign() requires a 32-byte hex payload hash")
    }
    const keypair = this.keypairFor(signerId)
    return keypair.sign(Buffer.from(payloadHash, "hex")).toString("base64")
  }
}

/**
 * Production signer contract: a KMS, HSM, or external signer service that
 * holds key material outside the app process. The app only ever calls
 * sign()/getPublicKey() over this interface and never receives raw secrets.
 * This repo intentionally does not mandate or implement a specific vendor -
 * deployments must inject a concrete SignerAdapter implementation before
 * any mainnet custody operation can run.
 */
export function createExternalSignerAdapter(): SignerAdapter {
  throw new CustodyAdapterError(
    "CUSTODY_ADAPTER_NOT_CONFIGURED: inject a production SignerAdapter (KMS/HSM/external signer) " +
      "before performing mainnet custody operations. See docs/custody-signer-rotation.md.",
  )
}

export function createSignerAdapter(env: NodeJS.ProcessEnv = process.env): SignerAdapter {
  const config = getStellarConfig(env)
  if (config.network === "testnet" && config.mock) {
    return new LocalDevSignerAdapter(env)
  }
  return createExternalSignerAdapter()
}
