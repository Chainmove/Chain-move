import { PageHeader } from "@/components/dashboard/admin/page-header"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

export default function FleetOperationsLoading() {
  return (
    <div className="space-y-5">
      <PageHeader title="Fleet Operations" subtitle="Loading fleet data…" />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Card key={index} className="border-border/70">
            <CardHeader>
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="h-7 w-24 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="rounded-xl border border-border/70 bg-card shadow-sm">
        <div className="border-b border-border/60 px-4 py-3">
          <div className="h-4 w-48 animate-pulse rounded bg-muted" />
        </div>
        <div className="divide-y divide-border/60">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between gap-4 px-4 py-4">
              <div className="space-y-2">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
