import { NextResponse } from "next/server";

import { getCachedHomeFeed } from "@/lib/homeFeed";

export const runtime = "nodejs";

export async function GET() {
    try {
        const payload = await getCachedHomeFeed();
        return NextResponse.json(payload, {
            headers: {
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Unknown error" },
            { status: 500 },
        );
    }
}
