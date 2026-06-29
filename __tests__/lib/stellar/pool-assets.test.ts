import { describe, it, expect, beforeEach, vi } from "vitest"
import mongoose from "mongoose"
import {
  generatePoolAssetCode,
  validateAssetCode,
  createPoolAsset,
  getPoolAsset,
  updatePoolAssetStatus,
  listPoolAssets,
} from "@/lib/stellar/pool-assets"
import StellarPoolAsset from "@/models/StellarPoolAsset"
import InvestmentPool from "@/models/InvestmentPool"
import * as stellarConfig from "@/lib/stellar/config"

vi.mock("@/models/StellarPoolAsset")
vi.mock("@/models/InvestmentPool")
vi.mock("@/lib/stellar/config")

describe("generatePoolAssetCode", () => {
  it("should generate valid asset code for SHUTTLE", () => {
    const poolId = "507f1f77bcf86cd799439011"
    const assetCode = generatePoolAssetCode(poolId, "SHUTTLE")

    expect(assetCode).toBe("SHUT439011")
    expect(assetCode.length).toBeLessThanOrEqual(12)
    expect(/^[A-Z0-9]+$/.test(assetCode)).toBe(true)
  })

  it("should generate valid asset code for KEKE", () => {
    const poolId = "507f1f77bcf86cd799439011"
    const assetCode = generatePoolAssetCode(poolId, "KEKE")

    expect(assetCode).toBe("KEKE439011")
    expect(assetCode.length).toBeLessThanOrEqual(12)
    expect(/^[A-Z0-9]+$/.test(assetCode)).toBe(true)
  })

  it("should throw error for invalid pool ID", () => {
    expect(() => generatePoolAssetCode("invalid", "SHUTTLE")).toThrow("Invalid pool ID format")
  })

  it("should throw error for missing pool ID", () => {
    expect(() => generatePoolAssetCode("", "SHUTTLE")).toThrow("Invalid pool ID format")
  })

  it("should generate uppercase asset code", () => {
    const poolId = "507f1f77bcf86cd799439abc"
    const assetCode = generatePoolAssetCode(poolId, "KEKE")

    expect(assetCode).toBe("KEKE9439ABC")
    expect(assetCode).toEqual(assetCode.toUpperCase())
  })
})

