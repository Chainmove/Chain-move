"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ExternalLink, Loader2, Mail, MapPin, Phone, User } from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { StellarLinkForm } from "@/components/dashboard/stellar-link-form"
import { formatNaira } from "@/lib/currency"
import { getWalletDisplay } from "@/lib/wallet/config"

interface AccountSettingsFormProps {
  roleLabel: "Driver" | "Investor"
  kycHref: string
}

interface SettingsFormState {
  fullName: string
  email: string
  phoneNumber: string
  address: string
  bio: string
}

interface AccountProfileResponse {
  id: string
  name: string
  fullName: string
  email: string | null
  phoneNumber: string | null
  privyUserId: string | null
  address: string | null
  bio: string | null
  role: string
  walletAddress: string | null
  stellarPublicKey: string | null
  availableBalance: number
  totalInvested: number
  totalReturns: number
  createdAt: string | null
}

const INITIAL_FORM_STATE: SettingsFormState = {
  fullName: "",
  email: "",
  phoneNumber: "",
  address: "",
  bio: "",
}

export function AccountSettingsForm({ roleLabel, kycHref }: AccountSettingsFormProps) {
  const { toast } = useToast()
  const { user: authUser, refetch } = useAuth()
  const [profile, setProfile] = useState<AccountProfileResponse | null>(null)
  const [form, setForm] = useState<SettingsFormState>(INITIAL_FORM_STATE)
  const [isLoadingProfile, setIsLoadingProfile] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const applyProfileToForm = useCallback((nextProfile: Partial<AccountProfileResponse>) => {
    setForm({
      fullName: nextProfile.fullName || nextProfile.name || "",
      email: nextProfile.email || "",
      phoneNumber: nextProfile.phoneNumber || "",
      address: nextProfile.address || "",
      bio: nextProfile.bio || "",
    })
  }, [])

  useEffect(() => {
    if (!authUser) return

    setProfile((current) =>
      current || {
        id: authUser.id,
        name: authUser.name || "",
        fullName: authUser.fullName || authUser.name || "",
        email: authUser.email || null,
        phoneNumber: authUser.phoneNumber || null,
        privyUserId: authUser.privyUserId || null,
        address: authUser.address || null,
        bio: authUser.bio || null,
        role: authUser.role || roleLabel.toLowerCase(),
        walletAddress: authUser.walletAddress || null,
        stellarPublicKey: authUser.stellarPublicKey || null,
        availableBalance: Number(authUser.availableBalance || 0),
        totalInvested: Number(authUser.totalInvested || 0),
        totalReturns: Number(authUser.totalReturns || 0),
        createdAt: authUser.createdAt || null,
      },
    )
    applyProfileToForm(authUser)
  }, [applyProfileToForm, authUser, roleLabel])

  const loadProfile = useCallback(async () => {
    setIsLoadingProfile(true)
    setProfileError(null)

    try {
      const response = await fetch("/api/account/profile", { cache: "no-store" })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
            ? payload.message
            : "Unable to load your account profile.",
        )
      }

      const nextProfile = payload.profile as AccountProfileResponse
      setProfile(nextProfile)
      applyProfileToForm(nextProfile)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Unable to load your account profile.")
    } finally {
      setIsLoadingProfile(false)
    }
  }, [applyProfileToForm])

  useEffect(() => {
    if (!authUser?.id) return
    void loadProfile()
  }, [authUser?.id, loadProfile])

  const isEmailManagedExternally = Boolean(profile?.privyUserId || authUser?.privyUserId)
  const walletDisplay = getWalletDisplay({
    embeddedWalletAddress: profile?.walletAddress || authUser?.walletAddress,
    stellarPublicKey: profile?.stellarPublicKey || authUser?.stellarPublicKey,
  })

  const handleSave = async () => {
    if (!form.fullName.trim()) {
      toast({
        title: "Full name required",
        description: "Enter your full name before saving settings.",
        variant: "destructive",
      })
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message || "Unable to update your profile settings.")
      }

      if (payload.profile) {
        setProfile(payload.profile)
        applyProfileToForm(payload.profile)
      }

      await refetch?.()

      toast({
        title: "Settings updated",
        description: "Your profile information has been saved.",
      })
    } catch (error) {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Unable to update your profile settings.",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile Settings
          </CardTitle>
          <CardDescription>
            Update your normal account details here. This page reads and writes directly to your saved user record in MongoDB.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {profileError ? <p className="text-sm text-destructive">{profileError}</p> : null}
          <div className="space-y-2">
            <Label htmlFor={`${roleLabel.toLowerCase()}-full-name`}>Full name</Label>
            <Input
              id={`${roleLabel.toLowerCase()}-full-name`}
              value={form.fullName}
              onChange={(event) => setForm((previous) => ({ ...previous, fullName: event.target.value }))}
              placeholder={`Enter your ${roleLabel.toLowerCase()} name`}
              disabled={isSaving || isLoadingProfile}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${roleLabel.toLowerCase()}-email`}>Email</Label>
            <Input
              id={`${roleLabel.toLowerCase()}-email`}
              type="email"
              value={form.email}
              disabled={isEmailManagedExternally || isSaving || isLoadingProfile}
              onChange={(event) => setForm((previous) => ({ ...previous, email: event.target.value }))}
              placeholder="you@example.com"
            />
            <p className="text-xs text-muted-foreground">
              {isEmailManagedExternally
                ? "This email is managed by your Privy account and cannot be changed from Settings."
                : "Use the email tied to your account and payment/contact updates."}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${roleLabel.toLowerCase()}-phone`}>Phone number</Label>
              <Input
                id={`${roleLabel.toLowerCase()}-phone`}
                value={form.phoneNumber}
                onChange={(event) => setForm((previous) => ({ ...previous, phoneNumber: event.target.value }))}
                placeholder="+234..."
                disabled={isSaving || isLoadingProfile}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${roleLabel.toLowerCase()}-address`}>Address</Label>
              <Input
                id={`${roleLabel.toLowerCase()}-address`}
                value={form.address}
                onChange={(event) => setForm((previous) => ({ ...previous, address: event.target.value }))}
                placeholder="Street, city, state"
                disabled={isSaving || isLoadingProfile}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${roleLabel.toLowerCase()}-bio`}>Profile note</Label>
            <Textarea
              id={`${roleLabel.toLowerCase()}-bio`}
              rows={4}
              value={form.bio}
              onChange={(event) => setForm((previous) => ({ ...previous, bio: event.target.value }))}
              placeholder="Tell us a little about this account."
              disabled={isSaving || isLoadingProfile}
            />
          </div>

          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isLoadingProfile}
            className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
          >
            {isSaving || isLoadingProfile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isLoadingProfile ? "Loading saved profile..." : isSaving ? "Saving..." : "Save settings"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <StellarLinkForm onLinked={() => void loadProfile()} />

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>Account Snapshot</CardTitle>
            <CardDescription>Live account data from your stored user record.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="rounded-lg border border-border/70 p-3">
              <p><span className="text-foreground">Role:</span> {profile?.role || authUser?.role || roleLabel.toLowerCase()}</p>
              <p className="mt-1 break-all"><span className="text-foreground">{walletDisplay.addressLabel}:</span> {walletDisplay.address || "Not linked"}</p>
              <p className="mt-1"><span className="text-foreground">Network:</span> {walletDisplay.networkLabel}</p>
            </div>
            <div className="rounded-lg border border-border/70 p-3">
              <p><span className="text-foreground">Internal balance:</span> {formatNaira(Number(profile?.availableBalance || authUser?.availableBalance || 0))}</p>
              <p className="mt-1"><span className="text-foreground">Total invested:</span> {formatNaira(Number(profile?.totalInvested || authUser?.totalInvested || 0))}</p>
              <p className="mt-1"><span className="text-foreground">Total returns:</span> {formatNaira(Number(profile?.totalReturns || authUser?.totalReturns || 0))}</p>
            </div>
            <div className="rounded-lg border border-border/70 p-3">
              <p><span className="text-foreground">Joined:</span> {profile?.createdAt ? new Date(profile.createdAt).toLocaleString() : "Unknown"}</p>
              <p className="mt-1"><span className="text-foreground">Email source:</span> {isEmailManagedExternally ? "Privy-managed" : "Editable from settings"}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>Settings vs KYC</CardTitle>
            <CardDescription>Keep profile changes and verification changes separate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-3 rounded-lg border border-border/70 p-3">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
              <p>Use this page for contact and profile details that should save directly to your user account.</p>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border/70 p-3">
              <Phone className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
              <p>KYC documents, approval, rejection, and compliance review are handled on the dedicated KYC page.</p>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border/70 p-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
              <p>Profile updates here do not change KYC status, documents, or admin verification decisions.</p>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border/70 p-3">
              <User className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
              <p>Account deletion is not self-service here. Admin-managed delete flows remain separate from profile settings.</p>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href={kycHref}>
                Open KYC
                <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
