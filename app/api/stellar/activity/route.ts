import { NextResponse } from "next/server"
import { getStellarConfig } from "@/lib/stellar/config"
import { getStellarClient } from "@/lib/stellar/client"
import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import dbConnect from "@/lib/dbConnect"
import StellarIndexedEvent from "@/models/StellarIndexedEvent"

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request, ["admin", "driver", "investor"])
    if ("response" in auth) return auth.response

    const config = getStellarConfig()
    const { user } = auth
    const isMock = config.mock

    // Base stellar information to return
    const stellarInfo = {
      network: config.network,
      networkLabel: config.network === "mainnet" ? "Stellar Mainnet" : "Stellar Testnet",
      horizonUrl: config.horizonUrl,
      rpcUrl: config.rpcUrl,
      contractId: config.contractId,
      mock: isMock,
      linkedAccount: user.stellarPublicKey || null,
    }

    if (isMock) {
      // Return mock balances and activities
      const demoAccount = user.stellarPublicKey || "GD3MOCKACCOUNT123456789"
      
      const mockBalances = [
        { asset: "XLM", balance: "10000.00", type: "native" },
        { asset: "USDC", balance: "2450.50", type: "credit", issuer: "GBBD47IF2H737MZRLT27725J5N5F3GZLU54B7S5XZPZ2GCK4V72UUMOO" },
        { asset: "CMOVE", balance: "5000.00", type: "credit", issuer: config.issuerPublicKey || "GCFZPZ2GCK4V72UUMOO000000000000000000000000000000000000000" }
      ]

      const mockActivities = [
        {
          id: "mock-stellar-act-1",
          chainMoveRecordType: "repayment",
          eventType: "payment",
          title: "Repayment Settlement",
          amount: "150.00",
          asset: "CMOVE",
          date: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
          status: "Confirmed",
          sourceAccount: demoAccount,
          destinationAccount: "GBXDistributionAccount0000000000000000000000000000000000",
          reference: "f2f6b7c8c9d04de1b7e6a31d5b8f1b57c3f3d0a0d8a1b4e7c1c7e4f6b7c8d9a0"
        },
        {
          id: "mock-stellar-act-2",
          chainMoveRecordType: "pool_investment",
          eventType: "payment",
          title: "Pool Share Allocation",
          amount: "2500.00",
          asset: "CMOVE",
          date: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
          status: "Confirmed",
          sourceAccount: demoAccount,
          destinationAccount: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000002",
          reference: "c1f1b3d1f4aa4f4c9c23f4f2f1e0d5b6a8c2e3f4d5c6b7a8c9d0e1f2a3b4c5d6"
        },
        {
          id: "mock-stellar-act-3",
          chainMoveRecordType: "payout",
          eventType: "payment",
          title: "Quarterly Profit Payout",
          amount: "350.00",
          asset: "USDC",
          date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
          status: "Confirmed",
          sourceAccount: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000003",
          destinationAccount: demoAccount,
          reference: "d9a8c7b6a5e4d3c2b1a0f9e8d7c6b5a4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8"
        },
        {
          id: "mock-stellar-act-4",
          chainMoveRecordType: "wallet_funding",
          eventType: "create_account",
          title: "Stellar Account Activated",
          amount: "1000.00",
          asset: "XLM",
          date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
          status: "Confirmed",
          sourceAccount: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000004",
          destinationAccount: demoAccount,
          reference: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
        },
        {
          id: "mock-stellar-act-5",
          chainMoveRecordType: "contract_interaction",
          eventType: "invoke_host_function",
          title: "Soroban Pool Deposit",
          amount: "2500.00",
          asset: "CMOVE",
          date: new Date(Date.now() - 1000 * 60 * 60 * 12 - 5000).toISOString(),
          status: "Confirmed",
          sourceAccount: demoAccount,
          destinationAccount: config.contractId || "CCMOVEPOOLCONTRACTPUBLICKEY0000000000000000000000000000000",
          reference: "b3d1f4aa4f4c9c23f4f2f1e0d5b6a8c2e3f4d5c6b7a8c9d0e1f2a3b4c5d6e7f8",
          sorobanEvents: [
            {
              contractId: config.contractId || "CCMOVEPOOLCONTRACTPUBLICKEY0000000000000000000000000000000",
              topics: ["transfer", demoAccount, config.contractId || "CCMOVEPOOLCONTRACTPUBLICKEY0000000000000000000000000000000"],
              value: "2500.00 CMOVE"
            },
            {
              contractId: config.contractId || "CCMOVEPOOLCONTRACTPUBLICKEY0000000000000000000000000000000",
              topics: ["pool_joined", demoAccount],
              value: "Shares issued: 2500"
            }
          ]
        }
      ]

      const response = NextResponse.json({
        ...stellarInfo,
        linkedAccount: demoAccount,
        balances: mockBalances,
        activities: mockActivities,
      })
      return finalizeAuthenticatedResponse(response, auth)
    }

    // Live mode
    const stellarPublicKey = user.stellarPublicKey
    if (!stellarPublicKey) {
      const response = NextResponse.json({
        ...stellarInfo,
        balances: [],
        activities: [],
      })
      return finalizeAuthenticatedResponse(response, auth)
    }

    await dbConnect()

    // 1. Fetch balances from Horizon
    let balances: any[] = []
    let isFunded = true
    try {
      const client = getStellarClient(config)
      const accountInfo = await client.horizon.loadAccount(stellarPublicKey)
      balances = accountInfo.balances.map((b: any) => ({
        asset: b.asset_type === "native" ? "XLM" : b.asset_code,
        balance: b.balance,
        type: b.asset_type,
        issuer: b.asset_issuer || null,
      }))
    } catch (err: any) {
      if (err?.response?.status === 404) {
        isFunded = false
        balances = [
          { asset: "XLM", balance: "0.00", type: "native", isPlaceholder: true }
        ]
      } else {
        console.error("HORIZON_ACCOUNT_LOAD_ERROR", err)
      }
    }

    // 2. Query MongoDB for events
    let eventQuery: any = {}
    if (user.role === "admin") {
      // Admins see all indexed events
      eventQuery = {}
    } else {
      // Investors/Drivers see events involving their linked key
      eventQuery = {
        $or: [
          { sourceAccount: stellarPublicKey },
          { destinationAccount: stellarPublicKey }
        ]
      }
    }

    const events = await StellarIndexedEvent.find(eventQuery)
      .sort({ stellarCreatedAt: -1, createdAt: -1 })
      .limit(50)
      .lean()

    const activities = events.map((e: any) => {
      let title = "Stellar Transaction"
      switch (e.chainMoveRecordType) {
        case "repayment":
          title = "Repayment Settlement"
          break
        case "investment":
        case "pool_investment":
          title = "Pool Share Allocation"
          break
        case "wallet_funding":
          title = e.eventType === "create_account" ? "Stellar Account Activated" : "Wallet Funding"
          break
        case "payout":
          title = "Quarterly Profit Payout"
          break
        case "contract_interaction":
          title = "Soroban Contract Call"
          break
      }

      return {
        id: e._id,
        chainMoveRecordType: e.chainMoveRecordType,
        eventType: e.eventType,
        title,
        amount: e.amount || "0.00",
        asset: e.asset || "XLM",
        date: e.stellarCreatedAt || e.createdAt.toISOString(),
        status: "Confirmed",
        sourceAccount: e.sourceAccount,
        destinationAccount: e.destinationAccount || null,
        reference: e.raw?.transaction_hash || e._id,
        sorobanEvents: e.eventType === "invoke_host_function" ? (e.raw?.soroban_events || []) : [],
      }
    })

    const response = NextResponse.json({
      ...stellarInfo,
      isFunded,
      balances,
      activities,
    })
    return finalizeAuthenticatedResponse(response, auth)
  } catch (error) {
    console.error("STELLAR_ACTIVITY_API_ERROR", error)
    return NextResponse.json({ error: "Failed to fetch Stellar activity" }, { status: 500 })
  }
}
