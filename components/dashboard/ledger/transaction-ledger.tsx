"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatNaira } from "@/lib/currency"
import { cn } from "@/lib/utils"

type LedgerRole = "admin" | "investor" | "driver"

interface LedgerEntry {
  id: string
  userId: string
  userType: string
  userName: string | null
  userEmail: string | null
  type: string
  direction: "credit" | "debit"
  amount: number
  amountOriginal: number | null
  currency: string
  originalCurrency: string | null
  exchangeRate: number | null
  method: string | null
  reference: string | null
  description: string
  status: string
  reconciliation: "reconciled" | "pending" | "failed" | "duplicate"
  relatedId: string | null
  metadata: Record<string, unknown> | null
  timestamp: string
}

interface LedgerSummary {
  totalCount: number
  totalAmount: number
  completedCount: number
  completedAmount: number
  pendingCount: number
  pendingAmount: number
  failedCount: number
  failedAmount: number
  duplicateCount: number
}

interface LedgerResponse {
  success: boolean
  scope: "global" | "self"
  transactions: LedgerEntry[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: LedgerSummary
}

interface TransactionLedgerProps {
  role: LedgerRole
  title?: string
  description?: string
}

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All types" },
  { value: "deposit", label: "Deposit" },
  { value: "wallet_funding", label: "Wallet Funding" },
  { value: "wallet_debit", label: "Wallet Debit" },
  { value: "withdrawal", label: "Withdrawal" },
  { value: "investment", label: "Investment" },
  { value: "pool_investment", label: "Pool Investment" },
  { value: "return", label: "Return / Payout" },
  { value: "repayment", label: "Repayment" },
  { value: "loan_disbursement", label: "Loan Disbursement" },
  { value: "down_payment", label: "Down Payment" },
]

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "Completed", label: "Completed" },
  { value: "Pending", label: "Pending" },
  { value: "Failed", label: "Failed" },
]

const METHOD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All providers" },
  { value: "paystack", label: "Paystack" },
  { value: "gateway", label: "Gateway" },
  { value: "wallet", label: "Wallet" },
  { value: "internal_wallet", label: "Internal Wallet" },
  { value: "privy", label: "Privy" },
  { value: "system", label: "System" },
]

const RECONCILIATION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All reconciliation" },
  { value: "reconciled", label: "Reconciled" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "duplicate", label: "Duplicate" },
]

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.filter((option) => option.value).map((option) => [option.value, option.label]),
)

const METHOD_LABELS: Record<string, string> = Object.fromEntries(
  METHOD_OPTIONS.filter((option) => option.value).map((option) => [option.value, option.label]),
)

const PAGE_SIZE = 20

const selectClassName =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"

function formatType(type: string) {
  return TYPE_LABELS[type] ?? type.replace(/_/g, " ")
}

