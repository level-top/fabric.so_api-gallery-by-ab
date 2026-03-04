import { NextResponse } from "next/server";

import { fabricFetch, FabricApiError } from "@/lib/fabric";

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const id = (searchParams.get("id") ?? "").trim();

    if (!id) {
        return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    try {
        const resource = await fabricFetch<any>(`/v2/resources/${encodeURIComponent(id)}`, {
            method: "GET",
        });

        return NextResponse.json({ resource }, { status: 200 });
    } catch (e) {
        if (e instanceof FabricApiError) {
            return NextResponse.json(
                { error: e.message },
                { status: e.status || 500 },
            );
        }

        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