describe("validateAssetCode", () => {
  it("should validate correct asset code", () => {
    const result = validateAssetCode("SHUT123456")
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it("should validate asset code with only letters", () => {
    const result = validateAssetCode("SHUTTLEPOOL")
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it("should validate asset code with only numbers", () => {
    const result = validateAssetCode("123456")
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it("should reject empty asset code", () => {
    const result = validateAssetCode("")
    expect(result.valid).toBe(false)
    expect(result.error).toBe("Asset code cannot be empty")
  })

  it("should reject asset code exceeding 12 characters", () => {
    const result = validateAssetCode("VERYLONGCODE1")
    expect(result.valid).toBe(false)
    expect(result.error).toContain("must not exceed 12 characters")
  })

  it("should reject asset code with lowercase letters", () => {
    const result = validateAssetCode("ShutTle123")
    expect(result.valid).toBe(false)
    expect(result.error).toContain("only uppercase letters and numbers")
  })

  it("should reject asset code with special characters", () => {
    const result = validateAssetCode("SHUT-123")
    expect(result.valid).toBe(false)
    expect(result.error).toContain("only uppercase letters and numbers")
  })

  it("should reject asset code with spaces", () => {
    const result = validateAssetCode("SHUT 123")
    expect(result.valid).toBe(false)
    expect(result.error).toContain("only uppercase letters and numbers")
  })

  it("should reject null or undefined asset code", () => {
    const result = validateAssetCode(null as any)
    expect(result.valid).toBe(false)
    expect(result.error).toBe("Asset code is required")
  })
})

describe("createPoolAsset", () => {
  const mockPoolId = "507f1f77bcf86cd799439011"
  const mockIssuerKey = "GAJVUHQV5ZBQ6XMVLXL4QHXFZVBVBXM4PEX2XCZMN7H6VWLJDP3I6YHX"
  const mockDistributionKey = "GBVXSZQHQJLVH7QKGVBR2XDVJ6VJM4LKXNQVHXZBXVJ7CKZW5QJVHXZB"

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should create pool asset with valid inputs", async () => {
    const mockPool = {
      _id: new mongoose.Types.ObjectId(mockPoolId),
      assetType: "SHUTTLE",
      targetAmountNgn: 4600000,
    }

    const mockAsset = {
      _id: new mongoose.Types.ObjectId(),
      poolId: mockPoolId,
      assetCode: "SHUT439011",
      issuerPublicKey: mockIssuerKey,
      distributionPublicKey: mockDistributionKey,
      status: "draft",
      network: "testnet",
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject: () => ({
        _id: new mongoose.Types.ObjectId(),
        poolId: new mongoose.Types.ObjectId(mockPoolId),
        assetCode: "SHUT439011",
        issuerPublicKey: mockIssuerKey,
        distributionPublicKey: mockDistributionKey,
        status: "draft",
        network: "testnet",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    }

    vi.mocked(InvestmentPool.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockPool),
    } as any)

    vi.mocked(StellarPoolAsset.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any)

    vi.mocked(StellarPoolAsset.create).mockResolvedValue(mockAsset as any)

    vi.mocked(stellarConfig.getStellarConfig).mockReturnValue({
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      rpcUrl: "https://soroban-testnet.stellar.org",
      assetCode: "CMOVE",
      issuerPublicKey: mockIssuerKey,
      distributionPublicKey: mockDistributionKey,
      contractId: "",
      explorerBaseUrl: "https://stellar.expert/explorer/testnet",
      mock: false,
      demoPublicKey: "DEMO",
    })

    const result = await createPoolAsset({
      poolId: mockPoolId,
      issuerPublicKey: mockIssuerKey,
      distributionPublicKey: mockDistributionKey,
    })

    expect(result.assetCode).toBe("SHUT439011")
    expect(result.poolId).toBe(mockPoolId)
    expect(result.status).toBe("draft")
  })

  it("should throw error for invalid pool ID", async () => {
    await expect(createPoolAsset({ poolId: "invalid" })).rejects.toThrow("Invalid pool ID")
  })

  it("should throw error when pool not found", async () => {
    vi.mocked(InvestmentPool.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any)

    await expect(createPoolAsset({ poolId: mockPoolId })).rejects.toThrow("Pool not found")
  })

  it("should throw error when pool asset already exists", async () => {
    const mockPool = {
      _id: new mongoose.Types.ObjectId(mockPoolId),
      assetType: "KEKE",
    }

    vi.mocked(InvestmentPool.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockPool),
    } as any)

    vi.mocked(StellarPoolAsset.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({ poolId: mockPoolId }),
    } as any)

    await expect(createPoolAsset({ poolId: mockPoolId })).rejects.toThrow(
      "Pool asset already exists for this pool",
    )
  })

  it("should throw error when missing issuer public key", async () => {
    const mockPool = {
      _id: new mongoose.Types.ObjectId(mockPoolId),
      assetType: "SHUTTLE",
    }

    vi.mocked(InvestmentPool.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockPool),
    } as any)

    vi.mocked(StellarPoolAsset.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any)

    vi.mocked(stellarConfig.getStellarConfig).mockReturnValue({
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      rpcUrl: "https://soroban-testnet.stellar.org",
      assetCode: "CMOVE",
      issuerPublicKey: "",
      distributionPublicKey: mockDistributionKey,
      contractId: "",
      explorerBaseUrl: "https://stellar.expert/explorer/testnet",
      mock: false,
      demoPublicKey: "DEMO",
    })

    await expect(createPoolAsset({ poolId: mockPoolId })).rejects.toThrow(
      "Valid issuer public key is required",
    )
  })

  it("should throw error when missing distribution public key", async () => {
    const mockPool = {
      _id: new mongoose.Types.ObjectId(mockPoolId),
      assetType: "SHUTTLE",
    }

    vi.mocked(InvestmentPool.findById).mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockPool),
    } as any)

    vi.mocked(StellarPoolAsset.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any)

    vi.mocked(stellarConfig.getStellarConfig).mockReturnValue({
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      rpcUrl: "https://soroban-testnet.stellar.org",
      assetCode: "CMOVE",
      issuerPublicKey: mockIssuerKey,
      distributionPublicKey: "",
      contractId: "",
      explorerBaseUrl: "https://stellar.expert/explorer/testnet",
      mock: false,
      demoPublicKey: "DEMO",
    })

    await expect(createPoolAsset({ poolId: mockPoolId })).rejects.toThrow(
      "Valid distribution public key is required",
    )
  })
})

describe("getPoolAsset", () => {
  const mockPoolId = "507f1f77bcf86cd799439011"

  it("should return pool asset when found", async () => {
    const mockAsset = {
      _id: new mongoose.Types.ObjectId(),
      poolId: new mongoose.Types.ObjectId(mockPoolId),
      assetCode: "SHUT439011",
      issuerPublicKey: "GAJVUHQV5ZBQ6XMVLXL4QHXFZVBVBXM4PEX2XCZMN7H6VWLJDP3I6YHX",
      distributionPublicKey: "GBVXSZQHQJLVH7QKGVBR2XDVJ6VJM4LKXNQVHXZBXVJ7CKZW5QJVHXZB",
      status: "active",
      network: "testnet",
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    vi.mocked(StellarPoolAsset.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockAsset),
    } as any)

    const result = await getPoolAsset(mockPoolId)

    expect(result).not.toBeNull()
    expect(result?.assetCode).toBe("SHUT439011")
    expect(result?.status).toBe("active")
  })

  it("should return null when pool asset not found", async () => {
    vi.mocked(StellarPoolAsset.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any)

    const result = await getPoolAsset(mockPoolId)
    expect(result).toBeNull()
  })

  it("should throw error for invalid pool ID", async () => {
    await expect(getPoolAsset("invalid")).rejects.toThrow("Invalid pool ID")
  })
})

