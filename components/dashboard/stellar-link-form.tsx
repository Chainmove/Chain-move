"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, Link2, Loader2, Sparkles, Unlink } from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const STRKEY_LENGTH = 56
const STRKEY_FORMAT = /^G[A-Z2-7]{55}$/

function isClientSideValidStellarKey(value: string): boolean {
  return value.length === STRKEY_LENGTH && STRKEY_FORMAT.test(value)
}

function truncateStellarKey(key: string): string {
  if (key.length <= 20) return key
  return `${key.slice(0, 10)}...${key.slice(-10)}`
}

interface StellarLinkFormProps {
  /** Called after a successful link so the parent can refresh profile data. */
  onLinked?: (stellarPublicKey: string) => void
}

export function StellarLinkForm({ onLinked }: StellarLinkFormProps) {
  const { user: authUser, refetch } = useAuth()
  const { toast } = useToast()

  const existingKey = authUser?.stellarPublicKey ?? null

  const [inputValue, setInputValue] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successKey, setSuccessKey] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  const linkedKey = successKey ?? existingKey

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value)
    setFieldError(null)
    setApiError(null)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmed = inputValue.trim()

    if (!trimmed) {
      setFieldError("Stellar public account is required.")
      return
    }

    if (!isClientSideValidStellarKey(trimmed)) {
      setFieldError(
        'Enter a valid Stellar public account — it must start with "G" and be exactly 56 characters.',
      )
      return
    }

    setIsSubmitting(true)
    setFieldError(null)
    setApiError(null)

    try {
      const response = await fetch("/api/auth/stellar/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stellarPublicKey: trimmed }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        const message =
          typeof payload?.message === "string"
            ? payload.message
            : response.status === 409
              ? "This Stellar account is already linked to another user."
              : "Unable to link your Stellar account. Please try again."
        setApiError(message)
        return
      }

      const linkedKeyValue: string = payload?.user?.stellarPublicKey ?? trimmed
      setSuccessKey(linkedKeyValue)
      setInputValue("")

      await refetch?.()
      onLinked?.(linkedKeyValue)

      toast({
        title: "Stellar account linked",
        description: `Public key ${truncateStellarKey(linkedKeyValue)} has been saved to your profile.`,
      })
    } catch {
      setApiError("A network error occurred. Check your connection and try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="border-border/70" data-testid="stellar-link-form">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          Stellar account
        </CardTitle>
        <CardDescription>
          Link your Stellar public account to enable on-chain activity tracking. Only enter your{" "}
          <strong>public key</strong> — never share your secret key.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Currently linked account display */}
        {linkedKey ? (
          <div
            className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between"
            data-testid="linked-account-display"
          >
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Currently linked account
              </p>
              <p className="mt-1 break-all font-mono text-sm font-medium text-foreground">
                {linkedKey}
              </p>
            </div>
            <Badge variant="green" className="shrink-0 self-start sm:self-center">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Linked
            </Badge>
          </div>
        ) : (
          <div
            className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground"
            data-testid="empty-state"
          >
            <Unlink className="mt-0.5 h-4 w-4 shrink-0" />
            <p>No Stellar account linked yet. Add your public key below to connect your account.</p>
          </div>
        )}

        {/* Warning about public key only */}
        <Alert variant="default" className="border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/10">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-amber-800 dark:text-amber-300">
            Only enter your <strong>public key</strong> (starts with &ldquo;G&rdquo;). Never enter your secret key or seed phrase here.
          </AlertDescription>
        </Alert>

        {/* Link form */}
        <form onSubmit={handleSubmit} noValidate className="space-y-4" data-testid="stellar-link-form-element">
          <div className="space-y-2">
            <Label htmlFor="stellar-public-key">
              {linkedKey ? "Update Stellar public account" : "Stellar public account"}
            </Label>
            <Input
              id="stellar-public-key"
              name="stellarPublicKey"
              value={inputValue}
              onChange={handleInputChange}
              placeholder="GABC...XYZ (56-character public key)"
              disabled={isSubmitting}
              aria-describedby={
                fieldError ? "stellar-field-error" : apiError ? "stellar-api-error" : undefined
              }
              aria-invalid={Boolean(fieldError)}
              className={fieldError ? "border-destructive focus-visible:ring-destructive" : ""}
              data-testid="stellar-key-input"
            />

            {fieldError ? (
              <p id="stellar-field-error" className="text-sm text-destructive" data-testid="field-error">
                {fieldError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Stellar public accounts are 56 characters and begin with &ldquo;G&rdquo;. This is safe to share.
              </p>
            )}
          </div>

          {/* API-level error */}
          {apiError ? (
            <p id="stellar-api-error" className="text-sm text-destructive" data-testid="api-error">
              {apiError}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
            data-testid="submit-button"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Linking account…
              </>
            ) : (
              <>
                <Link2 className="mr-2 h-4 w-4" />
                {linkedKey ? "Update account" : "Link account"}
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
