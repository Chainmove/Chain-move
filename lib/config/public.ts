import { z } from "zod"

const publicConfigSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().optional(),
})

export type PublicConfig = z.infer<typeof publicConfigSchema>

export function getPublicConfig(raw = process.env): PublicConfig {
  return publicConfigSchema.parse(raw)
}
