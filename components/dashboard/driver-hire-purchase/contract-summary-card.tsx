import { AlertTriangle, Calendar, CheckCircle, Receipt, TrendingUp } from "lucide-react"

import { formatNaira } from "@/lib/currency"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import type { DriverContractSnapshot } from "@/lib/services/driver-contracts.service"

interface ContractSummaryCardProps {
  contract: DriverContractSnapshot
  className?: string
}

function formatDateLabel(value: string | null) {
  if (!value) return "N/A"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "N/A"
  return date.toLocaleDateString("en-NG", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function ContractSummaryCard({ contract, className }: ContractSummaryCardProps) {
  const isCompleted = contract.status === "COMPLETED"
  const isDefaulted = contract.status === "DEFAULTED"
  const progressPercent = Math.round(contract.progressRatio * 100)

  return (
    <section className={cn("rounded-[10px] border border-border/70 bg-card p-4 md:p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">My Contract</h3>
          <p className="mt-1 text-sm text-muted-foreground">Hire-purchase repayment progress and due schedule.</p>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold",
            isCompleted
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : isDefaulted
                ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                : "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
          )}
        >
          {isCompleted ? <CheckCircle className="mr-1 h-3.5 w-3.5" /> : null}
          {isDefaulted ? <AlertTriangle className="mr-1 h-3.5 w-3.5" /> : null}
          {contract.status}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <article className="rounded-[10px] border border-border/70 px-3 py-3">
          <p className="text-xs text-muted-foreground">Vehicle</p>
          <p className="mt-1 text-base font-semibold text-foreground">{contract.vehicleDisplayName}</p>
          <p className="mt-1 text-xs text-muted-foreground">{contract.assetType} pool-linked contract</p>
        </article>

        <article className="rounded-[10px] border border-border/70 px-3 py-3">
          <p className="text-xs text-muted-foreground">Start date</p>
          <p className="mt-1 text-base font-semibold text-foreground">{formatDateLabel(contract.startDate)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Duration {contract.durationWeeks} weeks
          </p>
        </article>
      </div>

      <div className="mt-3 rounded-[10px] border border-border/70 px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Repayment Progress</p>
          <p className="text-xs font-semibold text-foreground">{progressPercent}%</p>
        </div>
        <Progress value={progressPercent} className="h-2" />
        <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <p className="inline-flex items-center">
            <Receipt className="mr-1.5 h-3.5 w-3.5" />
            Total paid: {formatNaira(contract.totalPaidNgn)}
          </p>
          <p className="inline-flex items-center sm:justify-end">
            <Calendar className="mr-1.5 h-3.5 w-3.5" />
            Next due: {formatDateLabel(contract.nextDueDate)}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <article className="rounded-[10px] border border-border/70 px-3 py-3">
          <p className="text-xs text-muted-foreground">Total contract</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{formatNaira(contract.totalPayableNgn)}</p>
        </article>
        <article className="rounded-[10px] border border-border/70 px-3 py-3">
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{formatNaira(contract.remainingBalanceNgn)}</p>
        </article>
        <article className="rounded-[10px] border border-border/70 px-3 py-3">
          <p className="inline-flex items-center text-xs text-muted-foreground">
            <TrendingUp className="mr-1 h-3.5 w-3.5" />
            Ownership
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">{progressPercent}% complete</p>
        </article>
      </div>
    </section>
  )
}

