import { NextRequest, NextResponse } from "next/server";

import { fabricFetch } from "@/lib/fabric";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Mode = "similar-image" | "semantic-image";

type SimilarMeta = {
  strategy: "text";
  queryResourceId?: string;
};

type HitsCacheEntry = {
  hits: any[];
  meta: SimilarMeta;
  warning?: string;
  expiresAt: number;
};

// Cache Similar hits per resource for a bit to reduce repeated expensive work.
// This also helps avoid repeated long waits when navigating back/forward.
const HITS_CACHE_TTL_MS = 5 * 60 * 1000;
const hitsCache: Map<string, HitsCacheEntry> = new Map();

function jsonNoStore(body: any, init?: Parameters<typeof NextResponse.json>[1]) {
  const res = NextResponse.json(body, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function badRequest(message: string) {
  return jsonNoStore({ error: message }, { status: 400 });
}

function ok(hits: any[], meta: SimilarMeta, warning?: string) {
  return jsonNoStore({ hits, meta, ...(warning ? { warning } : {}) });
}

function okCached(cacheKey: string, hits: any[], meta: SimilarMeta, warning?: string) {
  hitsCache.set(cacheKey, { hits, meta, warning, expiresAt: Date.now() + HITS_CACHE_TTL_MS });
  return ok(hits, meta, warning);
}

function buildWarning(message: string, error?: unknown) {
  if (error instanceof Error) return `${message} (${error.message})`;
  return message;
}

export async function POST(req: NextRequest) {
  const resourceIdFromQuery =
    req.nextUrl.searchParams.get("resourceId") ?? req.nextUrl.searchParams.get("rid");

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    // Allow query-string driven requests even if the body can't be parsed.
    body = null;
  }

  const resourceId =
    (typeof resourceIdFromQuery === "string" && resourceIdFromQuery.trim()
      ? resourceIdFromQuery.trim()
      : null) ?? (typeof body?.resourceId === "string" ? body.resourceId : null);

  const _preferUpload =
    req.nextUrl.searchParams.get("preferUpload") === "1" ||
    req.nextUrl.searchParams.get("prefer") === "upload" ||
    body?.preferUpload === true;

  const mode = (typeof body?.mode === "string" ? body.mode : "similar-image") as Mode;
  const pageSizeRaw = body?.pageSize;
  const pageSize =
    typeof pageSizeRaw === "number" && Number.isFinite(pageSizeRaw)
      ? Math.max(1, Math.min(50, Math.floor(pageSizeRaw)))
      : 24;

  if (!resourceId) return badRequest("Missing resourceId");
  if (mode !== "similar-image" && mode !== "semantic-image") {
    return badRequest("Invalid mode (use similar-image or semantic-image)");
  }

  const cacheKey = `${resourceId}|name-only|${pageSize}`;
  const cachedHits = hitsCache.get(cacheKey);
  if (cachedHits) {
    if (cachedHits.expiresAt > Date.now()) {
      return ok(cachedHits.hits, cachedHits.meta, cachedHits.warning);
    }
    hitsCache.delete(cacheKey);
  }

  const runSearch = async (p: any) => {
    const res = await fabricFetch<any>("/v2/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    return Array.isArray(res?.hits) ? res.hits : [];
  };

  let resourceCache: any | null = null;
  const getResource = async () => {
    if (resourceCache) return resourceCache;
    resourceCache = await fabricFetch<any>(`/v2/resources/${resourceId}`, { method: "GET" });
    return resourceCache;
  };

  const runTextSearchFromName = async (): Promise<{ hits: any[]; text: string }> => {
    const resource = await getResource();
    const textRaw =
      (typeof resource?.name === "string" ? resource.name : "") ||
      (typeof resource?.title === "string" ? resource.title : "") ||
      "";
    const text = textRaw.trim().slice(0, 255);
    if (!text) return { hits: [], text: "" };

    const hits = await runSearch({
      mode: "hybrid",
      text,
      filters: { kinds: ["image", "video"] },
      pagination: { page: 1, pageSize },
    });

    return { hits, text };
  };

  // Name-only similarity: use the resource's name/title as the query text.
  // This avoids any image upload/download, and does not use Fabric's visual similarity modes.
  try {
    const { hits, text } = await runTextSearchFromName();
    const warning = !text
      ? "This resource has no name/title to search by"
      : undefined;

    return okCached(
      cacheKey,
      hits.filter((x: any) => x?.id && x.id !== resourceId),
      { strategy: "text", queryResourceId: resourceId },
      warning,
    );
  } catch (eText) {
    return okCached(
      cacheKey,
      [],
      { strategy: "text", queryResourceId: resourceId },
      buildWarning("Similar items are unavailable", eText),
    );
  }
}
