import { repaymentBarClass } from "@/src/server/admin/fleet"

interface RepaymentBarProps {
  percent: number
  status?: string | null
  className?: string
}

export function RepaymentBar({ percent, status, className }: RepaymentBarProps) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <div className="h-2 w-full max-w-[120px] overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${repaymentBarClass(percent, status)}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums text-muted-foreground">{percent}%</span>
    </div>
  )
}
