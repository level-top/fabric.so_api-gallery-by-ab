import { NextResponse } from "next/server";

export const runtime = "edge";

const DEFAULT_LIMIT = 12;
const TIMEOUT_MS = 20_000;

export async function GET(request: Request) {
    const url = new URL(request.url);

    const configuredSecret = (process.env.CRON_SECRET ?? "").trim();
    const providedSecret = (url.searchParams.get("token") ?? "").trim();

    if (configuredSecret && providedSecret !== configuredSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const origin = url.origin;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const started = Date.now();
    try {
        const resp = await fetch(`${origin}/api/fabric/resources`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ limit: DEFAULT_LIMIT }),
            signal: controller.signal,
        });

        const ms = Date.now() - started;

        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            return NextResponse.json(
                {
                    ok: false,
                    warmed: { resources: false },
                    status: resp.status,
                    ms,
                    detail: text.slice(0, 800),
                },
                { status: 502 },
            );
        }

        return NextResponse.json({ ok: true, warmed: { resources: true }, ms });
    } catch (e) {
        const ms = Date.now() - started;
        const aborted = e instanceof Error && e.name === "AbortError";
        return NextResponse.json(
            {
                ok: false,
                warmed: { resources: false },
                ms,
                error: aborted ? `Timeout after ${TIMEOUT_MS}ms` : e instanceof Error ? e.message : "Unknown error",
            },
            { status: aborted ? 504 : 500 },
        );
    } finally {
        clearTimeout(t);
    }
}
