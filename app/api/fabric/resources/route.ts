import { NextResponse } from "next/server";

import { FabricApiError, fabricFetch } from "@/lib/fabric";

export const runtime = "nodejs";
export const maxDuration = 30;

const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

type CacheEntry = { ts: number; data: unknown };
const responseCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

type ResourcesFilterRequest = {
  tagId?: string;
  cursor?: string;
  limit?: number;
  createdAfter?: string;
  createdBefore?: string;
};

const FABRIC_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | ResourcesFilterRequest
    | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tagId = (body.tagId ?? "").trim();
  const cursor = (body.cursor ?? "").trim();
  const limit = Math.min(Math.max(body.limit ?? 20, 1), 50);
  const createdAfter = (body.createdAfter ?? "").trim();
  const createdBefore = (body.createdBefore ?? "").trim();

  if (createdAfter && Number.isNaN(Date.parse(createdAfter))) {
    return NextResponse.json(
      { error: "createdAfter must be a valid date string (ISO or YYYY-MM-DD)." },
      { status: 400 },
    );
  }

  if (createdBefore && Number.isNaN(Date.parse(createdBefore))) {
    return NextResponse.json(
      { error: "createdBefore must be a valid date string (ISO or YYYY-MM-DD)." },
      { status: 400 },
    );
  }

  if (tagId && !FABRIC_UUID_REGEX.test(tagId)) {
    return NextResponse.json(
      {
        error:
          "tagId must be a Fabric tag ID (UUID). Tip: fetch it via GET /v2/tags and use data.tags[].id (not the tag name).",
      },
      { status: 400 },
    );
  }

  // Keep the request intentionally light; some accounts time out when asking
  // for descendants across large libraries.
  const createFabricBody = (bodyLimit: number) => ({
    kind: ["image", "video"],
    ...(tagId ? { tagIds: [tagId] } : {}),
    ...(createdAfter ? { createdAfter } : {}),
    ...(createdBefore ? { createdBefore } : {}),
    includeSubfolderCount: false,
    limit: bodyLimit,
    ...(cursor ? { cursor } : {}),
    order: {
      property: "createdAt",
      direction: "DESC",
    },
  });

  const cacheKey = JSON.stringify({ tagId, cursor, limit, createdAfter, createdBefore });
  const now = Date.now();
  const cached = responseCache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  }

  try {
    const existing = inflight.get(cacheKey);
    const work =
      existing ??
      (async () => {
        const attempt = async (bodyLimit: number, timeoutMs: number) => {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), timeoutMs);
          try {
            return await fabricFetch<unknown>("/v2/resources/filter", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(createFabricBody(bodyLimit)),
              signal: controller.signal,
            });
          } finally {
            clearTimeout(t);
          }
        };

        try {
          return await attempt(limit, REQUEST_TIMEOUT_MS);
        } catch (error) {
          const aborted = error instanceof Error && error.name === "AbortError";
          const gatewayTimeout = error instanceof FabricApiError && error.status === 504;
          if (aborted || gatewayTimeout) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            return await attempt(Math.min(limit, 10), REQUEST_TIMEOUT_MS);
          }
          throw error;
        }
      })();

    if (!existing) inflight.set(cacheKey, work);

    const data = await work;
    responseCache.set(cacheKey, { ts: Date.now(), data });
    inflight.delete(cacheKey);

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    inflight.delete(cacheKey);
    if (error instanceof FabricApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
