import Link from "next/link"
import { revalidatePath } from "next/cache"
import { CalendarClock, Save } from "lucide-react"

import { PageHeader } from "@/components/dashboard/admin/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import dbConnect from "@/lib/dbConnect"
import PlatformSetting from "@/models/PlatformSetting"
import { requireAdminAccess } from "@/src/server/admin/require-admin"
import { listApprovalRequests, decideApprovalRequest, cancelApprovalRequest } from "@/lib/approvals/service"

export const dynamic = "force-dynamic"

async function approveApprovalAction(formData: FormData) {
  "use server"
  const admin = await requireAdminAccess()
  const requestId = String(formData.get("requestId") || "")
  if (!requestId) return
  try {
    await decideApprovalRequest({ requestId, decision: "approve", approver: { id: admin.id, role: "admin" } })
  } catch {
    // Swallowed: the queue re-renders below and reflects the request's actual
    // resulting status (e.g. still "pending" if this failed self-approval,
    // staleness, or a conflicting concurrent decision).
  }
  revalidatePath("/dashboard/admin/governance")
}

async function rejectApprovalAction(formData: FormData) {
  "use server"
  const admin = await requireAdminAccess()
  const requestId = String(formData.get("requestId") || "")
  const reason = String(formData.get("reason") || "").trim()
  if (!requestId || !reason) return
  try {
    await decideApprovalRequest({ requestId, decision: "reject", approver: { id: admin.id, role: "admin" }, reason })
  } catch {
    // See approveApprovalAction.
  }
  revalidatePath("/dashboard/admin/governance")
}

