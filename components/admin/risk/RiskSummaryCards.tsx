import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertCircle, Clock, ShieldAlert, TrendingDown, Wallet } from "lucide-react"

interface RiskSummaryCardsProps {
  summary: {
    lateRepayments: number
    repeatedFailedTransactions: number
    inactiveContracts: number
    underperformingPools: number
    highValueWalletFundings: number
  } | null
  isLoading?: boolean
}

export function RiskSummaryCards({ summary, isLoading }: RiskSummaryCardsProps) {
  const cards = [
    { title: "Late Repayments", value: summary?.lateRepayments, icon: Clock, color: "text-amber-500" },
    { title: "Failed Transactions", value: summary?.repeatedFailedTransactions, icon: AlertCircle, color: "text-red-500" },
    { title: "Inactive Contracts", value: summary?.inactiveContracts, icon: ShieldAlert, color: "text-slate-500" },
    { title: "Underperforming Pools", value: summary?.underperformingPools, icon: TrendingDown, color: "text-orange-500" },
    { title: "High-Value Flags", value: summary?.highValueWalletFundings, icon: Wallet, color: "text-purple-500" },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      {cards.map((card, i) => {
        const Icon = card.icon
        return (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <Icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? (
                  <div className="h-8 w-12 bg-muted animate-pulse rounded" />
                ) : (
                  (card.value ?? 0)
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
