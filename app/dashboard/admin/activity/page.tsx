import { ActivityFeed } from "@/components/dashboard/activity-feed"

export default function AdminActivityPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review platform events and operational updates.</p>
      </section>
      <ActivityFeed />
    </div>
  )
}
