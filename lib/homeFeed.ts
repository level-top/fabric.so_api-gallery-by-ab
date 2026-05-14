import { fabricFetch } from "@/lib/fabric";

const HOME_FEED_LIMIT = 12;
const HOME_FEED_TTL_MS = 4 * 60 * 60 * 1000;

type HomeFeedPayload = {
  resources: unknown[];
  nextCursor: string | null;
  hasMore: boolean;
  refreshedAt: string;
};

type HomeFeedCacheEntry = {
  payload: HomeFeedPayload;
  expiresAt: number;
};

let homeFeedCache: HomeFeedCacheEntry | null = null;
let homeFeedInflight: Promise<HomeFeedPayload> | null = null;

function normalizePayload(data: unknown): HomeFeedPayload {
  const value = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const resources = Array.isArray(value.resources) ? value.resources : [];
  const nextCursorRaw = typeof value.nextCursor === "string" ? value.nextCursor.trim() : "";

  return {
    resources,
    nextCursor: nextCursorRaw || null,
    hasMore: Boolean(value.hasMore),
    refreshedAt: new Date().toISOString(),
  };
}

async function fetchRecentUploads(limit = HOME_FEED_LIMIT): Promise<HomeFeedPayload> {
  const data = await fabricFetch<unknown>("/v2/resources/filter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kind: ["image", "video"],
      includeSubfolderCount: false,
      limit,
      order: {
        property: "createdAt",
        direction: "DESC",
      },
    }),
  });

  return normalizePayload(data);
}

async function refreshHomeFeed(limit = HOME_FEED_LIMIT): Promise<HomeFeedPayload> {
  if (homeFeedInflight) return homeFeedInflight;

  homeFeedInflight = (async () => {
    const payload = await fetchRecentUploads(limit);
    homeFeedCache = {
      payload,
      expiresAt: Date.now() + HOME_FEED_TTL_MS,
    };
    return payload;
  })();

  try {
    return await homeFeedInflight;
  } finally {
    homeFeedInflight = null;
  }
}

export async function getCachedHomeFeed(options?: {
  forceRefresh?: boolean;
  allowStale?: boolean;
  limit?: number;
}): Promise<HomeFeedPayload & { stale: boolean }> {
  const forceRefresh = Boolean(options?.forceRefresh);
  const allowStale = options?.allowStale ?? true;
  const limit = options?.limit ?? HOME_FEED_LIMIT;
  const now = Date.now();

  if (!forceRefresh && homeFeedCache) {
    if (homeFeedCache.expiresAt > now) {
      return { ...homeFeedCache.payload, stale: false };
    }

    if (allowStale) {
      void refreshHomeFeed(limit).catch(() => {
        // Ignore background refresh failures and keep serving the last good payload.
      });
      return { ...homeFeedCache.payload, stale: true };
    }
  }

  const payload = await refreshHomeFeed(limit);
  return { ...payload, stale: false };
}

export function getHomeFeedTtlMs() {
  return HOME_FEED_TTL_MS;
}
