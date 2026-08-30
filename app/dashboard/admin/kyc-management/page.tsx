"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import {
  Loader2,
  CheckCircle,
  XCircle,
  FileText,
  Eye,
  RefreshCw,
  AlertTriangle,
  Calendar,
  Search,
  User,
  History,
  Clock,
  ArrowRight,
  ShieldAlert,
  Check,
  CalendarClock,
  MapPin,
  Mail,
  Phone,
  Wallet,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"

import { updateUserKycStatus } from "@/actions/user"

interface KycRequest {
  id: string
  role: "driver" | "investor" | "admin"
  name: string | null
  email: string | null
  phoneNumber: string | null
  kycStatus: "none" | "pending" | "approved_stage1" | "pending_stage2" | "approved_stage2" | "rejected"
  kycDocuments: string[]
  createdAt: string
  updatedAt: string
  kycRejectionReason?: string | null
  physicalMeetingDate?: string | null
  physicalMeetingStatus?: "none" | "scheduled" | "approved" | "rescheduled" | "completed" | "rejected_stage2"
}

interface AuditLogEntry {
  _id: string
  actorId?: string
  actorRole?: string
  action: string
  targetType: string
  targetId?: string
  status: string
  createdAt: string
  metadata?: Record<string, any>
}

function getRequestDisplayName(request: KycRequest) {
  return request.fullName?.trim() || request.name || request.email || "Unknown user"
}