function formatMethod(method: string | null) {
  if (!method) return "—"
  return METHOD_LABELS[method] ?? method
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("en-NG", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function statusVariant(status: string): "green" | "yellow" | "red" | "outline" {
  if (status === "Completed") return "green"
  if (status === "Pending") return "yellow"
  if (status === "Failed") return "red"
  return "outline"
}

function reconciliationVariant(value: string): "green" | "yellow" | "red" | "purple" | "outline" {
  if (value === "reconciled") return "green"
  if (value === "pending") return "yellow"
  if (value === "failed") return "red"
  if (value === "duplicate") return "purple"
  return "outline"
}

export function TransactionLedger({ role, title, description }: TransactionLedgerProps) {
  const isAdmin = role === "admin"

  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [type, setType] = useState("")
  const [status, setStatus] = useState("")
  const [method, setMethod] = useState("")
  const [reconciliation, setReconciliation] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)

  const [data, setData] = useState<LedgerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<LedgerEntry | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(handle)
  }, [search])

  // Reset to first page whenever a filter changes.
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, type, status, method, reconciliation, from, to])

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    params.set("page", String(page))
    params.set("pageSize", String(PAGE_SIZE))
    if (debouncedSearch) params.set("search", debouncedSearch)
    if (type) params.set("type", type)
    if (status) params.set("status", status)
    if (method) params.set("method", method)
    if (reconciliation) params.set("reconciliation", reconciliation)
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    return params.toString()
  }, [page, debouncedSearch, type, status, method, reconciliation, from, to])

  const fetchLedger = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/transactions/ledger?${queryString}`)
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
      }
      const payload = (await response.json()) as LedgerResponse
      setData(payload)
    } catch (fetchError) {
      console.error("LEDGER_FETCH_ERROR", fetchError)
      setError("We couldn't load the transaction ledger. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [queryString])

  useEffect(() => {
    void fetchLedger()
  }, [fetchLedger])

  const exportHref = useMemo(() => {
    const params = new URLSearchParams()
    if (debouncedSearch) params.set("search", debouncedSearch)
    if (type) params.set("type", type)
    if (status) params.set("status", status)
    if (method) params.set("method", method)
    if (reconciliation) params.set("reconciliation", reconciliation)
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    const query = params.toString()
    return `/api/transactions/ledger/export${query ? `?${query}` : ""}`
  }, [debouncedSearch, type, status, method, reconciliation, from, to])

  const hasActiveFilters = Boolean(
    debouncedSearch || type || status || method || reconciliation || from || to,
  )

  const clearFilters = () => {
    setSearch("")
    setType("")
    setStatus("")
    setMethod("")
    setReconciliation("")
    setFrom("")
    setTo("")
  }

  const summary = data?.summary
  const pagination = data?.pagination
  const entries = data?.transactions ?? []

  const summaryCards = [
    {
      label: "Total Transactions",
      value: summary ? summary.totalCount.toLocaleString() : "—",
      sub: summary ? `${formatNaira(summary.totalAmount)} total volume` : "",
    },
    {
      label: "Completed",
      value: summary ? formatNaira(summary.completedAmount) : "—",
      sub: summary ? `${summary.completedCount.toLocaleString()} transactions` : "",
    },
    {
      label: "Pending",
      value: summary ? formatNaira(summary.pendingAmount) : "—",
      sub: summary ? `${summary.pendingCount.toLocaleString()} transactions` : "",
    },
    {
      label: "Failed",
      value: summary ? formatNaira(summary.failedAmount) : "—",
      sub: summary ? `${summary.failedCount.toLocaleString()} transactions` : "",
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
            {title ?? "Transaction Ledger"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {description ??
              "Every balance movement with funding, repayments, payouts, and reconciliation status."}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <Button variant="outline" size="sm" onClick={() => void fetchLedger()} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={exportHref}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </a>
          </Button>
        </div>
      </div>

      {/* Balance summary cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <Card key={card.label} className="border-border/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading && !data ? (
                <Skeleton className="h-7 w-28" />
              ) : (
                <>
                  <p className="text-2xl font-semibold text-foreground">{card.value}</p>
                  {card.sub ? <p className="mt-1 text-xs text-muted-foreground">{card.sub}</p> : null}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      {isAdmin && summary && summary.duplicateCount > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-purple-500/40 bg-purple-500/10 px-4 py-3 text-sm text-foreground">
          <AlertTriangle className="h-4 w-4 text-purple-500" />
          <span>
            {summary.duplicateCount} duplicated provider reference
            {summary.duplicateCount === 1 ? "" : "s"} detected. Filter by{" "}
            <strong>Duplicate</strong> to review potential double-postings.
          </span>
        </div>
      ) : null}

      {/* Filters */}
      <Card className="border-border/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by description, reference, or related ID"
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <select className={selectClassName} value={type} onChange={(event) => setType(event.target.value)}>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select className={selectClassName} value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select className={selectClassName} value={method} onChange={(event) => setMethod(event.target.value)}>
              {METHOD_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className={selectClassName}
              value={reconciliation}
              onChange={(event) => setReconciliation(event.target.value)}
            >
              {RECONCILIATION_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label="From date"
                className={cn(selectClassName, "w-full")}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <input
                type="date"
                aria-label="To date"
                className={cn(selectClassName, "w-full")}
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
          </div>
          {hasActiveFilters ? (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Ledger table */}
      <Card className="border-border/70">
        <CardContent className="p-0">
          {error ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void fetchLedger()}>
                Try again
              </Button>
            </div>
          ) : loading && !data ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <p className="text-base font-medium text-foreground">No transactions found</p>
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "Try adjusting or clearing your filters."
                  : "Ledger entries will appear here as wallet activity happens."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    {isAdmin ? <TableHead>User</TableHead> : null}
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reconciliation</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow
                      key={entry.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(entry)}
                    >
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(entry.timestamp)}
                      </TableCell>
                      {isAdmin ? (
                        <TableCell className="max-w-[160px]">
                          <div className="truncate text-sm font-medium text-foreground">
                            {entry.userName || "Unknown"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {entry.userEmail || entry.userType}
                          </div>
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {entry.direction === "credit" ? (
                            <ArrowDownLeft className="h-4 w-4 text-green-600" />
                          ) : (
                            <ArrowUpRight className="h-4 w-4 text-red-600" />
                          )}
                          <span className="text-sm capitalize text-foreground">{formatType(entry.type)}</span>
                        </div>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "whitespace-nowrap text-right text-sm font-semibold",
                          entry.direction === "credit" ? "text-green-600" : "text-foreground",
                        )}
                      >
                        {entry.direction === "credit" ? "+" : "-"}
                        {formatNaira(entry.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={reconciliationVariant(entry.reconciliation)} className="capitalize">
                          {entry.reconciliation}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatMethod(entry.method)}</TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                        {entry.reference || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination && pagination.total > 0 ? (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            Showing {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{" "}
            {pagination.total.toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Next"}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Detail drawer */}
      <Sheet open={Boolean(selected)} onOpenChange={(open) => (!open ? setSelected(null) : undefined)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle className="capitalize">{formatType(selected.type)}</SheetTitle>
                <SheetDescription>Transaction details and reconciliation status.</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Amount</p>
                  <p
                    className={cn(
                      "text-2xl font-semibold",
                      selected.direction === "credit" ? "text-green-600" : "text-foreground",
                    )}
                  >
                    {selected.direction === "credit" ? "+" : "-"}
                    {formatNaira(selected.amount)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant={statusVariant(selected.status)}>{selected.status}</Badge>
                    <Badge variant={reconciliationVariant(selected.reconciliation)} className="capitalize">
                      {selected.reconciliation}
                    </Badge>
                    <Badge variant="outline" className="capitalize">
                      {selected.direction}
                    </Badge>
                  </div>
                </div>

                <DetailRow label="Date" value={formatDate(selected.timestamp)} />
                <DetailRow label="Description" value={selected.description || "—"} />
                <DetailRow label="Provider / Method" value={formatMethod(selected.method)} />
                <DetailRow label="Reference" value={selected.reference || "—"} mono />
                {selected.relatedId ? <DetailRow label="Related ID" value={selected.relatedId} mono /> : null}
                {selected.amountOriginal != null ? (
                  <DetailRow
                    label="Original Amount"
                    value={`${selected.amountOriginal} ${selected.originalCurrency ?? ""}`.trim()}
                  />
                ) : null}
                {selected.exchangeRate != null ? (
                  <DetailRow label="Exchange Rate" value={String(selected.exchangeRate)} />
                ) : null}
                {isAdmin ? (
                  <DetailRow
                    label="User"
                    value={selected.userName || selected.userEmail || selected.userId || "Unknown"}
                  />
                ) : null}
                <DetailRow label="Transaction ID" value={selected.id} mono />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 pb-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("text-right text-foreground", mono && "break-all font-mono text-xs")}>{value}</span>
    </div>
  )
}
