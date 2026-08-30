import { getRedactedConfigDiagnostics, parseAppConfig, buildKeyring } from "@/lib/config/schema"

const config = parseAppConfig(process.env)
console.log(JSON.stringify(getRedactedConfigDiagnostics(config, buildKeyring(config)), null, 2))
