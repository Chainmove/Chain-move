import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import mongoose from "mongoose"
import StellarPoolAsset from "@/models/StellarPoolAsset"

vi.mock("@/lib/validation/stellar", () => ({
  isValidStellarPublicKey: (key: string) => {
    return typeof key === "string" && key.startsWith("G") && key.length === 56
  },
  normalizeStellarPublicKey: (key: string) => key.trim(),
}))

describe("StellarPoolAsset Model", () => {
  const validIssuerKey = "GAJVUHQV5ZBQ6XMVLXL4QHXFZVBVBXM4PEX2XCZMN7H6VWLJDP3I6YHX"
  const validDistributionKey = "GBVXSZQHQJLVH7QKGVBR2XDVJ6VJM4LKXNQVHXZBXVJ7CKZW5QJVHXZB"
  const validPoolId = new mongoose.Types.ObjectId()

  it("should create a valid stellar pool asset", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "SHUT123456",
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
      status: "draft",
      network: "testnet",
    })

    expect(asset.poolId).toEqual(validPoolId)
    expect(asset.assetCode).toBe("SHUT123456")
    expect(asset.status).toBe("draft")
    expect(asset.network).toBe("testnet")
  })

  it("should reject asset code with lowercase letters", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "shut123456",
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
    })

    const error = asset.validateSync()
    expect(error).toBeDefined()
    expect(error?.errors?.assetCode).toBeDefined()
  })

  it("should reject asset code exceeding 12 characters", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "VERYLONGCODE1",
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
    })

    const error = asset.validateSync()
    expect(error).toBeDefined()
    expect(error?.errors?.assetCode).toBeDefined()
  })

  it("should reject asset code with special characters", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "SHUT-123",
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
    })

    const error = asset.validateSync()
    expect(error).toBeDefined()
    expect(error?.errors?.assetCode).toBeDefined()
  })

  it("should reject empty asset code", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "",
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
    })

    const error = asset.validateSync()
    expect(error).toBeDefined()
    expect(error?.errors?.assetCode).toBeDefined()
  })

  it("should accept valid status values", () => {
    const statuses = ["draft", "testnet", "active", "retired"]

    statuses.forEach((status) => {
      const asset = new StellarPoolAsset({
        poolId: validPoolId,
        assetCode: "SHUT123456",
        issuerPublicKey: validIssuerKey,
        distributionPublicKey: validDistributionKey,
        status,
      })

      const error = asset.validateSync()
      expect(error).toBeUndefined()
    })
  })

  it("should reject invalid status values", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "SHUT123456",
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
      status: "invalid" as any,
    })

    const error = asset.validateSync()
    expect(error).toBeDefined()
    expect(error?.errors?.status).toBeDefined()
  })

  it("should default status to draft", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "SHUT123456",
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
    })

    expect(asset.status).toBe("draft")
  })

  it("should default network to testnet", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "SHUT123456",
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
    })

    expect(asset.network).toBe("testnet")
  })

  it("should accept optional metadata fields", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "SHUT123456",
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
      metadata: {
        name: "Shuttle Pool Asset",
        description: "Investment pool for shuttle vehicles",
        tomlUrl: "https://example.com/.well-known/stellar.toml",
        imageUrl: "https://example.com/asset-image.png",
      },
    })

    const error = asset.validateSync()
    expect(error).toBeUndefined()
    expect(asset.metadata?.name).toBe("Shuttle Pool Asset")
    expect(asset.metadata?.description).toBe("Investment pool for shuttle vehicles")
  })

  it("should accept optional contractId field", () => {
    const contractId = "CACVX2KDVVFXNMR5STFYQHVDYQLIHF4QHXQHVJQHVJQHVJQHVJQHVJQH"
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "SHUT123456",
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
      contractId,
    })

    const error = asset.validateSync()
    expect(error).toBeUndefined()
    expect(asset.contractId).toBe(contractId)
  })

  it("should require poolId field", () => {
    const asset = new StellarPoolAsset({
      assetCode: "SHUT123456",
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
    })

    const error = asset.validateSync()
    expect(error).toBeDefined()
    expect(error?.errors?.poolId).toBeDefined()
  })

  it("should require assetCode field", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
    })

    const error = asset.validateSync()
    expect(error).toBeDefined()
    expect(error?.errors?.assetCode).toBeDefined()
  })

  it("should require issuerPublicKey field", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "SHUT123456",
      distributionPublicKey: validDistributionKey,
    })

    const error = asset.validateSync()
    expect(error).toBeDefined()
    expect(error?.errors?.issuerPublicKey).toBeDefined()
  })

  it("should require distributionPublicKey field", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "SHUT123456",
      issuerPublicKey: validIssuerKey,
    })

    const error = asset.validateSync()
    expect(error).toBeDefined()
    expect(error?.errors?.distributionPublicKey).toBeDefined()
  })

  it("should convert network to lowercase", () => {
    const asset = new StellarPoolAsset({
      poolId: validPoolId,
      assetCode: "SHUT123456",
      issuerPublicKey: validIssuerKey,
      distributionPublicKey: validDistributionKey,
      network: "TESTNET",
    })

    expect(asset.network).toBe("testnet")
  })
})
