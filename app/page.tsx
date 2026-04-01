"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import styles from "./page.module.css";
import { SEED_FILENAME_TAGS } from "@/lib/seedFilenameTags";
import { FavoriteButton } from "./components/FavoriteButton";

type HomeCache = {
  searchText: string;
  status: string;
  items: Resource[];
  nextCursor: string | null;
  listHasMore: boolean;
  activeSearchText: string;
  searchPage: number;
  searchPageSize: number;
  searchHasMore: boolean;
  searchTotal: number | null;
  mode: "list" | "search";
  scrollY: number;
};

// In-memory cache (cleared on full reload).
let HOME_CACHE: HomeCache | null = null;

const SEARCH_HISTORY_KEY = "fabric-gallery:search-history:v1";
const SEARCH_HISTORY_LIMIT = 10;
const FAVORITES_KEY = "fabric-gallery:favorites:v1";
const FAVORITES_EVENT = "fabric-gallery:favorites-changed";

const LIST_PAGE_LIMIT = 12;

const DEFAULT_HOME_KEYWORD = "trending";
const DEFAULT_HOME_SEARCH_PAGE_SIZE = LIST_PAGE_LIMIT;

const NAME_TAGS_KEY = "fabric-gallery:name-tags:v1";
const NAME_TAGS_LIMIT = 40;

async function readJsonResponse<T>(resp: Response): Promise<T> {
  const contentType = (resp.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    return (await resp.json()) as T;
  }
  const text = await resp.text().catch(() => "");
  const preview = text.trim().slice(0, 220);
  throw new Error(
    `Non-JSON response (${resp.status} ${resp.statusText}). ` +
    (preview ? `Body: ${preview}` : "Empty body"),
  );
}

function normalizeHistoryTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 255);
}

function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const term = normalizeHistoryTerm(v);
      if (!term) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(term);
      if (out.length >= SEARCH_HISTORY_LIMIT) break;
    }
    return out;
  } catch {
    return [];
  }
}

function saveSearchHistory(history: string[]) {
  try {
    localStorage.setItem(
      SEARCH_HISTORY_KEY,
      JSON.stringify(history.slice(0, SEARCH_HISTORY_LIMIT)),
    );
  } catch {
    // ignore
  }
}

function isUuidFilename(name: string): boolean {
  // e.g. ec7cac7e-6d37-470f-8043-7bf2a980d8e4.webp
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]+$/i.test(
    name.trim(),
  );
}

