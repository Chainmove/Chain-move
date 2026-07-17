import "server-only"

import { buildKeyring, getRedactedConfigDiagnostics, parseAppConfig } from "@/lib/config/schema"

const config = parseAppConfig()
const keyring = buildKeyring(config)

export function getServerConfig() {
  return config
}

export function getServerKeyring() {
  return keyring
}

export function getSafeConfigDiagnostics() {
  return getRedactedConfigDiagnostics(config, keyring)
}
