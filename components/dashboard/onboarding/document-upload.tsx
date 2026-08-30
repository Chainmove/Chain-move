"use client"

import type React from "react"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import {
  FileText,
  Upload,
  CheckCircle,
  Clock,
  AlertTriangle,
  Camera,
  CreditCard,
  Car,
  Shield,
  ArrowLeft,
  ArrowRight,
} from "lucide-react"

interface DocumentUploadProps {
  onNext: () => void
  onBack: () => void
}

interface Document {
  id: string
  name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  required: boolean
  status: "pending" | "uploaded" | "verified" | "rejected"
  file?: File
}

export function DocumentUpload({ onNext, onBack }: DocumentUploadProps) {
  const [documents, setDocuments] = useState<Document[]>([
    {
      id: "national-id",
      name: "National ID Card",
      description: "Government-issued identification card",
      icon: Shield,
      required: true,
      status: "pending",
    },
    {
      id: "drivers-license",
      name: "Driver's License",
      description: "Valid driving license",
      icon: Car,
      required: true,
      status: "pending",
    },
    {
      id: "bank-statement",
      name: "Bank Statement",
      description: "Last 3 months bank statement",
      icon: CreditCard,
      required: true,
      status: "pending",
    },
    {
      id: "proof-of-income",
      name: "Proof of Income",
      description: "Salary slip or business registration",
      icon: FileText,
      required: true,
      status: "pending",
    },
    {
      id: "utility-bill",
      name: "Utility Bill",
      description: "Recent utility bill for address verification",
      icon: FileText,
      required: false,
      status: "pending",
    },
    {
      id: "passport-photo",
      name: "Passport Photograph",
      description: "Recent passport-sized photograph",
      icon: Camera,
      required: true,
      status: "pending",
    },
  ])

  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null)
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const handleFileUpload = async (file: File) => {
    if (!selectedDocument) return

    setIsLoading(true)
    try {
      // Simulate file upload
      await new Promise((resolve) => setTimeout(resolve, 2000))

      setDocuments((prev) =>
        prev.map((doc) => (doc.id === selectedDocument.id ? { ...doc, status: "uploaded" as const, file } : doc)),
      )

      toast({
        title: "Document Uploaded",
        description: `${selectedDocument.name} has been uploaded successfully.`,
      })

      setIsUploadOpen(false)
      setSelectedDocument(null)
    } catch (error) {
      toast({
        title: "Upload Failed",
        description: "Failed to upload document. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      handleFileUpload(files[0])
    }
  }

  const getStatusIcon = (status: Document["status"]) => {
    switch (status) {
      case "uploaded":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case "verified":
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case "rejected":
        return <AlertTriangle className="h-4 w-4 text-red-500" />
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />
    }
  }

  const getStatusBadge = (status: Document["status"]) => {
    switch (status) {
      case "uploaded":
        return <Badge className="bg-blue-600 text-white">Uploaded</Badge>
      case "verified":
        return <Badge className="bg-green-600 text-white">Verified</Badge>
      case "rejected":
        return <Badge className="bg-red-600 text-white">Rejected</Badge>
      default:
        return <Badge variant="outline">Pending</Badge>
    }
  }

  const requiredDocuments = documents.filter((doc) => doc.required)
  const uploadedRequired = requiredDocuments.filter((doc) => doc.status === "uploaded" || doc.status === "verified")
  const canProceed = uploadedRequired.length === requiredDocuments.length

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground flex items-center">
          <FileText className="h-5 w-5 mr-2 text-[#E57700]" />
          Document Upload
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Upload required documents for KYC verification and car financing
        </CardDescription>
        <div className="flex items-center space-x-2 mt-2">
          <span className="text-sm text-muted-foreground">
            Progress: {uploadedRequired.length}/{requiredDocuments.length} required documents
          </span>
          <div className="flex-1 bg-muted rounded-full h-2">
            <div
              className="bg-[#E57700] h-2 rounded-full transition-all duration-300"
              style={{ width: `${(uploadedRequired.length / requiredDocuments.length) * 100}%` }}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {documents.map((document) => {
            const Icon = document.icon
            return (
              <div
                key={document.id}
                className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <Icon className="h-6 w-6 text-[#E57700]" />
                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 className="font-medium text-foreground">{document.name}</h4>
                      {document.required && (
                        <Badge variant="outline" className="text-xs">
                          Required
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{document.description}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  {getStatusIcon(document.status)}
                  {getStatusBadge(document.status)}

                  <Dialog
                    open={isUploadOpen && selectedDocument?.id === document.id}
                    onOpenChange={(open) => {
                      setIsUploadOpen(open)
                      if (!open) setSelectedDocument(null)
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        variant={document.status === "pending" ? "default" : "outline"}
                        onClick={() => setSelectedDocument(document)}
                        className={document.status === "pending" ? "bg-[#E57700] hover:bg-[#E57700]/90" : ""}
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        {document.status === "pending" ? "Upload" : "Replace"}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-card border-border text-foreground max-w-md mx-4">
                      <DialogHeader>
                        <DialogTitle className="flex items-center">
                          <Icon className="h-5 w-5 mr-2 text-[#E57700]" />
                          Upload {document.name}
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground">{document.description}</DialogDescription>
                      </DialogHeader>

                      <div className="space-y-4">
                        <div
                          className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-[#E57700] transition-colors cursor-pointer"
                          onDragOver={handleDragOver}
                          onDrop={handleDrop}
                          onClick={() => {
                            const input = (document as any).createElement("input")
                            input.type = "file"
                            input.accept = "image/*,.pdf"
                            input.onchange = (e: any) => {
                              const file = (e.target as HTMLInputElement).files?.[0]
                              if (file) handleFileUpload(file)
                            }
                            input.click()
                          }}
                        >
                          <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                          <p className="text-foreground font-medium mb-2">
                            {isLoading ? "Uploading..." : "Click to upload or drag and drop"}
                          </p>
                          <p className="text-sm text-muted-foreground">PNG, JPG, PDF up to 10MB</p>
                        </div>

                        <div className="bg-muted p-3 rounded-lg">
                          <h5 className="font-medium text-foreground mb-2">Upload Guidelines:</h5>
                          <ul className="text-sm text-muted-foreground space-y-1">
                            <li>• Ensure document is clear and readable</li>
                            <li>• All corners should be visible</li>
                            <li>• No glare or shadows</li>
                            <li>• File size should not exceed 10MB</li>
                          </ul>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex justify-between pt-6">
          <Button type="button" variant="outline" onClick={onBack} className="flex items-center">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={onNext} disabled={!canProceed} className="bg-[#E57700] hover:bg-[#E57700]/90 text-white">
            Complete Verification
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
