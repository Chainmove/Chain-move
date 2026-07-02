import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import { getDriverContract } from "@/lib/services/driver-contracts.service"
import {
  DriverVirtualAccountProvisionError,
  getOrProvisionDriverVirtualAccount,
} from "@/lib/services/paystack-dva.service"

export async function GET(request: Request) {
  try {
    const { user, shouldRefreshSession } = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    if (user.role !== "driver") {
      return NextResponse.json({ message: "Only drivers can access dedicated repayment accounts." }, { status: 403 })
    }

    const contract = await getDriverContract(user._id.toString())
    if (!contract || contract.status !== "ACTIVE") {
      return NextResponse.json(
        { message: "An active hire-purchase contract is required before a virtual account can be assigned." },
        { status: 404 },
      )
    }

    const virtualAccount = await getOrProvisionDriverVirtualAccount({
      driverUserId: user._id.toString(),
      contractId: contract.id,
    })

    const response = NextResponse.json({
      success: true,
      data: {
        accountNumber: virtualAccount.accountNumber,
        accountName: virtualAccount.accountName,
        bankName: virtualAccount.bankName,
        providerSlug: virtualAccount.providerSlug,
        status: virtualAccount.status,
        contractId: contract.id,
        remainingBalanceNgn: contract.remainingBalanceNgn,
        nextPaymentAmountNgn: contract.nextPaymentAmountNgn,
        isMock: virtualAccount.isMock,
        mockReference: virtualAccount.mockReference,
        testOnly: virtualAccount.isMock,
      },
    })

    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (error) {
    const message =
      error instanceof DriverVirtualAccountProvisionError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unable to load driver virtual account."
    const statusCode = error instanceof DriverVirtualAccountProvisionError ? error.statusCode : 500
    const code = error instanceof DriverVirtualAccountProvisionError ? error.code : "DRIVER_VIRTUAL_ACCOUNT_ERROR"

    return NextResponse.json(
      {
        success: false,
        code,
        message,
      },
      { status: statusCode },
    )
  }
}
