"use client"

import { useState } from "react"
import { AlertCircle, Building2, CheckCircle2, Copy, FlaskConical, Landmark, Wallet } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { MockRepaymentSimulator } from "@/components/dashboard/driver-hire-purchase/mock-repayment-simulator"
import { formatNaira } from "@/lib/currency"
import { useToast } from "@/hooks/use-toast"

interface DriverVirtualAccountCardProps {
  account:
    | {
        accountNumber: string
        accountName: string
        bankName: string
        providerSlug?: string | null
        status: "PENDING" | "ACTIVE" | "FAILED" | "INACTIVE"
        isMock?: boolean
        mockReference?: string | null
      }
    | null
  errorMessage?: string | null
  remainingBalanceNgn: number
  nextPaymentAmountNgn: number
  showMockSimulator?: boolean
}

function resolveStatusBadgeVariant(status?: string | null) {
  if (status === "ACTIVE") return "green" as const
  if (status === "PENDING") return "yellow" as const
  if (status === "FAILED") return "destructive" as const
  return "secondary" as const
}

export function DriverVirtualAccountCard({
  account,
  errorMessage,
  remainingBalanceNgn,
  nextPaymentAmountNgn,
  showMockSimulator = false,
}: DriverVirtualAccountCardProps) {
  const { toast } = useToast()
  const [isCopying, setIsCopying] = useState(false)

  const handleCopy = async () => {
    if (!account?.accountNumber) return

    setIsCopying(true)
    try {
      await navigator.clipboard.writeText(account.accountNumber)
      toast({
        title: "Account number copied",
        description: `${account.accountNumber} is ready to share or paste into your banking app.`,
      })
    } catch {
      toast({
        title: "Copy failed",
        description: "Unable to copy the account number from this browser session.",
        variant: "destructive",
      })
    } finally {
      setIsCopying(false)
    }
  }

  return (
    <Card className="overflow-hidden rounded-[10px] border border-border/70 bg-card">
      <CardHeader className="border-b border-border/60 bg-amber-50/80 dark:bg-amber-950/25">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="text-xl text-foreground">Dedicated Repayment Account</CardTitle>
            <CardDescription className="mt-1 text-sm text-muted-foreground">
              Transfer to this account and we will match the payment to your hire-purchase contract automatically.
            </CardDescription>
          </div>
          <Badge variant={resolveStatusBadgeVariant(account?.status || (errorMessage ? "FAILED" : "PENDING"))}>
            {account?.isMock ? "Mock Test Account" : account?.status || (errorMessage ? "Unavailable" : "Provisioning")}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4 md:p-5">
        {account?.isMock ? (
          <Alert className="border-dashed border-amber-400/80 bg-amber-50/70 dark:bg-amber-950/20">
            <FlaskConical className="h-4 w-4 text-amber-700 dark:text-amber-300" />
            <AlertTitle>Test-only mock Paystack account</AlertTitle>
            <AlertDescription>
              Bank details below are fake local data for contributor testing. Production Paystack behavior is unchanged
              when mock mode is disabled.
              {account.mockReference ? ` Reference: ${account.mockReference}` : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {account ? (
          <>
            <div className="grid gap-4 rounded-lg border border-border/60 bg-background p-4 md:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                  <Building2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  {account.bankName}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Account Number</p>
                  <p className="mt-2 break-all font-mono text-[1.65rem] font-semibold tracking-[0.12em] text-foreground sm:text-3xl sm:tracking-[0.16em]">
                    {account.accountNumber}
                  </p>
                </div>
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>{account.accountName}</span>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-dashed border-border/70 bg-muted/30 p-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Recommended Next Payment</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{formatNaira(nextPaymentAmountNgn)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Remaining Balance</p>
                  <p className="mt-2 text-lg font-medium text-foreground">{formatNaira(remainingBalanceNgn)}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleCopy}
                  disabled={isCopying}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  {isCopying ? "Copying..." : "Copy Account Number"}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
              <div className="rounded-md border border-border/60 bg-background p-3">
                <div className="inline-flex items-center gap-2 font-medium text-foreground">
                  <Wallet className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Bank transfer first
                </div>
                <p className="mt-2">This is now the primary repayment method for the contract.</p>
              </div>
              <div className="rounded-md border border-border/60 bg-background p-3">
                <div className="inline-flex items-center gap-2 font-medium text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  Auto-matched
                </div>
                <p className="mt-2">Incoming transfers are matched through the Paystack webhook using this account number.</p>
              </div>
              <div className="rounded-md border border-border/60 bg-background p-3">
                <div className="inline-flex items-center gap-2 font-medium text-foreground">
                  <Building2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Provider
                </div>
                <p className="mt-2">
                  {account.isMock
                    ? "mock-paystack (local test provider)"
                    : account.providerSlug
                      ? account.providerSlug
                      : "Paystack dedicated virtual account"}
                </p>
              </div>
            </div>

            {showMockSimulator && account.isMock ? (
              <MockRepaymentSimulator
                defaultAmountNgn={nextPaymentAmountNgn}
                maxAmountNgn={remainingBalanceNgn}
              />
            ) : null}
          </>
        ) : (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Dedicated account unavailable</AlertTitle>
            <AlertDescription>
              {errorMessage ||
                "We could not assign a dedicated repayment account yet. You can still use Paystack checkout below."}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
