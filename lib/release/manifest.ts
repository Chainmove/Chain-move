export interface ReleaseManifest {
  releaseId: string;
  releaseTag: string;
  contractAddress: string;
  wasmHash: string;
  networkPassphrase: string;
  dbSchemaVersion: string;
  canaryPercentage: number;
  createdAt: string;
  requiredChecks: {
    backupFreshness: boolean;
    dryRunMigration: boolean;
    contractIdentity: boolean;
  };
}

export function validateReleaseManifest(manifest: Partial<ReleaseManifest>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!manifest.releaseId) errors.push("releaseId is required");
  if (!manifest.releaseTag) errors.push("releaseTag is required");
  if (!manifest.contractAddress || !/^C[A-Z0-9]{55}$/.test(manifest.contractAddress)) {
    errors.push("Valid Stellar contractAddress is required");
  }
  if (!manifest.wasmHash || manifest.wasmHash.length < 16) {
    errors.push("Valid WASM hash is required");
  }
  if (!manifest.networkPassphrase) errors.push("networkPassphrase is required");
  if (manifest.canaryPercentage === undefined || manifest.canaryPercentage < 0 || manifest.canaryPercentage > 100) {
    errors.push("canaryPercentage must be between 0 and 100");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
