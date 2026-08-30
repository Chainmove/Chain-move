import { createHash } from "crypto";

export interface CanaryConfig {
  releaseId: string;
  targetPercentage: number;
  active: boolean;
  probesPassed: number;
  probesFailed: number;
}

export function isUserInCanaryCohort(userId: string, targetPercentage: number): boolean {
  if (targetPercentage <= 0) return false;
  if (targetPercentage >= 100) return true;

  const hash = createHash("md5").update(userId).digest("hex");
  const num = parseInt(hash.substring(0, 8), 16);
  const bucket = num % 100;
  return bucket < targetPercentage;
}

export interface FinancialProbe {
  operation: string;
  run: () => Promise<boolean>;
}

export async function runCanaryProbes(probes: FinancialProbe[]): Promise<{
  allPassed: boolean;
  passedCount: number;
  failedCount: number;
  failures: string[];
}> {
  let passedCount = 0;
  let failedCount = 0;
  const failures: string[] = [];

  for (const probe of probes) {
    try {
      const ok = await probe.run();
      if (ok) {
        passedCount++;
      } else {
        failedCount++;
        failures.push(`Probe for ${probe.operation} failed execution check`);
      }
    } catch (err) {
      failedCount++;
      failures.push(`Probe for ${probe.operation} threw: ${(err as Error).message}`);
    }
  }

  return {
    allPassed: failedCount === 0,
    passedCount,
    failedCount,
    failures,
  };
}

export interface RollbackOutcome {
  triggered: boolean;
  reason: string;
  timestamp: string;
}

export function evaluateRollbackTrigger(
  errorRate: number,
  maxErrorRatePercentage = 2.0,
  probeFailures = 0
): RollbackOutcome {
  const timestamp = new Date().toISOString();
  if (probeFailures > 0) {
    return {
      triggered: true,
      reason: `Automated rollback triggered due to ${probeFailures} failed financial probes`,
      timestamp,
    };
  }
  if (errorRate > maxErrorRatePercentage) {
    return {
      triggered: true,
      reason: `Automated rollback triggered: error rate ${errorRate}% exceeds threshold ${maxErrorRatePercentage}%`,
      timestamp,
    };
  }
  return {
    triggered: false,
    reason: "Metrics healthy. Rollback not required.",
    timestamp,
  };
}