describe("updatePoolAssetStatus", () => {
  const mockPoolId = "507f1f77bcf86cd799439011"

  it("should update pool asset status successfully", async () => {
    const mockAsset = {
      _id: new mongoose.Types.ObjectId(),
      poolId: new mongoose.Types.ObjectId(mockPoolId),
      assetCode: "SHUT439011",
      issuerPublicKey: "GAJVUHQV5ZBQ6XMVLXL4QHXFZVBVBXM4PEX2XCZMN7H6VWLJDP3I6YHX",
      distributionPublicKey: "GBVXSZQHQJLVH7QKGVBR2XDVJ6VJM4LKXNQVHXZBXVJ7CKZW5QJVHXZB",
      status: "active",
      network: "testnet",
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    vi.mocked(StellarPoolAsset.findOneAndUpdate).mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockAsset),
    } as any)

    const result = await updatePoolAssetStatus(mockPoolId, "active")

    expect(result).not.toBeNull()
    expect(result?.status).toBe("active")
  })

  it("should throw error for invalid status", async () => {
    await expect(updatePoolAssetStatus(mockPoolId, "invalid" as any)).rejects.toThrow("Invalid status")
  })

  it("should throw error when pool asset not found", async () => {
    vi.mocked(StellarPoolAsset.findOneAndUpdate).mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as any)

    await expect(updatePoolAssetStatus(mockPoolId, "active")).rejects.toThrow("Pool asset not found")
  })

  it("should throw error for invalid pool ID", async () => {
    await expect(updatePoolAssetStatus("invalid", "active")).rejects.toThrow("Invalid pool ID")
  })
})

describe("listPoolAssets", () => {
  it("should return all pool assets without filters", async () => {
    const mockAssets = [
      {
        _id: new mongoose.Types.ObjectId(),
        poolId: new mongoose.Types.ObjectId(),
        assetCode: "SHUT123456",
        issuerPublicKey: "GAJVUHQV5ZBQ6XMVLXL4QHXFZVBVBXM4PEX2XCZMN7H6VWLJDP3I6YHX",
        distributionPublicKey: "GBVXSZQHQJLVH7QKGVBR2XDVJ6VJM4LKXNQVHXZBXVJ7CKZW5QJVHXZB",
        status: "active",
        network: "testnet",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: new mongoose.Types.ObjectId(),
        poolId: new mongoose.Types.ObjectId(),
        assetCode: "KEKE654321",
        issuerPublicKey: "GAJVUHQV5ZBQ6XMVLXL4QHXFZVBVBXM4PEX2XCZMN7H6VWLJDP3I6YHX",
        distributionPublicKey: "GBVXSZQHQJLVH7QKGVBR2XDVJ6VJM4LKXNQVHXZBXVJ7CKZW5QJVHXZB",
        status: "draft",
        network: "testnet",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    vi.mocked(StellarPoolAsset.find).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockAssets),
      }),
    } as any)

    const result = await listPoolAssets()

    expect(result).toHaveLength(2)
    expect(result[0].assetCode).toBe("SHUT123456")
    expect(result[1].assetCode).toBe("KEKE654321")
  })

  it("should filter pool assets by status", async () => {
    const mockAssets = [
      {
        _id: new mongoose.Types.ObjectId(),
        poolId: new mongoose.Types.ObjectId(),
        assetCode: "SHUT123456",
        issuerPublicKey: "GAJVUHQV5ZBQ6XMVLXL4QHXFZVBVBXM4PEX2XCZMN7H6VWLJDP3I6YHX",
        distributionPublicKey: "GBVXSZQHQJLVH7QKGVBR2XDVJ6VJM4LKXNQVHXZBXVJ7CKZW5QJVHXZB",
        status: "active",
        network: "testnet",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    vi.mocked(StellarPoolAsset.find).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockAssets),
      }),
    } as any)

    const result = await listPoolAssets({ status: "active" })

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe("active")
  })

  it("should filter pool assets by network", async () => {
    const mockAssets = [
      {
        _id: new mongoose.Types.ObjectId(),
        poolId: new mongoose.Types.ObjectId(),
        assetCode: "SHUT123456",
        issuerPublicKey: "GAJVUHQV5ZBQ6XMVLXL4QHXFZVBVBXM4PEX2XCZMN7H6VWLJDP3I6YHX",
        distributionPublicKey: "GBVXSZQHQJLVH7QKGVBR2XDVJ6VJM4LKXNQVHXZBXVJ7CKZW5QJVHXZB",
        status: "active",
        network: "mainnet",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    vi.mocked(StellarPoolAsset.find).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockAssets),
      }),
    } as any)

    const result = await listPoolAssets({ network: "mainnet" })

    expect(result).toHaveLength(1)
    expect(result[0].network).toBe("mainnet")
  })
})
