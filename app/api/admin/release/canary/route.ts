import { NextResponse } from "next/server";
import { isUserInCanaryCohort } from "@/lib/release/canary";

export async function POST(request: Request) {
  try {
    const { userId, canaryPercentage = 10 } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const inCohort = isUserInCanaryCohort(userId, canaryPercentage);
    return NextResponse.json({ userId, canaryPercentage, inCohort });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