export default function AdminKycManagementPage() {
  const { user: authUser, loading: authLoading } = useAuth()
  const { toast } = useToast()
  const router = useRouter()

  const [kycRequests, setKycRequests] = useState<KycRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filtering states
  const [searchQuery, setSearchQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState<"all" | "driver" | "investor">("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [stageFilter, setStageFilter] = useState<"all" | "stage1" | "stage2">("all")
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest")

  // Selected User review panel
  const [selectedRequest, setSelectedRequest] = useState<KycRequest | null>(null)
  const [auditTrail, setAuditTrail] = useState<AuditLogEntry[]>([])
  const [loadingAudit, setLoadingAudit] = useState(false)

  // Actions and confirmations
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false)
  const [actionType, setActionType] = useState<
    "approve_stage1" | "reject_stage1" | "approve_meeting_date" | "reschedule_meeting" | "complete_stage2" | "reject_stage2" | "schedule_initial_meeting" | null
  >(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rejectionReasonInput, setRejectionReasonInput] = useState("")
  const [meetingDateInput, setMeetingDateInput] = useState("")

  // Document Viewer Dialog
  const [isDocumentViewerOpen, setIsDocumentViewerOpen] = useState(false)
  const [currentDocumentUrl, setCurrentDocumentUrl] = useState<string | null>(null)
  const [currentDocumentLabel, setCurrentDocumentLabel] = useState<string>("Selected document")

  const fetchKycRequests = useCallback(async (autoSelectId?: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/kyc-requests")
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.message || "Failed to fetch KYC requests")
      }
      const data: KycRequest[] = await res.json()
      setKycRequests(data)

      // Retain or select user
      if (autoSelectId) {
        const found = data.find((req) => req._id === autoSelectId)
        if (found) {
          setSelectedRequest(found)
          fetchAuditTrail(found._id)
        }
      } else if (data.length > 0) {
        // Don't auto-select to keep layout clean, or auto-select first one. Let's auto-select first one.
        setSelectedRequest(data[0])
        fetchAuditTrail(data[0]._id)
      }
    } catch (err: any) {
      console.error("Error fetching KYC requests:", err)
      setError(err.message || "An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAuditTrail = async (userId: string) => {
    setLoadingAudit(true)
    try {
      const res = await fetch(`/api/admin/kyc-requests/${userId}/audit`)
      if (res.ok) {
        const data = await res.json()
        setAuditTrail(data)
      } else {
        setAuditTrail([])
      }
    } catch (error) {
      console.error("Error fetching audit trail:", error)
      setAuditTrail([])
    } finally {
      setLoadingAudit(false)
    }
  }

  useEffect(() => {
    if (!authLoading) {
      if (!authUser || authUser.role !== "admin") {
        toast({
          title: "Access Denied",
          description: "You must be an admin to view this page.",
          variant: "destructive",
        })
        router.replace("/signin")
      } else {
        fetchKycRequests()
      }
    }
  }, [authLoading, authUser, router, toast, fetchKycRequests])

  const selectRequest = (req: KycRequest) => {
    setSelectedRequest(req)
    fetchAuditTrail(req._id)
  }

  const triggerAction = (
    type: "approve_stage1" | "reject_stage1" | "approve_meeting_date" | "reschedule_meeting" | "complete_stage2" | "reject_stage2" | "schedule_initial_meeting",
  ) => {
    setActionType(type)
    setRejectionReasonInput("")
    setMeetingDateInput("")
    setIsConfirmDialogOpen(true)
  }

  const handleConfirmAction = async () => {
    if (!selectedRequest || !actionType) return

    // Rejection reason validation
    if ((actionType === "reject_stage1" || actionType === "reject_stage2") && !rejectionReasonInput.trim()) {
      toast({
        title: "Rejection Reason Required",
        description: "Please provide a reason for rejecting this KYC stage.",
        variant: "destructive",
      })
      return
    }

    // Meeting date validation
    if ((actionType === "schedule_initial_meeting" || actionType === "reschedule_meeting") && !meetingDateInput) {
      toast({
        title: "Meeting Date Required",
        description: "Please select a date for the physical meeting.",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    try {
      let newKycStatus = selectedRequest.kycStatus
      let newPhysicalMeetingStatus = selectedRequest.physicalMeetingStatus
      let newPhysicalMeetingDate = selectedRequest.physicalMeetingDate
        ? new Date(selectedRequest.physicalMeetingDate)
        : null
      let rejectionReason: string | null = null

      if (selectedRequest.role === "investor") {
        if (actionType === "approve_stage1") {
          newKycStatus = "approved_stage2"
          newPhysicalMeetingStatus = "none"
        } else if (actionType === "reject_stage1") {
          newKycStatus = "rejected"
          newPhysicalMeetingStatus = "none"
          rejectionReason = rejectionReasonInput.trim()
        }
      } else {
        // Driver flow
        switch (actionType) {
          case "approve_stage1":
            newKycStatus = "approved_stage1"
            break
          case "reject_stage1":
            newKycStatus = "rejected"
            rejectionReason = rejectionReasonInput.trim()
            break
          case "schedule_initial_meeting":
            newPhysicalMeetingStatus = "approved"
            newPhysicalMeetingDate = new Date(meetingDateInput)
            break
          case "approve_meeting_date":
            newPhysicalMeetingStatus = "approved"
            break
          case "reschedule_meeting":
            newPhysicalMeetingStatus = "rescheduled"
            newPhysicalMeetingDate = new Date(meetingDateInput)
            rejectionReason = rejectionReasonInput.trim() || "Rescheduled by admin"
            break
          case "complete_stage2":
            newKycStatus = "approved_stage2"
            newPhysicalMeetingStatus = "completed"
            break
          case "reject_stage2":
            newKycStatus = "rejected"
            newPhysicalMeetingStatus = "rejected_stage2"
            rejectionReason = rejectionReasonInput.trim()
            break
          default:
            break
        }
      }

      const res = await updateUserKycStatus(
        selectedRequest.id,
        newKycStatus,
        selectedRequest.documentReferences,
        rejectionReason,
        newPhysicalMeetingDate,
        newPhysicalMeetingStatus,
      )

      if (res.success) {
        toast({
          title: "Action Successful",
          description: `KYC for ${getRequestDisplayName(selectedRequest)} has been updated.`,
        })
        setIsConfirmDialogOpen(false)
        await fetchKycRequests(selectedRequest._id)
      } else {
        toast({
          title: "Action Failed",
          description: res.message || "Could not update user status.",
          variant: "destructive",
        })
      }
    } catch (err) {
      console.error("Action error:", err)
      toast({
        title: "Error",
        description: "An unexpected error occurred.",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const openDocumentViewer = (reference: string, label: string) => {
    setCurrentDocumentUrl(`/api/kyc-documents?ref=${encodeURIComponent(reference)}`)
    setCurrentDocumentLabel(label)
    setIsDocumentViewerOpen(true)
  }

  // Filter queue
  const filteredRequests = kycRequests
    .filter((req) => {
      const search = searchQuery.toLowerCase().trim()
      const matchesSearch =
        req.name.toLowerCase().includes(search) ||
        (req.fullName && req.fullName.toLowerCase().includes(search)) ||
        (req.email && req.email.toLowerCase().includes(search)) ||
        (req.phoneNumber && req.phoneNumber.includes(search))

      const matchesRole = roleFilter === "all" || req.role === roleFilter

      const matchesStatus = statusFilter === "all" || req.kycStatus === statusFilter

      let matchesStage = true
      if (stageFilter === "stage1") {
        matchesStage = ["pending", "approved_stage1", "rejected"].includes(req.kycStatus) && (!req.physicalMeetingStatus || req.physicalMeetingStatus === "none")
      } else if (stageFilter === "stage2") {
        matchesStage = ["pending_stage2", "approved_stage2", "rejected"].includes(req.kycStatus) && (req.physicalMeetingStatus && req.physicalMeetingStatus !== "none")
      }

      return matchesSearch && matchesRole && matchesStatus && matchesStage
    })
    .sort((a, b) => {
      const timeA = new Date(a.updatedAt).getTime()
      const timeB = new Date(b.updatedAt).getTime()
      return sortOrder === "newest" ? timeB - timeA : timeA - timeB
    })

  const getStatusBadge = (status: KycRequest["kycStatus"]) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20">Pending Stage 1</Badge>
      case "approved_stage1":
        return <Badge className="bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border-purple-500/20">Stage 1 Approved</Badge>
      case "pending_stage2":
        return <Badge className="bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border-sky-500/20">Pending Stage 2</Badge>
      case "approved_stage2":
        return <Badge className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20">Fully Verified</Badge>
      case "rejected":
        return <Badge className="bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border-rose-500/20">Rejected</Badge>
      default:
        return <Badge variant="secondary">None</Badge>
    }
  }

  const getMeetingBadge = (status: KycRequest["physicalMeetingStatus"]) => {
    if (!status || status === "none") return null
    switch (status) {
      case "scheduled":
        return <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">Meeting Scheduled</Badge>
      case "approved":
        return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Meeting Date Set</Badge>
      case "rescheduled":
        return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">Rescheduled</Badge>
      case "completed":
        return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Meeting Completed</Badge>
      case "rejected_stage2":
        return <Badge className="bg-rose-500/10 text-rose-500 border-rose-500/20">Meeting Rejected</Badge>
      default:
        return null
    }
  }

  if (authLoading || (authUser && authUser.role !== "admin")) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-[#E57700] mx-auto mb-4" />
          <h3 className="text-lg font-medium">Verifying access...</h3>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">KYC Review Center</h1>
          <p className="text-muted-foreground mt-1">Review driver & investor profile verifications, stage gates, and audit event logs.</p>
        </div>
        <Button onClick={() => fetchKycRequests()} variant="outline" className="border-border hover:bg-muted self-start md:self-auto gap-2">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin text-[#E57700]" : "h-4 w-4"} />
          Refresh Queue
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left column - Queue and Filters */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-4">
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                Review Queue
                <Badge className="bg-[#E57700]/10 text-[#E57700] border-none ml-2">
                  {filteredRequests.length} Active
                </Badge>
              </CardTitle>
              <CardDescription>Search and filter incoming verification requests.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search user, email, phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-background/50 border-border focus-visible:ring-[#E57700]"
                />
              </div>

              {/* Filters grid */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="space-y-1">
                  <label className="text-muted-foreground font-medium">Role</label>
                  <select
                    value={roleFilter}
                    onChange={(e: any) => setRoleFilter(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background/50 px-2 text-xs text-foreground focus:ring-[#E57700]"
                  >
                    <option value="all">All Roles</option>
                    <option value="driver">Driver</option>
                    <option value="investor">Investor</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-muted-foreground font-medium">Status</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background/50 px-2 text-xs text-foreground focus:ring-[#E57700]"
                  >
                    <option value="all">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved_stage1">Stage 1 Approved</option>
                    <option value="pending_stage2">Pending Stage 2</option>
                    <option value="approved_stage2">Stage 2 Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-muted-foreground font-medium">Stage</label>
                  <select
                    value={stageFilter}
                    onChange={(e: any) => setStageFilter(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background/50 px-2 text-xs text-foreground focus:ring-[#E57700]"
                  >
                    <option value="all">All Stages</option>
                    <option value="stage1">Stage 1 Review</option>
                    <option value="stage2">Stage 2 Review</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-muted-foreground font-medium">Sorting</label>
                  <select
                    value={sortOrder}
                    onChange={(e: any) => setSortOrder(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background/50 px-2 text-xs text-foreground focus:ring-[#E57700]"
                  >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Queue List */}
          <Card className="border-border bg-card shadow-sm">
            <ScrollArea className="h-[550px] rounded-md">
              <div className="p-2 space-y-1">
                {loading && kycRequests.length === 0 ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="p-3 border-b border-border/50 space-y-2 animate-pulse">
                      <div className="h-4 bg-muted rounded w-2/3" />
                      <div className="h-3 bg-muted rounded w-1/3" />
                    </div>
                  ))
                ) : filteredRequests.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground space-y-2">
                    <FileText className="h-10 w-10 mx-auto opacity-50" />
                    <p className="text-sm font-medium">No verification requests match your filters.</p>
                  </div>
                ) : (
                  filteredRequests.map((req) => {
                    const isSelected = selectedRequest?._id === req._id
                    return (
                      <button
                        key={req._id}
                        onClick={() => selectRequest(req)}
                        className={`w-full text-left p-3.5 rounded-lg transition-all border flex flex-col gap-1.5 ${
                          isSelected
                            ? "bg-[#E57700]/5 border-[#E57700] shadow-sm shadow-[#E57700]/5"
                            : "bg-background/40 hover:bg-muted/40 border-border/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground text-sm line-clamp-1">
                            {getRequestDisplayName(req)}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {new Date(req.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="capitalize text-[10px] py-0 px-1.5 font-normal">
                            {req.role}
                          </Badge>
                          {getStatusBadge(req.kycStatus)}
                          {getMeetingBadge(req.physicalMeetingStatus)}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </Card>
        </div>

        {/* Right column - User Review Panel & Timeline */}
        <div className="lg:col-span-7 xl:col-span-8">
          {selectedRequest ? (
            <div className="space-y-6">
              {/* Detailed User Review Panel */}
              <Card className="border-border bg-card shadow-sm overflow-hidden">
                <CardHeader className="bg-muted/30 border-b border-border/60 pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-xl font-bold text-foreground">
                          {getRequestDisplayName(selectedRequest)}
                        </CardTitle>
                        <Badge className="bg-[#E57700] text-white hover:bg-[#E57700]/90 uppercase text-[10px] font-bold tracking-wider">
                          {selectedRequest.role}
                        </Badge>
                      </div>
                      <CardDescription className="mt-1">
                        Review submissions, verify documents, and record approvals.
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {getStatusBadge(selectedRequest.kycStatus)}
                      {getMeetingBadge(selectedRequest.physicalMeetingStatus)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                  {/* Profile Info Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/20 p-4 rounded-xl border border-border/40">
                    <div className="flex items-start gap-3">
                      <Mail className="h-4 w-4 text-[#E57700] mt-1 shrink-0" />
                      <div className="space-y-0.5">
                        <span className="text-xs text-muted-foreground block font-medium">Email Address</span>
                        <span className="text-sm font-semibold text-foreground break-all">
                          {selectedRequest.email || "N/A"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Phone className="h-4 w-4 text-[#E57700] mt-1 shrink-0" />
                      <div className="space-y-0.5">
                        <span className="text-xs text-muted-foreground block font-medium">Phone Number</span>
                        <span className="text-sm font-semibold text-foreground">
                          {selectedRequest.phoneNumber || "N/A"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Calendar className="h-4 w-4 text-[#E57700] mt-1 shrink-0" />
                      <div className="space-y-0.5">
                        <span className="text-xs text-muted-foreground block font-medium">Registered Date</span>
                        <span className="text-sm font-semibold text-foreground">
                          {new Date(selectedRequest.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Clock className="h-4 w-4 text-[#E57700] mt-1 shrink-0" />
                      <div className="space-y-0.5">
                        <span className="text-xs text-muted-foreground block font-medium">Last State Update</span>
                        <span className="text-sm font-semibold text-foreground">
                          {new Date(selectedRequest.updatedAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Documents Section */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      Uploaded Documents
                    </h3>
                    {selectedRequest.kycDocuments && selectedRequest.kycDocuments.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {selectedRequest.kycDocuments.map((doc, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-3.5 bg-background border border-border rounded-xl hover:border-muted-foreground/30 transition-all group"
                          >
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-muted rounded-lg text-muted-foreground group-hover:text-[#E57700] group-hover:bg-[#E57700]/5 transition-all">
                                <FileText className="h-4 w-4" />
                              </div>
                              <span className="text-xs font-semibold text-foreground max-w-[140px] truncate">
                                Document {idx + 1}
                              </span>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDocumentViewer(doc, `KYC Submission Document ${idx + 1}`)}
                              className="h-8 border-border hover:bg-muted gap-1 text-xs"
                            >
                              <Eye className="h-3 w-3" />
                              View
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-6 bg-muted/10 border border-dashed border-border rounded-xl">
                        <ShieldAlert className="h-8 w-8 text-muted-foreground opacity-50 mb-2" />
                        <span className="text-xs text-muted-foreground">No documents uploaded yet.</span>
                      </div>
                    )}
                  </div>

                  <Separator className="bg-border/60" />

                  {/* KYC Stage Stepper / State Info */}
                  <div className="space-y-3 bg-[#E57700]/5 p-4 rounded-xl border border-[#E57700]/10">
                    <h3 className="text-xs font-bold text-[#E57700] uppercase tracking-wider flex items-center gap-1.5">
                      <Check className="h-4 w-4" />
                      Verification Actions
                    </h3>

                    {/* Pending review (Stage 1) Actions */}
                    {selectedRequest.kycStatus === "pending" && (
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground">
                          Review documents to approve profile Stage 1. Once approved, {selectedRequest.role === "driver" ? "physical meeting scheduling is unlocked" : "verification is completed"}.
                        </p>
                        <div className="flex flex-wrap gap-2.5">
                          <Button
                            onClick={() => triggerAction("approve_stage1")}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs h-9 gap-1.5"
                          >
                            <CheckCircle className="h-4 w-4" />
                            {selectedRequest.role === "investor" ? "Approve KYC" : "Approve Stage 1"}
                          </Button>
                          <Button
                            onClick={() => triggerAction("reject_stage1")}
                            variant="destructive"
                            className="bg-rose-600 hover:bg-rose-700 font-medium text-xs h-9 gap-1.5"
                          >
                            <XCircle className="h-4 w-4" />
                            Reject Submission
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Approved Stage 1 / Driver physical meeting actions */}
                    {selectedRequest.role === "driver" &&
                      (selectedRequest.kycStatus === "approved_stage1" || selectedRequest.kycStatus === "pending_stage2") &&
                      (selectedRequest.physicalMeetingStatus === "none" || selectedRequest.physicalMeetingStatus === "rescheduled") && (
                        <div className="space-y-3">
                          <p className="text-xs text-muted-foreground">
                            Stage 1 has been approved. Please select a physical meeting date to unlock final Stage 2 review.
                          </p>
                          <Button
                            onClick={() => triggerAction("schedule_initial_meeting")}
                            className="bg-[#E57700] hover:bg-[#E57700]/90 text-white font-medium text-xs h-9 gap-1.5"
                          >
                            <CalendarClock className="h-4 w-4" />
                            Schedule Physical Meeting
                          </Button>
                        </div>
                      )}

                    {/* Scheduled meeting review */}
                    {selectedRequest.role === "driver" &&
                      (selectedRequest.kycStatus === "approved_stage1" || selectedRequest.kycStatus === "pending_stage2") &&
                      selectedRequest.physicalMeetingStatus === "scheduled" && (
                        <div className="space-y-3">
                          <div className="p-3 bg-background rounded-lg border border-border flex items-start gap-3">
                            <Calendar className="h-5 w-5 text-[#E57700]" />
                            <div>
                              <span className="text-xs font-semibold text-foreground block">
                                Requested Physical Meeting Date
                              </span>
                              <span className="text-sm font-bold text-foreground">
                                {selectedRequest.physicalMeetingDate
                                  ? new Date(selectedRequest.physicalMeetingDate).toLocaleDateString("en-NG", {
                                      weekday: "long",
                                      year: "numeric",
                                      month: "long",
                                      day: "numeric",
                                    })
                                  : "No date set"}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2.5">
                            <Button
                              onClick={() => triggerAction("approve_meeting_date")}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs h-9 gap-1.5"
                            >
                              <CheckCircle className="h-4 w-4" />
                              Approve Meeting Date
                            </Button>
                            <Button
                              onClick={() => triggerAction("reschedule_meeting")}
                              variant="outline"
                              className="border-border hover:bg-muted font-medium text-xs h-9 gap-1.5"
                            >
                              <CalendarClock className="h-4 w-4 text-muted-foreground" />
                              Reschedule Meeting
                            </Button>
                          </div>
                        </div>
                      )}

                    {/* Stage 2 validation */}
                    {selectedRequest.role === "driver" &&
                      selectedRequest.kycStatus === "pending_stage2" &&
                      selectedRequest.physicalMeetingStatus === "approved" && (
                        <div className="space-y-3">
                          <div className="p-3.5 bg-background rounded-lg border border-border space-y-1.5">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-emerald-500" />
                              <span className="text-xs font-semibold text-foreground">Physical Meeting Approved</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Scheduled Date:{" "}
                              <span className="font-bold text-foreground">
                                {selectedRequest.physicalMeetingDate
                                  ? new Date(selectedRequest.physicalMeetingDate).toLocaleDateString()
                                  : "N/A"}
                              </span>
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Verify the driver's background check and completed meeting files. Approve to verify their profile, or reject with reason.
                          </p>
                          <div className="flex flex-wrap gap-2.5">
                            <Button
                              onClick={() => triggerAction("complete_stage2")}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs h-9 gap-1.5"
                            >
                              <CheckCircle className="h-4 w-4" />
                              Complete & Verify Profile
                            </Button>
                            <Button
                              onClick={() => triggerAction("reject_stage2")}
                              variant="destructive"
                              className="bg-rose-600 hover:bg-rose-700 font-medium text-xs h-9 gap-1.5"
                            >
                              <XCircle className="h-4 w-4" />
                              Reject Stage 2
                            </Button>
                          </div>
                        </div>
                      )}

                    {/* Rejection State banner */}
                    {selectedRequest.kycStatus === "rejected" && (
                      <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl space-y-1.5 text-rose-500">
                        <div className="flex items-center gap-2">
                          <ShieldAlert className="h-4 w-4 shrink-0" />
                          <span className="text-xs font-bold uppercase tracking-wider">KYC Rejected</span>
                        </div>
                        {selectedRequest.kycRejectionReason && (
                          <div className="text-xs space-y-1">
                            <span className="font-semibold block text-rose-500/90">Reason given:</span>
                            <p className="p-2.5 bg-background/50 rounded-lg text-foreground border border-rose-500/10 font-medium text-xs">
                              {selectedRequest.kycRejectionReason}
                            </p>
                          </div>
                        )}
                        <span className="text-[11px] text-muted-foreground block font-medium">
                          The user has been notified. They can resubmit updated documents from their dashboard.
                        </span>
                      </div>
                    )}

                    {/* Fully Approved banner */}
                    {selectedRequest.kycStatus === "approved_stage2" && (
                      <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-1 text-emerald-400">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 shrink-0" />
                          <span className="text-xs font-bold uppercase tracking-wider">Profile Fully Verified</span>
                        </div>
                        <span className="text-xs text-muted-foreground block font-medium">
                          KYC verification completed successfully. The user now has full functional access to the platform.
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Dynamic timeline / audit trail */}
              <Card className="border-border bg-card shadow-sm">
                <CardHeader className="pb-3 border-b border-border/60 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <History className="h-4 w-4 text-[#E57700]" />
                      Decision History & Audit Trail
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      Verifiable log of admin decisions and system events for this profile.
                    </CardDescription>
                  </div>
                  <Button
                    onClick={() => fetchAuditTrail(selectedRequest._id)}
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 hover:bg-muted"
                    disabled={loadingAudit}
                  >
                    <RefreshCw className={loadingAudit ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                  </Button>
                </CardHeader>
                <CardContent className="p-6">
                  {loadingAudit ? (
                    <div className="space-y-3">
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-6 w-2/3" />
                    </div>
                  ) : auditTrail.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground space-y-1">
                      <Clock className="h-8 w-8 mx-auto opacity-40 mb-1" />
                      <p className="text-xs font-medium">No admin decisions or audit logs found for this user.</p>
                    </div>
                  ) : (
                    <div className="relative pl-6 border-l border-border space-y-5">
                      {auditTrail.map((log) => (
                        <div key={log._id} className="relative text-xs">
                          {/* Indicator bullet */}
                          <span className="absolute -left-[30px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-background border border-[#E57700]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#E57700]" />
                          </span>

                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                            <span className="font-bold text-foreground">
                              {log.action.replace(/\./g, " ").toUpperCase()}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-medium shrink-0">
                              {new Date(log.createdAt).toLocaleString()}
                            </span>
                          </div>

                          <div className="text-muted-foreground mt-1.5 space-y-1">
                            <div className="flex flex-wrap gap-2 text-[10px] font-medium">
                              <Badge variant="outline" className="py-0 px-1 font-normal bg-muted">
                                Actor: {log.actorRole || "System"}
                              </Badge>
                              <Badge variant="outline" className="py-0 px-1 font-normal bg-muted">
                                Status: {log.status}
                              </Badge>
                            </div>
                            {log.metadata && (
                              <pre className="mt-1 p-2 bg-muted/40 rounded-lg text-[10px] font-mono overflow-x-auto border border-border/40 text-foreground max-w-full whitespace-pre-wrap">
                                {JSON.stringify(log.metadata, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="border-border border-dashed h-[500px] bg-background/20 flex flex-col items-center justify-center text-center p-6 shadow-none">
              <User className="h-12 w-12 text-muted-foreground opacity-30 mb-3" />
              <h3 className="font-semibold text-muted-foreground text-sm">Select a user to review</h3>
              <p className="text-xs text-muted-foreground max-w-[280px] mt-1.5 leading-normal">
                Click on any user in the left queue to view document links, make actions, and examine the decision trail.
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* Confirmation & Inputs Dialog */}
      <Dialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize text-foreground font-bold">
              {actionType?.replace(/_/g, " ")}
            </DialogTitle>
            <DialogDescription>
              Confirm this KYC change for{" "}
              <span className="font-bold text-foreground">
                {selectedRequest ? getRequestDisplayName(selectedRequest) : "the user"}
              </span>
              .
            </DialogDescription>
          </DialogHeader>

          {/* Date Picker Input */}
          {(actionType === "schedule_initial_meeting" || actionType === "reschedule_meeting") && (
            <div className="space-y-2 py-2">
              <Label htmlFor="meeting-date" className="text-xs font-bold">Preferred Physical Meeting Date</Label>
              <Input
                id="meeting-date"
                type="date"
                value={meetingDateInput}
                min={new Date(Date.now() + 86400000).toISOString().split("T")[0]}
                onChange={(e) => setMeetingDateInput(e.target.value)}
                className="bg-background border-border text-foreground text-xs"
              />
            </div>
          )}

          {/* Rejection / Reschedule Reason Input */}
          {(actionType === "reject_stage1" ||
            actionType === "reject_stage2" ||
            actionType === "reschedule_meeting") && (
            <div className="space-y-2 py-2">
              <Label htmlFor="rejection-reason" className="text-xs font-bold">
                {actionType === "reschedule_meeting" ? "Reason for Rescheduling" : "Reason for Rejection"}
              </Label>
              <Textarea
                id="rejection-reason"
                placeholder={
                  actionType === "reschedule_meeting"
                    ? "Provide a clear reason for the schedule change..."
                    : "Specify the detailed reasons for rejecting this KYC application..."
                }
                value={rejectionReasonInput}
                onChange={(e) => setRejectionReasonInput(e.target.value)}
                className="min-h-[100px] text-xs"
              />
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button
              variant="outline"
              onClick={() => setIsConfirmDialogOpen(false)}
              className="border-border hover:bg-muted text-xs h-9"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAction}
              disabled={isSubmitting}
              className={`text-xs h-9 font-medium text-white ${
                actionType?.includes("reject")
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  Updating...
                </>
              ) : (
                "Confirm & Execute"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document Viewer Dialog */}
      <Dialog open={isDocumentViewerOpen} onOpenChange={setIsDocumentViewerOpen}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-4">
          <DialogHeader className="pb-2 border-b">
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4 text-[#E57700]" />
              {currentDocumentLabel}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden relative bg-muted/40 rounded-lg border my-3">
            {currentDocumentUrl ? (
              <iframe src={currentDocumentUrl} className="w-full h-full border-0" title={currentDocumentLabel} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs font-semibold">
                No active document selected.
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0 shrink-0">
            <Button
              variant="outline"
              onClick={() => setIsDocumentViewerOpen(false)}
              className="border-border hover:bg-muted text-xs h-8"
            >
              Close
            </Button>
            {currentDocumentUrl && (
              <Button asChild className="bg-[#E57700] hover:bg-[#E57700]/90 text-xs h-8">
                <a href={currentDocumentUrl} target="_blank" rel="noopener noreferrer">
                  Open in New Tab
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
