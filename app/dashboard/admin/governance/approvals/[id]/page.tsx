import Link from "next/link"
import { notFound } from "next/navigation"
import { revalidatePath } from "next/cache"
import { ArrowLeft } from "lucide-react"

import { PageHeader } from "@/components/dashboard/admin/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { requireAdminAccess } from "@/src/server/admin/require-admin"
import { getApprovalRequestById, decideApprovalRequest, cancelApprovalRequest } from "@/lib/approvals/service"
import { serializeApprovalRequest } from "@/lib/approvals/serialize"

export const dynamic = "force-dynamic"

interface ApprovalDetailPageProps {
  params: Promise<{ id: string }>
}

async function approveAction(formData: FormData) {
  "use server"
  const admin = await requireAdminAccess()
  const requestId = String(formData.get("requestId") || "")
  const reason = String(formData.get("reason") || "").trim() || undefined
  if (!requestId) return
  try {
    await decideApprovalRequest({ requestId, decision: "approve", approver: { id: admin.id, role: "admin" }, reason })
  } catch {
    // Swallowed: the page re-renders below with the request's actual
    // resulting status (e.g. still "pending" on self-approval or staleness).
  }
  revalidatePath(`/dashboard/admin/governance/approvals/${requestId}`)
  revalidatePath("/dashboard/admin/governance")
}

async function rejectAction(formData: FormData) {
  "use server"
  const admin = await requireAdminAccess()
  const requestId = String(formData.get("requestId") || "")
  const reason = String(formData.get("reason") || "").trim()
  if (!requestId || !reason) return
  try {
    await decideApprovalRequest({ requestId, decision: "reject", approver: { id: admin.id, role: "admin" }, reason })
  } catch {
    // See approveAction.
  }
  revalidatePath(`/dashboard/admin/governance/approvals/${requestId}`)
  revalidatePath("/dashboard/admin/governance")
}

async function cancelAction(formData: FormData) {
  "use server"
  const admin = await requireAdminAccess()
  const requestId = String(formData.get("requestId") || "")
  if (!requestId) return
  try {
    await cancelApprovalRequest({ requestId, actor: { id: admin.id, role: "admin" } })
  } catch {
    // See approveAction.
  }
  revalidatePath(`/dashboard/admin/governance/approvals/${requestId}`)
  revalidatePath("/dashboard/admin/governance")
}

function badgeClassForApprovalStatus(status: string) {
  if (status === "pending") return "bg-amber-600 text-white hover:bg-amber-600"
  if (status === "executed") return "bg-emerald-600 text-white hover:bg-emerald-600"
  if (["rejected", "execution_failed", "stale", "expired"].includes(status)) {
    return "bg-red-600 text-white hover:bg-red-600"
  }
  return "bg-slate-500 text-white hover:bg-slate-500"
}

export default async function ApprovalDetailPage({ params }: ApprovalDetailPageProps) {
  const admin = await requireAdminAccess()
  const { id } = await params

  const request = await getApprovalRequestById(id)
  if (!request) notFound()

  const approval = serializeApprovalRequest(request)
  const isOwnRequest = approval.requesterId === admin.id

  return (
    <div className="space-y-5">
      <PageHeader
        title="Approval request"
        subtitle={`${approval.operationType} · ${approval.targetType}/${approval.targetId}`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/admin/governance">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to governance
            </Link>
          </Button>
        }
      />

      <Card className="border-border/70">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Status</CardTitle>
          <Badge className={badgeClassForApprovalStatus(approval.status)}>{approval.status}</Badge>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="text-muted-foreground">Requester</p>
            <p className="text-foreground">
              {approval.requesterId} ({approval.requesterRole})
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Approver</p>
            <p className="text-foreground">{approval.approverId || "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Reason for request</p>
            <p className="text-foreground">{approval.reason}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Decision reason</p>
            <p className="text-foreground">{approval.decisionReason || "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Expires</p>
            <p className="text-foreground">{new Date(approval.expiresAt).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Executed</p>
            <p className="text-foreground">
              {approval.executedAt ? new Date(approval.executedAt).toLocaleString() : "—"}
            </p>
          </div>
          {approval.executionError && (
            <div className="md:col-span-2">
              <p className="text-muted-foreground">Execution error</p>
              <p className="text-foreground">{approval.executionError}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm">Before</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(approval.beforeState, null, 2)}
            </pre>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm">Proposed change</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(approval.afterState, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>

      {approval.status === "pending" && (
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-base">Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isOwnRequest ? (
              <>
                <p className="text-sm text-muted-foreground">
                  You requested this operation, so you cannot approve or reject it yourself. A different admin
                  must decide, or you can cancel it.
                </p>
                <form action={cancelAction}>
                  <input type="hidden" name="requestId" value={approval.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Cancel request
                  </Button>
                </form>
              </>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <form action={approveAction} className="space-y-2">
                  <input type="hidden" name="requestId" value={approval.id} />
                  <Textarea name="reason" placeholder="Optional approval note" rows={2} />
                  <Button type="submit" size="sm">
                    Approve &amp; execute
                  </Button>
                </form>
                <form action={rejectAction} className="space-y-2">
                  <input type="hidden" name="requestId" value={approval.id} />
                  <Textarea name="reason" placeholder="Rejection reason (required)" rows={2} required />
                  <Button type="submit" variant="destructive" size="sm">
                    Reject
                  </Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-base">Decision history</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm">
            {approval.history.map((event, index) => (
              <li key={index} className="rounded-md border border-border/60 p-2">
                <p className="font-medium text-foreground">{event.event}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(event.at).toLocaleString()}
                  {event.actorId ? ` · ${event.actorId}` : ""}
                </p>
                {event.reason && <p className="text-xs text-muted-foreground">Reason: {event.reason}</p>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {approval.resultRefs.length > 0 && (
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-base">Ledger / audit references</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {approval.resultRefs.map((ref, index) => (
                <li key={index}>
                  {ref.type}: {ref.id}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
