import { NextResponse } from "next/server";
import { validateReleaseManifest } from "@/lib/release/manifest";
import { runPreflightChecks } from "@/lib/release/preDeployChecks";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const manifestValidation = validateReleaseManifest(body);

    if (!manifestValidation.valid) {
      return NextResponse.json(
        { error: "Invalid release manifest", details: manifestValidation.errors },
        { status: 400 }
      );
    }

    const preflightResult = await runPreflightChecks(body);
    return NextResponse.json(preflightResult, {
      status: preflightResult.passed ? 200 : 412,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