function isUuidToken(value: string): boolean {
  // e.g. 1c1e4a48-ab51-436d-b0fc-f6c9fe418a80
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function wordCount(value: string): number {
  return value
    .trim()
    .split(/\s+/g)
    .filter(Boolean).length;
}

function containsLongHexRun(value: string, minLen: number): boolean {
  const m = value.match(/[0-9a-f]+/gi);
  if (!m) return false;
  return m.some((s) => s.length >= minLen);
}

function digitRatio(value: string): number {
  const s = value.trim();
  if (!s) return 1;
  const digits = (s.match(/\d/g) ?? []).length;
  return digits / s.length;
}

function looksLikeFilenameOrId(value: string): boolean {
  const t = value.trim();
  if (!t) return false;

  // Common generated media keys and social filenames.
  // Examples:
  // - imgi_59_media_image-7ca4be0c7c9f4523855a5bc240c72319_...
  // - 435312744_7422054837909974_49477514861418823_n
  if (t.includes("_media_image-") || /^imgi_\d+_/i.test(t)) return true;

  // If it has many underscores/hyphens and is fairly long, it's almost certainly a filename/key.
  const underscoreCount = (t.match(/_/g) ?? []).length;
  const hyphenCount = (t.match(/-/g) ?? []).length;
  if (t.length >= 24 && (underscoreCount >= 2 || hyphenCount >= 3)) return true;
  if (underscoreCount >= 3 && digitRatio(t) >= 0.35) return true;

  // Long hex runs are typical of hashes/ids embedded in filenames.
  if (containsLongHexRun(t, 12)) return true;

  return false;
}

function shouldIgnoreTagToken(tag: string): boolean {
  const t = tag.trim();
  if (!t) return true;
  if (isUuidToken(t)) return true;
  if (looksLikeFilenameOrId(t)) return true;
  // Keep tags compact: max 3 words.
  if (wordCount(t) > 3) return true;
  // Ignore "RAW"-style names/tokens.
  if (/^raw\b/i.test(t)) return true;
  return false;
}

function extractTagsFromName(nameRaw: string | null | undefined): string[] {
  if (!nameRaw) return [];
  const name = nameRaw.trim();
  if (!name) return [];
  // Ignore a plain UUID name entirely.
  if (isUuidToken(name)) return [];
  // Ignore any *.webp name completely (these are typically auto-assigned filenames).
  if (/\.webp$/i.test(name)) return [];
  if (isUuidFilename(name)) return [];

  // Normalize whitespace and common delimiter formatting.
  const normalized = name
    .replace(/\s+/g, " ")
    .replace(/-\s+/g, " - ")
    .replace(/\s+-/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

  // Split tags by the common delimiter " - ".
  const parts = normalized.split(/\s-\s/g).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return [];

  // Remove the date prefix from the first part.
  // Examples:
  // AB_24 12 4.31  1COLOR
  // AB_03 01 10.06 6COLOR
  // AB_03 01 1.53 COTTON
  const datePrefix = /^[A-Za-z]{1,6}\s*_\s*\d{1,2}\s+\d{1,2}\s+[\d.]{1,6}\s+/;
  parts[0] = parts[0].replace(datePrefix, "").trim();

  const out: string[] = [];
  for (const p of parts) {
    const t = p.replace(/\s+/g, " ").trim();
    if (!t) continue;
    // Drop leftovers that still look like pure dates/times.
    if (/^[\d.]+$/.test(t)) continue;
    if (t.length < 2) continue;
    if (shouldIgnoreTagToken(t)) continue;
    out.push(t);
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const t of out) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }

  return deduped;
}

function loadNameTags(): Record<string, number> {
  try {
    const raw = localStorage.getItem(NAME_TAGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k !== "string" || !k.trim()) continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
      out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveNameTags(tags: Record<string, number>) {
  try {
    localStorage.setItem(NAME_TAGS_KEY, JSON.stringify(tags));
  } catch {
    // ignore
  }
}

type Resource = {
  id: string;
  name?: string | null;
  kind?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  thumbnail?: {
    sm?: string | null;
    md?: string | null;
    lg?: string | null;
    xl?: string | null;
    original?: string | null;
  } | null;
  cover?: { url?: string | null } | null;
};

type ResourcesFilterResponse = {
  resources?: Resource[];
  total?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
};

type SearchResponse = {
  hits?: Array<Resource | unknown>;
  total?: number;
  hasMore?: boolean;
};

function pickThumb(r: Resource): string | null {
  return (
    r.thumbnail?.lg ??
    r.thumbnail?.md ??
    r.thumbnail?.sm ??
    r.cover?.url ??
    r.thumbnail?.original ??
    null
  );
}

function loadFavoriteIds(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const id = v.trim();
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchFavoriteResource(id: string): Promise<Resource | null> {
  try {
    const resp = await fetch(`/api/fabric/resource?id=${encodeURIComponent(id)}`, {
      method: "GET",
      cache: "no-store",
    });
    if (!resp.ok) return null;
    const json = (await resp.json().catch(() => ({}))) as any;
    const r = json?.resource;
    if (!r || typeof r !== "object" || !r.id) return null;
    return r as Resource;
  } catch {
    return null;
  }
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const viewParam = useMemo(() => {
    const v = searchParams.get("view");
    return typeof v === "string" ? v.trim() : "";
  }, [searchParams]);

  const wantsFavoritesView = useMemo(() => {
    const v = viewParam.toLowerCase();
    return v === "favourites" || v === "favorites";
  }, [viewParam]);

  const queryQ = useMemo(() => {
    const q = searchParams.get("q");
    return typeof q === "string" ? q.trim() : "";
  }, [searchParams]);

  const showHero = useMemo(() => queryQ.trim().length === 0, [queryQ]);

  const initialCache = HOME_CACHE;
  const restoredRef = useRef<boolean>(Boolean(initialCache));

  const [searchText, setSearchText] = useState<string>(() => initialCache?.searchText ?? "");
  const [status, setStatus] = useState<string>(() => initialCache?.status ?? "");

  const [items, setItems] = useState<Resource[]>(() => initialCache?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(() => initialCache?.nextCursor ?? null);
  const [listHasMore, setListHasMore] = useState(() => initialCache?.listHasMore ?? false);
  const [activeSearchText, setActiveSearchText] = useState<string>(() => initialCache?.activeSearchText ?? "");
  const [searchPage, setSearchPage] = useState(() => initialCache?.searchPage ?? 1);
  const [searchPageSize, setSearchPageSize] = useState(() => initialCache?.searchPageSize ?? 30);
  const [searchHasMore, setSearchHasMore] = useState(() => initialCache?.searchHasMore ?? false);
  const [searchTotal, setSearchTotal] = useState<number | null>(() => initialCache?.searchTotal ?? null);
  const [mode, setMode] = useState<"list" | "search">(() => initialCache?.mode ?? "list");
  const [loading, setLoading] = useState(false);

  const [favoritesOnly, setFavoritesOnly] = useState(() => wantsFavoritesView);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [favoriteItems, setFavoriteItems] = useState<Resource[]>([]);
  const [favoriteStatus, setFavoriteStatus] = useState<string>("");
  const favoriteRequestRef = useRef(0);
  const [nameTags, setNameTags] = useState<Record<string, number>>({});
  const processedIdsRef = useRef<Set<string>>(new Set());

  const latestStateRef = useRef<HomeCache>({
    searchText: initialCache?.searchText ?? "",
    status: initialCache?.status ?? "",
    items: initialCache?.items ?? [],
    nextCursor: initialCache?.nextCursor ?? null,
    listHasMore: initialCache?.listHasMore ?? false,
    activeSearchText: initialCache?.activeSearchText ?? "",
    searchPage: initialCache?.searchPage ?? 1,
    searchPageSize: initialCache?.searchPageSize ?? 30,
    searchHasMore: initialCache?.searchHasMore ?? false,
    searchTotal: initialCache?.searchTotal ?? null,
    mode: initialCache?.mode ?? "list",
    scrollY: initialCache?.scrollY ?? 0,
  });

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const canLoad = true;

  useEffect(() => {
    // Load persisted filename-tags and prune ignored tokens like RAW.
    const loaded = loadNameTags();
    let changed = false;
    for (const k of Object.keys(loaded)) {
      if (shouldIgnoreTagToken(k)) {
        delete loaded[k];
        changed = true;
      }
    }
    if (changed) saveNameTags(loaded);
    setNameTags((prev) => {
      const next: Record<string, number> = { ...prev };
      let didChange = false;

      const hasAny = Object.keys(next).length > 0;
      const loadedHasAny = Object.keys(loaded).length > 0;

      if (!hasAny && !loadedHasAny) {
        for (const [k, v] of Object.entries(SEED_FILENAME_TAGS)) {
          const key = typeof k === "string" ? k.trim() : "";
          if (!key) continue;
          if (shouldIgnoreTagToken(key)) continue;
          if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
          next[key] = v;
          didChange = true;
        }
      }

      for (const [k, v] of Object.entries(loaded)) {
        if (!k.trim()) continue;
        if (shouldIgnoreTagToken(k)) {
          didChange = true;
          continue;
        }
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
        const current = next[k];
        const merged = typeof current === "number" && Number.isFinite(current) ? Math.max(current, v) : v;
        if (merged !== current) {
          next[k] = merged;
          didChange = true;
        }
      }

      return didChange ? next : prev;
    });
  }, []);

  useEffect(() => {
    const refresh = () => {
      setFavoriteIds(loadFavoriteIds());
    };

    refresh();

    const onStorage = (e: StorageEvent) => {
      if (e.key !== FAVORITES_KEY) return;
      refresh();
    };

    const onCustom = () => refresh();

    window.addEventListener("storage", onStorage);
    window.addEventListener(FAVORITES_EVENT, onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(FAVORITES_EVENT, onCustom as EventListener);
    };
  }, []);

  useEffect(() => {
    setFavoritesOnly(wantsFavoritesView);
    if (!wantsFavoritesView) setFavoriteStatus("");
  }, [wantsFavoritesView]);

  useEffect(() => {
    if (!favoritesOnly) return;

    const reqId = ++favoriteRequestRef.current;
    const ids = favoriteIds;
    if (!ids.length) {
      setFavoriteItems([]);
      setFavoriteStatus("No favourites yet.");
      return;
    }

    setFavoriteStatus("Loading favourites...");

    (async () => {
      const results = await Promise.all(ids.map((id) => fetchFavoriteResource(id)));
      if (favoriteRequestRef.current !== reqId) return;

      const loaded = results.filter(Boolean) as Resource[];
      setFavoriteItems(loaded);

      if (!loaded.length) {
        setFavoriteStatus("No favourites found.");
      } else {
        setFavoriteStatus("");
      }
    })();
  }, [favoriteIds, favoritesOnly]);

  const sortedNameTags = useMemo(() => {
    const entries = Object.entries(nameTags);
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return entries.slice(0, NAME_TAGS_LIMIT).map(([tag]) => tag);
  }, [nameTags]);

  const resultNameTags = useMemo(() => {
    if (!items.length) return [];
    const counts: Record<string, number> = {};
    for (const r of items) {
      const tags = extractTagsFromName(r?.name ?? null);
      for (const t of tags) counts[t] = (counts[t] ?? 0) + 1;
    }
    const entries = Object.entries(counts);
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return entries.slice(0, NAME_TAGS_LIMIT).map(([tag]) => tag);
  }, [items]);

  const visibleNameTags = useMemo(() => {
    // First load (no active search): show the seeded/persisted tag list.
    // Search mode: show tags derived from the current results.
    if (!queryQ.trim()) return sortedNameTags;
    return resultNameTags.length ? resultNameTags : sortedNameTags;
  }, [queryQ, resultNameTags, sortedNameTags]);

  const displayedItems = favoritesOnly ? favoriteItems : items;

  const ingestNameTags = useCallback((resources: Resource[]) => {
    if (!resources.length) return;

    setNameTags((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const r of resources) {
        if (!r?.id) continue;
        if (processedIdsRef.current.has(r.id)) continue;
        processedIdsRef.current.add(r.id);

        const tags = extractTagsFromName(r.name ?? null);
        for (const t of tags) {
          next[t] = (next[t] ?? 0) + 1;
          changed = true;
        }
      }

      if (changed) saveNameTags(next);
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    // On first mount (including "restored from cache"), ensure we ingest whatever items we already have.
    ingestNameTags(items);
  }, [ingestNameTags, items]);

  const searchWithTerm = useCallback(
    async (termRaw: string) => {
      const term = normalizeHistoryTerm(termRaw);
      if (!term) {
        setStatus("Enter search text first.");
        return;
      }

      const pageSize = 30;
      setSearchPageSize(pageSize);

      setMode("search");
      setLoading(true);
      setStatus("Searching...");

      try {
        const response = await fetch("/api/fabric/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: term,
            mode: "hybrid",
            page: 1,
            pageSize,
          }),
        });

        const data = await readJsonResponse<SearchResponse & { error?: string }>(response);
        if (!response.ok) throw new Error(data.error ?? "Request failed");

        const hits = (data.hits ?? []).filter(
          (x): x is Resource => typeof x === "object" && x !== null && "id" in x,
        );

        setItems(hits);
        ingestNameTags(hits);
        setNextCursor(null);
        setListHasMore(false);
        setActiveSearchText(term);
        setSearchPage(1);
        setSearchHasMore(Boolean(data.hasMore));
        setSearchTotal(typeof data.total === "number" ? data.total : null);
        setStatus(
          `Found ${hits.length} result(s).` +
          (typeof data.total === "number"
            ? ` Showing ${hits.length} of ${data.total}.`
            : ""),
        );

        // Store search history.
        const prev = loadSearchHistory();
        const next = [term, ...prev.filter((t) => t.toLowerCase() !== term.toLowerCase())].slice(
          0,
          SEARCH_HISTORY_LIMIT,
        );
        saveSearchHistory(next);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [ingestNameTags],
  );

  const loadTrendingHome = useCallback(async () => {
    const term = DEFAULT_HOME_KEYWORD;
    const pageSize = DEFAULT_HOME_SEARCH_PAGE_SIZE;

    setMode("search");
    setSearchPageSize(pageSize);
    setLoading(true);
    setStatus("Loading...");

    try {
      const response = await fetch("/api/fabric/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: term,
          mode: "hybrid",
          page: 1,
          pageSize,
        }),
      });

      const data = await readJsonResponse<SearchResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "Request failed");

      const hits = (data.hits ?? []).filter(
        (x): x is Resource => typeof x === "object" && x !== null && "id" in x,
      );

      if (!hits.length) {
        throw new Error("No trending results.");
      }

      setItems(hits);
      ingestNameTags(hits);
      setNextCursor(null);
      setListHasMore(false);
      setActiveSearchText(term);
      setSearchPage(1);
      setSearchHasMore(Boolean(data.hasMore));
      setSearchTotal(typeof data.total === "number" ? data.total : null);
      setStatus("");
    } finally {
      setLoading(false);
    }
  }, [ingestNameTags]);

  useEffect(() => {
    const q = queryQ.trim();
    if (!q) return;
    if (favoritesOnly) return;
    if (q.toLowerCase() === activeSearchText.trim().toLowerCase()) return;
    setSearchText(q);
    void searchWithTerm(q);
  }, [activeSearchText, favoritesOnly, queryQ, searchWithTerm]);

  const loadFirstPage = useCallback(async () => {
    setMode("list");
    setLoading(true);
    setStatus("Loading items...");

    try {
      const response = await fetch("/api/fabric/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: LIST_PAGE_LIMIT }),
      });

      const data = await readJsonResponse<ResourcesFilterResponse & {
        error?: string;
      }>(response);
      if (!response.ok) throw new Error(data.error ?? "Request failed");

      setItems(data.resources ?? []);
      ingestNameTags(data.resources ?? []);
      const normalizedNextCursor = (data.nextCursor ?? "").trim();
      setNextCursor(normalizedNextCursor ? normalizedNextCursor : null);
      setListHasMore(Boolean(data.hasMore));
      setSearchHasMore(false);
      setSearchTotal(null);
      setStatus(
        `Loaded ${data.resources?.length ?? 0} item(s).` +
        (data.hasMore ? " More available." : ""),
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [ingestNameTags]);

  const loadDefaultHome = useCallback(async () => {
    // Prefer a curated/keyword home feed; fall back to the normal latest list.
    try {
      await loadTrendingHome();
      return;
    } catch {
      // ignore
    }
    await loadFirstPage();
  }, [loadFirstPage, loadTrendingHome]);

  const loadMore = useCallback(async () => {
    if (!canLoad || !nextCursor || loading) return;
    try {
      const response = await fetch("/api/fabric/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit: LIST_PAGE_LIMIT,
          cursor: nextCursor,
        }),
      });

      const data = await readJsonResponse<ResourcesFilterResponse & {
        error?: string;
      }>(response);
      if (!response.ok) throw new Error(data.error ?? "Request failed");

      setItems((prev) => [...prev, ...(data.resources ?? [])]);
      ingestNameTags(data.resources ?? []);
      const normalizedNextCursor = (data.nextCursor ?? "").trim();
      setNextCursor(normalizedNextCursor ? normalizedNextCursor : null);
      setListHasMore(Boolean(data.hasMore));
      setStatus(
        `Loaded ${data.resources?.length ?? 0} more item(s).` +
        (data.hasMore ? " More available." : ""),
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [canLoad, ingestNameTags, loading, nextCursor]);

  useEffect(() => {
    // When leaving search mode (i.e. URL `?q` cleared), return to the default list.
    if (queryQ.trim()) return;
    if (favoritesOnly) return;
    const isDefaultHomeSearch =
      mode === "search" &&
      activeSearchText.trim().toLowerCase() === DEFAULT_HOME_KEYWORD;
    if (isDefaultHomeSearch) return;
    void loadDefaultHome();
  }, [activeSearchText, favoritesOnly, loadDefaultHome, mode, queryQ]);

  const loadMoreSearch = useCallback(async () => {
    const totalMoreAvailable =
      typeof searchTotal === "number" ? items.length < searchTotal : false;
    if (mode !== "search" || loading || (!searchHasMore && !totalMoreAvailable)) return;

    const nextPage = searchPage + 1;
    setLoading(true);
    setStatus("Loading more results...");

    try {
      const response = await fetch("/api/fabric/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: activeSearchText,
          mode: "hybrid",
          page: nextPage,
          pageSize: searchPageSize,
        }),
      });

      const data = await readJsonResponse<SearchResponse & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "Request failed");

      const hits = (data.hits ?? []).filter(
        (x): x is Resource => typeof x === "object" && x !== null && "id" in x,
      );

      setItems((prev) => {
        const existing = new Set(prev.map((r) => r.id));
        const next = hits.filter((r) => !existing.has(r.id));
        return [...prev, ...next];
      });
      ingestNameTags(hits);
      setSearchPage(nextPage);
      setSearchHasMore(Boolean(data.hasMore));
      setSearchTotal(typeof data.total === "number" ? data.total : searchTotal);

      setStatus(
        `Loaded ${hits.length} more result(s).` +
        (typeof data.total === "number" ? ` Total: ${data.total}.` : "") +
        (data.hasMore ? " More available." : ""),
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [activeSearchText, ingestNameTags, items.length, loading, mode, searchHasMore, searchPage, searchPageSize, searchTotal]);

  useEffect(() => {
    // Restore scroll position when coming back from a detail page.
    if (!restoredRef.current) return;
    const y = initialCache?.scrollY ?? 0;
    // Wait a tick for layout to settle before restoring scroll.
    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        window.scrollTo({ top: y, left: 0, behavior: "auto" });
      });
    });

    return () => {
      cancelled = true;
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [initialCache?.scrollY]);

  useEffect(() => {
    // Auto-load images on initial page open, unless restored from in-memory history.
    if (restoredRef.current) return;
    if (favoritesOnly) return;
    void loadDefaultHome();
  }, [favoritesOnly, loadDefaultHome]);

  useEffect(() => {
    latestStateRef.current = {
      searchText,
      status,
      items,
      nextCursor,
      listHasMore,
      activeSearchText,
      searchPage,
      searchPageSize,
      searchHasMore,
      searchTotal,
      mode,
      scrollY: latestStateRef.current.scrollY,
    };
  }, [
    activeSearchText,
    items,
    listHasMore,
    mode,
    nextCursor,
    searchHasMore,
    searchPage,
    searchPageSize,
    searchText,
    searchTotal,
    status,
  ]);

  useEffect(() => {
    // Save the latest state when navigating away (clears automatically on full reload).
    const onScroll = () => {
      latestStateRef.current.scrollY = window.scrollY || 0;
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      latestStateRef.current.scrollY = window.scrollY || latestStateRef.current.scrollY || 0;
      HOME_CACHE = latestStateRef.current;
    };
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        if (loading) return;
        if (favoritesOnly) return;

        if (mode === "list") {
          if (listHasMore && nextCursor) void loadMore();
          return;
        }

        const totalMoreAvailable =
          typeof searchTotal === "number" ? items.length < searchTotal : false;
        if (mode === "search" && (searchHasMore || totalMoreAvailable)) {
          void loadMoreSearch();
        }
      },
      // Start fetching before the user hits the bottom (server responses can be slow).
      { root: null, rootMargin: "1200px", threshold: 0 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [favoritesOnly, items.length, listHasMore, loadMore, loadMoreSearch, loading, mode, nextCursor, searchHasMore, searchTotal]);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        {showHero && !favoritesOnly ? (
          <section className={styles.hero} aria-label="How to use">
            <div className={styles.heroInner}>
              <div className={styles.heroCopy}>
                <div className={styles.heroKicker}>AB Designer</div>
                <h1 className={styles.heroTitle}>Find your designs fast</h1>
                <p className={styles.heroText}>
                  Search by keyword, use tags from filenames, or pick a color — then save what you like to favourites.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {visibleNameTags.length ? (
          <div className={styles.controls}>
            {visibleNameTags.length ? (
              <div className={styles.history}>
                <div className={styles.historyLabel}>Tags from filenames</div>
                <TagScroller
                  tags={visibleNameTags}
                  rows={1}
                  disabled={loading}
                  onTagClick={(tag) => {
                    router.push(`/?q=${encodeURIComponent(tag)}`);
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {favoritesOnly ? (
          favoriteStatus ? <p className={styles.status}>{favoriteStatus}</p> : null
        ) : status ? (
          <p className={styles.status}>{status}</p>
        ) : null}

        <div className={styles.grid}>
          {displayedItems.map((r) => {
            const src = pickThumb(r);
            const isVideo = (r.kind ?? "").toLowerCase() === "video";
            return (
              <div key={r.id} className={styles.cardLink}>
                <div className={styles.card}>
                  <div className={styles.media}>
                    <Link className={styles.mediaLink} href={`/resource/${r.id}`}>
                      {src ? (
                        // Using <img> to avoid Next Image remote domain config.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className={styles.thumb}
                          src={src}
                          alt={r.name ?? r.id}
                          loading="lazy"
                          draggable={false}
                          onContextMenu={(e) => e.preventDefault()}
                          onDragStart={(e) => e.preventDefault()}
                        />
                      ) : (
                        <div className={styles.missing}>No preview</div>
                      )}
                    </Link>

                    <div className={`${styles.centerWatermark} ${styles.centerWatermarkTop}`} aria-hidden="true">AB Designer</div>
                    <div className={`${styles.centerWatermark} ${styles.centerWatermarkMiddle}`} aria-hidden="true">AB Designer</div>
                    <div className={`${styles.centerWatermark} ${styles.centerWatermarkBottom}`} aria-hidden="true">AB Designer</div>

                    {isVideo ? (
                      <div className={styles.playOverlay} aria-hidden="true">
                        <div className={styles.playBadge}>▶</div>
                      </div>
                    ) : null}
                  </div>

                  <div className={styles.caption}>
                    <div className={styles.captionTop}>
                      <div className={styles.meta}>{r.kind ?? "resource"}</div>
                      <FavoriteButton
                        resourceId={r.id}
                        className={`${styles.favoriteInline} ${styles.captionFav}`}
                        label=""
                        title="Add to favourites"
                      />

                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!favoritesOnly && mode === "list" && listHasMore && nextCursor ? (
          <button
            className={styles.loadMore}
            onClick={loadMore}
            disabled={loading}
            type="button"
          >
            Load more
          </button>
        ) : null}

        {!favoritesOnly && mode === "search" && searchHasMore ? (
          <button
            className={styles.loadMore}
            onClick={loadMoreSearch}
            disabled={loading}
            type="button"
          >
            Load more
          </button>
        ) : null}

        {!favoritesOnly && mode === "search" && !searchHasMore && typeof searchTotal === "number" && items.length < searchTotal ? (
          <button
            className={styles.loadMore}
            onClick={loadMoreSearch}
            disabled={loading}
            type="button"
          >
            Load more
          </button>
        ) : null}

        <div ref={sentinelRef} />
      </main>
    </div>
  );
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M14.5 5.5L8.5 12l6 6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9.5 5.5l6 6.5-6 6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TagScroller({
  tags,
  rows = 2,
  disabled,
  onTagClick,
}: {
  tags: string[];
  rows?: 1 | 2;
  disabled: boolean;
  onTagClick: (tag: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft;
    setCanScrollLeft(left > 1);
    setCanScrollRight(max - left > 1);
  }, []);

  useEffect(() => {
    update();
  }, [tags.length, update]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onScroll = () => update();
    el.addEventListener("scroll", onScroll, { passive: true });

    const ro = new ResizeObserver(() => update());
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [update]);

  const scrollByAmount = useCallback((dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const amount = Math.max(160, Math.floor(el.clientWidth * 0.8));
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  }, []);

  return (
    <div className={styles.tagScroller} data-can-scroll-right={canScrollRight ? "1" : "0"}>
      <button
        type="button"
        className={`${styles.tagArrow} ${styles.tagArrowLeft}`}
        onClick={() => scrollByAmount(-1)}
        disabled={disabled || !canScrollLeft}
        aria-label="Scroll tags left"
        title="Scroll left"
      >
        <ChevronLeftIcon className={styles.tagArrowIcon} />
      </button>

      <div ref={ref} className={rows === 1 ? styles.tagChipsOneRow : styles.tagChips}>
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className={styles.historyChip}
            onClick={() => onTagClick(tag)}
            disabled={disabled}
            title={tag}
          >
            {tag}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`${styles.tagArrow} ${styles.tagArrowRight}`}
        onClick={() => scrollByAmount(1)}
        disabled={disabled || !canScrollRight}
        aria-label="Scroll tags right"
        title="Scroll right"
      >
        <ChevronRightIcon className={styles.tagArrowIcon} />
      </button>
    </div>
  );
}
