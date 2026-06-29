import { generatePoolAssetCode, validateAssetCode } from "@/lib/stellar/pool-assets"

const mockPoolId1 = "507f1f77bcf86cd799439011"
const mockPoolId2 = "507f1f77bcf86cd799439abc"
const mockIssuerKey = "GAJVUHQV5ZBQ6XMVLXL4QHXFZVBVBXM4PEX2XCZMN7H6VWLJDP3I6YHX"
const mockDistributionKey = "GBVXSZQHQJLVH7QKGVBR2XDVJ6VJM4LKXNQVHXZBXVJ7CKZW5QJVHXZB"

console.log("=== ChainMove Stellar Pool Asset Generator Demo ===\n")

console.log("Generating asset codes for vehicle investment pools:\n")

const shuttleAssetCode = generatePoolAssetCode(mockPoolId1, "SHUTTLE")
console.log(`Pool ID: ${mockPoolId1}`)
console.log(`Asset Type: SHUTTLE`)
console.log(`Generated Asset Code: ${shuttleAssetCode}`)
console.log(`Validation: ${validateAssetCode(shuttleAssetCode).valid ? "VALID" : "INVALID"}`)

console.log("\nMock Pool Asset Record:")
console.log(
  JSON.stringify(
    {
      poolId: mockPoolId1,
      assetCode: shuttleAssetCode,
      issuerPublicKey: mockIssuerKey,
      distributionPublicKey: mockDistributionKey,
      status: "draft",
      network: "testnet",
      metadata: {
        name: "SHUTTLE Investment Pool",
        description: "Fractional ownership of a shuttle vehicle",
      },
    },
    null,
    2,
  ),
)

console.log("\n" + "=".repeat(50) + "\n")

const kekeAssetCode = generatePoolAssetCode(mockPoolId2, "KEKE")
console.log(`Pool ID: ${mockPoolId2}`)
console.log(`Asset Type: KEKE`)
console.log(`Generated Asset Code: ${kekeAssetCode}`)
console.log(`Validation: ${validateAssetCode(kekeAssetCode).valid ? "VALID" : "INVALID"}`)

console.log("\nMock Pool Asset Record:")
console.log(
  JSON.stringify(
    {
      poolId: mockPoolId2,
      assetCode: kekeAssetCode,
      issuerPublicKey: mockIssuerKey,
      distributionPublicKey: mockDistributionKey,
      status: "testnet",
      network: "testnet",
      metadata: {
        name: "KEKE Investment Pool",
        description: "Fractional ownership of a keke vehicle",
      },
    },
    null,
    2,
  ),
)

console.log("\n" + "=".repeat(50) + "\n")

console.log("Asset Code Validation Examples:\n")

const testCases = [
  { code: "SHUT123456", expected: true },
  { code: "KEKE654321", expected: true },
  { code: "CMOVE", expected: true },
  { code: "shut123", expected: false },
  { code: "VERYLONGCODE1", expected: false },
  { code: "SHUT-123", expected: false },
  { code: "", expected: false },
]

testCases.forEach(({ code, expected }) => {
  const result = validateAssetCode(code)
  const status = result.valid === expected ? "✓" : "✗"
  console.log(`${status} "${code}" - ${result.valid ? "VALID" : result.error}`)
})

console.log("\n=== Demo Complete ===")
