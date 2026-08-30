import { describe, expect, it } from "vitest"

import {
  CURRENT_EMBEDDED_WALLET,
  embeddedWalletProviderConfig,
  getWalletDisplay,
  PLANNED_STELLAR_WALLET,
} from "./config"

describe("wallet configuration", () => {
  it("keeps the current Privy embedded wallet on Lisk Sepolia", () => {
    const embeddedWalletAddress = "0x1234567890abcdef1234567890abcdef12345678"

    expect(CURRENT_EMBEDDED_WALLET).toMatchObject({
      mode: "embedded-evm",
      provider: "privy",
      status: "current",
      network: {
        id: "lisk-sepolia",
        label: "Lisk Sepolia",
        family: "evm",
        nativeAsset: "ETH",
      },
    })
    expect(embeddedWalletProviderConfig.loginMethods).toEqual(["email", "sms"])
    expect(embeddedWalletProviderConfig.defaultChain?.id).toBe(4202)
    expect(embeddedWalletProviderConfig.embeddedWallets).toMatchObject({
      ethereum: { createOnLogin: "all-users" },
      showWalletUIs: true,
    })

    expect(getWalletDisplay({ embeddedWalletAddress })).toMatchObject({
      mode: "embedded-evm",
      label: "Privy embedded wallet",
      addressLabel: "Wallet",
      address: embeddedWalletAddress,
      shortAddress: "0x1234...5678",
      networkLabel: "Lisk Sepolia",
      linked: true,
    })
  })

  it("uses the Stellar account display when a Stellar public key is linked", () => {
    const stellarPublicKey = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"
    const display = getWalletDisplay({
      embeddedWalletAddress: "0x1234567890abcdef",
      stellarPublicKey,
    })

    expect(PLANNED_STELLAR_WALLET.status).toBe("planned")
    expect(display).toMatchObject({
      mode: "stellar-account",
      label: "Stellar account",
      addressLabel: "Stellar account",
      address: stellarPublicKey,
      shortAddress: "GBRPYH...OX2H",
      networkLabel: "Stellar Testnet",
      linked: true,
    })
    expect(display.explorerUrl).toContain(`/account/${stellarPublicKey}`)
  })

  it("returns a safe fallback when no wallet is linked", () => {
    expect(getWalletDisplay({})).toEqual({
      mode: null,
      label: "Wallet",
      addressLabel: "Wallet",
      address: null,
      shortAddress: null,
      networkLabel: "No network",
      explorerUrl: null,
      linked: false,
    })
  })
})
