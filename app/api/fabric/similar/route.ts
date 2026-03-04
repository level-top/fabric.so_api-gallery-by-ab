import { NextRequest, NextResponse } from "next/server";

import { FabricApiError, fabricFetch } from "@/lib/fabric";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Upload-based similarity requires creating a temporary file in Fabric.
// If the route is called multiple times in quick succession (prefetch/render/hydration),
// repeated uploads can lead to different results and hydration mismatches.
// Cache the uploaded file id per resourceId for a short TTL.
type UploadCacheEntry = { uploadedId: string; expiresAt: number };
const UPLOAD_CACHE_TTL_MS = 5 * 60 * 1000;
const uploadIdCache: Map<string, UploadCacheEntry> = new Map();

type Mode = "similar-image" | "semantic-image";

type SimilarMeta = {
  strategy: "upload" | "resourceId" | "text";
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

function pickThumbUrl(resource: any): string | null {
  return (
    resource?.thumbnail?.original ??
    resource?.thumbnail?.xl ??
    resource?.thumbnail?.lg ??
    resource?.thumbnail?.md ??
    resource?.thumbnail?.sm ??
    resource?.cover?.url ??
    resource?.url ??
    null
  );
}

function safeFilename(name: string) {
  const cleaned = name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-zA-Z0-9._ -]/g, "-")
    .slice(0, 120);
  return cleaned || "query-image";
}

