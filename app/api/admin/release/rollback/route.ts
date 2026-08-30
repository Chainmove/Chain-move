import { NextResponse } from "next/server";
import { evaluateRollbackTrigger } from "@/lib/release/canary";

export async function POST(request: Request) {
  try {
    const { errorRate = 0, probeFailures = 0, maxErrorRatePercentage = 2.0 } = await request.json();
    const outcome = evaluateRollbackTrigger(errorRate, maxErrorRatePercentage, probeFailures);

    return NextResponse.json({
      rollback: outcome,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
