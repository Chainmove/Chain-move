"use client"

import { useState, useEffect, useCallback } from "react"

export interface AuthUser {
  notifications?: Array<{
    id: string
    title: string
    message: string
    read: boolean
    timestamp: string
    link?: string
  }>
  id: string
  name?: string
  fullName?: string
  email?: string
  phoneNumber?: string
  privyUserId?: string
  address?: string | null
  bio?: string | null
  role?: string
  walletAddress?: string
  stellarPublicKey?: string
  availableBalance?: number
  totalInvested?: number
  totalReturns?: number
  createdAt?: string | null
  kycStatus?: string
  kycDocuments?: string[]
  kycRejectionReason?: string | null
  physicalMeetingDate?: string | null
  physicalMeetingStatus?: string
  isKycVerified?: boolean
  kycVerified?: boolean
}

export function getUserDisplayName(
  user: Pick<AuthUser, "name" | "fullName" | "email"> | null | undefined,
  fallbackLabel = "User",
): string {
  if (!user) {
    return fallbackLabel
  }

  if (user.fullName && user.fullName.trim().length > 0) {
    return user.fullName.trim()
  }

  if (user.name && user.name.trim().length > 0) {
    return user.name.trim()
  }

  if (user.email && user.email.includes("@")) {
    return user.email.split("@")[0]
  }

  return fallbackLabel
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  // Wrap fetchCurrentUser in useCallback to make it stable
  const fetchCurrentUser = useCallback(async () => {
    setLoading(true)
    try {
      // This endpoint should return the full user object from your database
      const response = await fetch("/api/auth/me", { cache: "no-store" })
      if (response.ok) {
        const userData = await response.json()
        setUser(userData)
      } else {
        // If response is not ok (e.g., 401 Unauthorized, 404 Not Found), clear user
        setUser(null)
        console.warn("Failed to fetch current user:", response.status, response.statusText)
      }
    } catch (error) {
      console.error("Error fetching current user:", error)
      setUser(null) // Clear user on network error
    } finally {
      setLoading(false)
    }
  }, []) // No dependencies, so this function is stable

  useEffect(() => {
    fetchCurrentUser()
  }, [fetchCurrentUser]) // Depend on the stable fetchCurrentUser

  // Expose a refetch function to manually trigger data re-fetching
  const refetch = useCallback(() => {
    fetchCurrentUser()
  }, [fetchCurrentUser]) // Depend on the stable fetchCurrentUser

  return { user, loading, setUser, refetch } // Return refetch
}
