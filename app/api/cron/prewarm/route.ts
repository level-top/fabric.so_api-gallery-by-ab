import { NextResponse } from "next/server";

import { getCachedHomeFeed, getHomeFeedTtlMs } from "@/lib/homeFeed";

export const runtime = "nodejs";

const TIMEOUT_MS = 20_000;

export async function GET(request: Request) {
    const url = new URL(request.url);

    const configuredSecret = (process.env.CRON_SECRET ?? "").trim();
    const providedSecret = (url.searchParams.get("token") ?? "").trim();

    if (configuredSecret && providedSecret !== configuredSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const started = Date.now();
    try {
        const refreshPromise = getCachedHomeFeed({ forceRefresh: true, allowStale: false });
        const abortPromise = new Promise<never>((_, reject) => {
            controller.signal.addEventListener(
                "abort",
                () => reject(new Error(`Timeout after ${TIMEOUT_MS}ms`)),
                { once: true },
            );
        });

        const payload = await Promise.race([refreshPromise, abortPromise]);

        const ms = Date.now() - started;

        return NextResponse.json({
            ok: true,
            warmed: { homeFeed: true },
            stale: payload.stale,
            resources: payload.resources.length,
            ttlMs: getHomeFeedTtlMs(),
            ms,
            refreshedAt: payload.refreshedAt,
        });
    } catch (e) {
        const ms = Date.now() - started;
        const aborted = e instanceof Error && e.message.includes("Timeout after");
        return NextResponse.json(
            {
                ok: false,
                warmed: { homeFeed: false },
                ms,
                error: aborted ? `Timeout after ${TIMEOUT_MS}ms` : e instanceof Error ? e.message : "Unknown error",
            },
            { status: aborted ? 504 : 500 },
        );
    } finally {
        clearTimeout(t);
    }
}
