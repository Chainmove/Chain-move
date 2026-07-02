"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { FlaskConical } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatNaira } from "@/lib/currency"
import { useToast } from "@/hooks/use-toast"

interface MockRepaymentSimulatorProps {
  defaultAmountNgn: number
  maxAmountNgn: number
}

export function MockRepaymentSimulator({ defaultAmountNgn, maxAmountNgn }: MockRepaymentSimulatorProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [amountNgn, setAmountNgn] = useState(String(defaultAmountNgn))
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSimulate = async () => {
    const parsedAmount = Number(amountNgn)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast({
        title: "Invalid amount",
        description: "Enter a positive NGN amount to simulate a mock bank transfer.",
        variant: "destructive",
      })
      return
    }

    if (parsedAmount > maxAmountNgn) {
      toast({
        title: "Amount too high",
        description: `Mock repayments cannot exceed the remaining balance of ${formatNaira(maxAmountNgn)}.`,
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch("/api/driver/payments/mock-repay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountNgn: parsedAmount }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof payload.message === "string" ? payload.message : "Mock repayment failed.")
      }

      toast({
        title: "Mock repayment applied",
        description: `${formatNaira(parsedAmount)} was credited to your contract using local test mode.`,
      })
      router.refresh()
    } catch (error) {
      toast({
        title: "Simulation failed",
        description: error instanceof Error ? error.message : "Unable to simulate a mock repayment.",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Alert className="border-amber-300/80 bg-amber-50/90 dark:border-amber-900/70 dark:bg-amber-950/30">
      <FlaskConical className="h-4 w-4 text-amber-700 dark:text-amber-300" />
      <AlertTitle>Local mock repayment mode</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          This dedicated account is fake test data. No Paystack API calls are made while mock payments are enabled.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="mock-repayment-amount">Simulate incoming transfer (NGN)</Label>
            <Input
              id="mock-repayment-amount"
              type="number"
              min={1}
              max={maxAmountNgn}
              step="0.01"
              value={amountNgn}
              onChange={(event) => setAmountNgn(event.target.value)}
              disabled={isSubmitting}
            />
          </div>
          <Button type="button" variant="secondary" onClick={handleSimulate} disabled={isSubmitting}>
            {isSubmitting ? "Applying..." : "Simulate Mock Transfer"}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
