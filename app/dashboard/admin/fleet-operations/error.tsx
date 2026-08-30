"use client"

import { useEffect } from "react"

import { PageHeader } from "@/components/dashboard/admin/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function FleetOperationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Fleet operations dashboard failed to load:", error)
  }, [error])

  return (
    <div className="space-y-5">
      <PageHeader title="Fleet Operations" subtitle="Something went wrong while loading the dashboard." />
      <Card className="border-border/70">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load fleet data right now. Please try again.
          </p>
          <Button onClick={reset} variant="outline">
            Retry
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
