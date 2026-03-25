"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import styles from "../page.module.css";

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
  hasMore?: boolean;
  nextCursor?: string | null;
  error?: string;
};

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

export default function PremiumPage() {
  const [items, setItems] = useState<Resource[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setStatus("Loading images...");

    try {
      const resp = await fetch("/api/fabric/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 30 }),
      });

      const data = await readJsonResponse<ResourcesFilterResponse>(resp);
      if (!resp.ok) throw new Error(data.error ?? "Request failed");

      setItems(data.resources ?? []);
      const c = (data.nextCursor ?? "").trim();
      setNextCursor(c ? c : null);
      setHasMore(Boolean(data.hasMore));
      setStatus(`Loaded ${data.resources?.length ?? 0} item(s).`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loading) return;

    setLoading(true);
    setStatus("Loading more...");

    try {
      const resp = await fetch("/api/fabric/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 30, cursor: nextCursor }),
      });

      const data = await readJsonResponse<ResourcesFilterResponse>(resp);
      if (!resp.ok) throw new Error(data.error ?? "Request failed");

      setItems((prev) => [...prev, ...(data.resources ?? [])]);
      const c = (data.nextCursor ?? "").trim();
      setNextCursor(c ? c : null);
      setHasMore(Boolean(data.hasMore));
      setStatus(`Loaded ${data.resources?.length ?? 0} more item(s).`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [hasMore, loading, nextCursor]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        if (loading) return;
        if (hasMore && nextCursor) void loadMore();
      },
      { root: null, rootMargin: "1200px", threshold: 0 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loading, nextCursor]);

  const premiumImages = items.filter((r) => (r.kind ?? "").toLowerCase() === "image");

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>Premium</h1>

        {status ? <p className={styles.status}>{status}</p> : null}

        <div className={styles.grid}>
          {premiumImages.map((r) => {
            const src = pickThumb(r);
            return (
              <Link key={r.id} className={styles.cardLink} href={`/resource/${r.id}`}>
                <div className={styles.card}>
                  <div className={styles.media}>
                    {src ? (
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
                  </div>

                  <div className={styles.caption}>
                    <div className={styles.name} title={r.name ?? "(untitled)"}>
                      {r.name ?? "(untitled)"}
                    </div>
                    <div className={styles.meta}>{r.kind ?? "resource"}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <div ref={sentinelRef} />
      </main>
    </div>
  );
}