function parseFabricErrorDetail(error: FabricApiError): any | null {
  const idx = error.message.indexOf(": ");
  if (idx === -1) return null;
  const maybeJson = error.message.slice(idx + 2).trim();
  if (!maybeJson.startsWith("{") || !maybeJson.endsWith("}")) return null;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

function buildWarning(message: string, error?: unknown) {
  if (error instanceof FabricApiError) {
    const detail = parseFabricErrorDetail(error);
    const traceid = detail?.traceid;
    return traceid ? `${message} (traceid: ${traceid})` : `${message} (${error.message})`;
  }
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

  const preferUpload =
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

  const cacheKey = `${resourceId}|${mode}|${pageSize}|${preferUpload ? "upload" : "default"}`;
  const cachedHits = hitsCache.get(cacheKey);
  if (cachedHits) {
    if (cachedHits.expiresAt > Date.now()) {
      return ok(cachedHits.hits, cachedHits.meta, cachedHits.warning);
    }
    hitsCache.delete(cacheKey);
  }

  const buildPayload = (modeToUse: Mode, queryResourceId: string) => ({
    mode: modeToUse,
    resourceId: queryResourceId,
    text: "",
    filters: { kinds: ["image", "video"] },
    pagination: { page: 1, pageSize },
  });

  const buildPayloadAlt = (modeToUse: Mode, queryResourceId: string) => ({
    filters: { kinds: ["image", "video"] },
    queries: [
      {
        mode: modeToUse,
        resourceId: queryResourceId,
        filters: { kinds: ["image", "video"] },
      },
    ],
    pagination: { page: 1, pageSize },
  });

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

  const runTextFallback = async () => {
    const resource = await getResource();
    const textRaw =
      (typeof resource?.name === "string" ? resource.name : "") ||
      (typeof resource?.title === "string" ? resource.title : "") ||
      "";
    const text = textRaw.trim().slice(0, 255);
    if (!text) return [];

    return await runSearch({
      mode: "hybrid",
      text,
      filters: { kinds: ["image", "video"] },
      pagination: { page: 1, pageSize },
    });
  };

  const trySearchModes = async (queryResourceId: string) => {
    const modeOrder: Mode[] =
      mode === "similar-image" ? ["similar-image", "semantic-image"] : [mode];

    let lastError: unknown = null;
    for (const m of modeOrder) {
      try {
        // Prefer the `queries: [...]` shape for similarity searches.
        const hitsAlt = await runSearch(buildPayloadAlt(m, queryResourceId));
        if (Array.isArray(hitsAlt) && hitsAlt.length) return hitsAlt;

        // Fall back to the simpler shape if `queries` returns nothing.
        const hits = await runSearch(buildPayload(m, queryResourceId));
        if (Array.isArray(hits) && hits.length) return hits;

        return [];
      } catch (e1) {
        lastError = e1;
      }
    }
    throw lastError;
  };

  const uploadAndSearch = async () => {
    const resource = await getResource();

    const cached = uploadIdCache.get(resourceId);
    if (cached && cached.expiresAt > Date.now() && cached.uploadedId) {
      return await trySearchModes(cached.uploadedId);
    }

    const imageUrl = pickThumbUrl(resource);
    if (!imageUrl) {
      throw new Error("This resource has no accessible image URL for similarity search.");
    }

    const imageResp = await fetch(imageUrl, { cache: "no-store" });
    if (!imageResp.ok) {
      throw new Error(
        `Failed to download image (${imageResp.status} ${imageResp.statusText})`,
      );
    }

    const contentType = imageResp.headers.get("content-type") ?? "application/octet-stream";
    const bytes = new Uint8Array(await imageResp.arrayBuffer());

    const filenameBase = safeFilename(resource?.name ?? "query-image");
    const filename = filenameBase.includes(".") ? filenameBase : `${filenameBase}.jpg`;

    const presigned = await fabricFetch<any>(
      `/v2/upload?filename=${encodeURIComponent(filename)}&size=${bytes.byteLength}`,
      { method: "GET" },
    );

    const uploadHeaders: Record<string, string> = {
      ...(presigned?.headers ?? {}),
      "Content-Type": contentType,
    };

    const putResp = await fetch(presigned.url, {
      method: "PUT",
      headers: uploadHeaders,
      body: bytes,
    });

    if (!putResp.ok) {
      const text = await putResp.text().catch(() => "");
      throw new Error(
        `Upload failed (${putResp.status} ${putResp.statusText})${text ? `: ${text}` : ""}`,
      );
    }

    const objectPath = new URL(presigned.url).pathname;

    const created = await fabricFetch<any>("/v2/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentId: "@alias::inbox",
        mimeType: contentType,
        attachment: {
          path: objectPath,
          filename,
        },
      }),
    });

    const uploadedId = created?.id;
    if (!uploadedId) {
      throw new Error("Upload succeeded but file creation returned no id");
    }

    uploadIdCache.set(resourceId, {
      uploadedId,
      expiresAt: Date.now() + UPLOAD_CACHE_TTL_MS,
    });

    return await trySearchModes(uploadedId);
  };

  // When requested by the caller, prefer thumbnail-upload similarity so results are tied to the opened asset.
  if (preferUpload) {
    try {
      const hitsUploaded = await uploadAndSearch();
      return okCached(
        cacheKey,
        hitsUploaded.filter((x: any) => x?.id && x.id !== resourceId),
        { strategy: "upload" },
      );
    } catch (_eUploadFirst) {
      // Continue to other strategies below.
    }
  }

  try {
    const hits = await trySearchModes(resourceId);
    return okCached(
      cacheKey,
      hits.filter((x: any) => x?.id && x.id !== resourceId),
      { strategy: "resourceId", queryResourceId: resourceId },
    );
  } catch (_e) {
    // If Fabric's resourceId-based similarity fails, fall back to upload-based similarity.
    try {
      const hitsUploaded = await uploadAndSearch();
      return okCached(
        cacheKey,
        hitsUploaded.filter((x: any) => x?.id && x.id !== resourceId),
        { strategy: "upload" },
      );
    } catch (eUpload) {
      // Final fallback: text-based similarity using the resource name.
      try {
        const hitsText = await runTextFallback();
        return okCached(
          cacheKey,
          hitsText.filter((x: any) => x?.id && x.id !== resourceId),
          { strategy: "text" },
          buildWarning(
            "Visual similarity search is unavailable; showing related results by name instead",
            eUpload,
          ),
        );
      } catch (eText) {
        return okCached(
          cacheKey,
          [],
          { strategy: "text" },
          buildWarning(
            "Similar images are unavailable for this account/resource",
            eText instanceof FabricApiError ? eText : eUpload,
          ),
        );
      }
    }
  }
}