async function cancelApprovalAction(formData: FormData) {
  "use server"
  const admin = await requireAdminAccess()
  const requestId = String(formData.get("requestId") || "")
  if (!requestId) return
  try {
    await cancelApprovalRequest({ requestId, actor: { id: admin.id, role: "admin" } })
  } catch {
    // See approveApprovalAction.
  }
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

async function saveSettingsAction(formData: FormData) {
  "use server"

  const admin = await requireAdminAccess()
  await dbConnect()

  const minimumContributionNgn = Number.parseFloat(String(formData.get("minimumContributionNgn") || "0"))
  const platformFeeRateBps = Number.parseFloat(String(formData.get("platformFeeRateBps") || "0"))
  const defaultRepaymentDurationWeeks = Number.parseInt(String(formData.get("defaultRepaymentDurationWeeks") || "0"), 10)
  const defaultRoiPercent = Number.parseFloat(String(formData.get("defaultRoiPercent") || "0"))

  if (
    !Number.isFinite(minimumContributionNgn) ||
    minimumContributionNgn < 0 ||
    !Number.isFinite(platformFeeRateBps) ||
    platformFeeRateBps < 0 ||
    platformFeeRateBps > 10000 ||
    !Number.isFinite(defaultRepaymentDurationWeeks) ||
    defaultRepaymentDurationWeeks < 1 ||
    !Number.isFinite(defaultRoiPercent) ||
    defaultRoiPercent < 0 ||
    defaultRoiPercent > 100
  ) {
    return
  }

  await PlatformSetting.findOneAndUpdate(
    { singletonKey: "default" },
    {
      minimumContributionNgn,
      platformFeeRateBps,
      defaultRepaymentDurationWeeks,
      defaultRoiPercent,
      updatedByUserId: admin.id,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  revalidatePath("/dashboard/admin/governance")
}

export default async function AdminGovernancePage() {
  const admin = await requireAdminAccess()
  await dbConnect()

  const settings = await PlatformSetting.findOne({ singletonKey: "default" }).lean()
  const { requests: approvalRequests } = await listApprovalRequests({ pageSize: 25 })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Governance"
        subtitle="Platform-level configuration and governance controls."
      />

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-base">Platform Settings</CardTitle>
          <CardDescription>
            Configure minimum contribution, fee rate, repayment defaults, and baseline ROI assumptions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveSettingsAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Minimum contribution per pool (NGN)</span>
              <input
                name="minimumContributionNgn"
                defaultValue={settings?.minimumContributionNgn ?? 5000}
                required
                inputMode="decimal"
                className="h-10 w-full rounded-md border border-input bg-background px-3"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Platform fee rate (basis points)</span>
              <input
                name="platformFeeRateBps"
                defaultValue={settings?.platformFeeRateBps ?? 250}
                required
                inputMode="decimal"
                className="h-10 w-full rounded-md border border-input bg-background px-3"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Default repayment duration (weeks)</span>
              <input
                name="defaultRepaymentDurationWeeks"
                defaultValue={settings?.defaultRepaymentDurationWeeks ?? 52}
                required
                inputMode="numeric"
                className="h-10 w-full rounded-md border border-input bg-background px-3"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Default ROI assumption (%)</span>
              <input
                name="defaultRoiPercent"
                defaultValue={settings?.defaultRoiPercent ?? 24}
                required
                inputMode="decimal"
                className="h-10 w-full rounded-md border border-input bg-background px-3"
              />
            </label>

            <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarClock className="h-4 w-4" />
                Last updated: {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString() : "Not updated yet"}
              </p>
              <Button type="submit">
                <Save className="mr-2 h-4 w-4" />
                Save settings
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-base">Maker-Checker Approvals</CardTitle>
          <CardDescription>
            Sensitive admin operations (reconciliation remediation, data-integrity repair, and admin role
            reassignment) wait here for a second, distinct admin to approve or reject before they take effect.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {approvalRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No approval requests yet.</p>
          ) : (
            <div className="max-h-[520px] overflow-auto rounded-lg border border-border/60">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                  <tr className="border-b border-border/60 text-left">
                    <th className="px-3 py-2 font-medium text-muted-foreground">Operation</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Target</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Requester</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Expires</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {approvalRequests.map((approval) => {
                    const requestId = approval._id.toString()
                    const isOwnRequest = approval.requesterId === admin.id
                    return (
                      <tr key={requestId} className="border-b border-border/50 align-top">
                        <td className="px-3 py-2">
                          <p className="font-medium text-foreground">{approval.operationType}</p>
                          <p className="text-xs text-muted-foreground">{approval.riskLevel} risk</p>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {approval.targetType}
                          <br />
                          <span className="text-xs">{approval.targetId}</span>
                        </td>
                        <td className="px-3 py-2">
                          <Badge className={badgeClassForApprovalStatus(approval.status)}>{approval.status}</Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{isOwnRequest ? "You" : approval.requesterId}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(approval.expiresAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col items-end gap-2">
                            <Button asChild variant="ghost" size="sm" className="h-7">
                              <Link href={`/dashboard/admin/governance/approvals/${requestId}`}>View</Link>
                            </Button>
                            {approval.status === "pending" && !isOwnRequest && (
                              <>
                                <form action={approveApprovalAction}>
                                  <input type="hidden" name="requestId" value={requestId} />
                                  <Button type="submit" size="sm" className="h-7">
                                    Approve
                                  </Button>
                                </form>
                                <form action={rejectApprovalAction} className="flex items-center gap-1">
                                  <input type="hidden" name="requestId" value={requestId} />
                                  <input
                                    name="reason"
                                    placeholder="Reason"
                                    required
                                    className="h-7 w-28 rounded-md border border-input bg-background px-2 text-xs"
                                  />
                                  <Button type="submit" size="sm" variant="outline" className="h-7">
                                    Reject
                                  </Button>
                                </form>
                              </>
                            )}
                            {approval.status === "pending" && isOwnRequest && (
                              <form action={cancelApprovalAction}>
                                <input type="hidden" name="requestId" value={requestId} />
                                <Button type="submit" size="sm" variant="outline" className="h-7">
                                  Cancel
                                </Button>
                              </form>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

