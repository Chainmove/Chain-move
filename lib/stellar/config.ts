export function getStellarConfig() {
  return {
    network: process.env.STELLAR_NETWORK || "testnet",
    horizonUrl: process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org",
    rpcUrl: process.env.STELLAR_RPC_URL || process.env.RPC_URL || "https://soroban-testnet.stellar.org",
    assetCode: process.env.STELLAR_ASSET_CODE || "CMOVE",
    issuerPublicKey: process.env.STELLAR_ISSUER_PUBLIC_KEY || "",
    distributionPublicKey: process.env.STELLAR_DISTRIBUTION_PUBLIC_KEY || "",
    contractId: process.env.STELLAR_CONTRACT_ID || process.env.CHAINMOVE_CA || "",
    mock: process.env.ENABLE_MOCK_STELLAR === "true",
  }
}
