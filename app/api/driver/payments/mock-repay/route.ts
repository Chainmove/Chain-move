import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import { getDriverContract, createAndConfirmDriverTransferPayment } from "@/lib/services/driver-contracts.service"
import {
  createMockDvaRepaymentReference,
  isMockPaymentsRuntimeAllowed,
} from "@/lib/services/paystack-mock.service"
import { getDriverVirtualAccount } from "@/lib/services/paystack-dva.service"

export async function POST(request: Request) {
  if (!isMockPaymentsRuntimeAllowed()) {
    return NextResponse.json(
      {
        success: false,
        code: "MOCK_PAYMENTS_DISABLED",
        message: "Mock repayment simulation is only available in local/test mode.",
      },
      { status: 403 },
    )
  }

  try {
    const { user, shouldRefreshSession } = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    if (user.role !== "driver") {
      return NextResponse.json({ message: "Only drivers can simulate mock repayments." }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const amountNgn = Number(body?.amountNgn)
    if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
      return NextResponse.json({ message: "A positive amountNgn value is required." }, { status: 400 })
    }

    const contract = await getDriverContract(user._id.toString())
    if (!contract || contract.status !== "ACTIVE") {
      return NextResponse.json(
        { message: "An active hire-purchase contract is required before simulating a repayment." },
        { status: 404 },
      )
    }

    const virtualAccount = await getDriverVirtualAccount({
      driverUserId: user._id.toString(),
      contractId: contract.id,
    })

    if (!virtualAccount?.accountNumber || !virtualAccount.isMock) {
      return NextResponse.json(
        {
          message: "A mock dedicated repayment account must be provisioned before simulating a transfer.",
        },
        { status: 404 },
      )
    }

    const paystackRef = createMockDvaRepaymentReference()
    const settlementResult = await createAndConfirmDriverTransferPayment({
      contractId: contract.id,
      driverUserId: user._id.toString(),
      amountNgn,
      payerEmail: user.email || "mock-driver@chainmove.test",
      paystackRef,
      channel: "dedicated_nuban",
      metadata: {
        source: "mock_paystack_dva_simulation",
        paymentType: "driver_repayment",
        receiverBankAccountNumber: virtualAccount.accountNumber,
        mock: true,
        testOnly: true,
      },
    })

    const response = NextResponse.json({
      success: true,
      data: {
        reference: paystackRef,
        amountNgn,
        alreadyProcessed: settlementResult.alreadyProcessed,
        contract: settlementResult.contract,
        payment: settlementResult.payment,
        mock: true,
        testOnly: true,
      },
    })

    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to simulate mock repayment."
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
