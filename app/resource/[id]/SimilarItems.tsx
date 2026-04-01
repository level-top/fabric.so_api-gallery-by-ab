"use client";

import * as React from "react";
import Link from "next/link";

import sharedStyles from "../../page.module.css";
import styles from "./resource.module.css";
import { FavoriteButton } from "@/app/components/FavoriteButton";

type Props = {
    resourceId: string;
    pageSize?: number;
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

function pickThumb(resource: any): string | null {
    return (
        resource?.thumbnail?.lg ??
        resource?.thumbnail?.md ??
        resource?.thumbnail?.sm ??
        resource?.cover?.url ??
        resource?.thumbnail?.original ??
        null
    );
}

export function SimilarItems({ resourceId, pageSize = 24 }: Props) {
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [warning, setWarning] = React.useState<string | null>(null);
    const [items, setItems] = React.useState<any[]>([]);

    React.useEffect(() => {
        let cancelled = false;

        async function run() {
            setLoading(true);
            setError(null);
            setWarning(null);
            setItems([]);

            try {
                const resp = await fetch(`/api/fabric/similar?resourceId=${encodeURIComponent(resourceId)}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        cache: "no-store",
                        body: JSON.stringify({
                            resourceId,
                            pageSize,
                        }),
                    },
                );

                if (!resp.ok) {
                    const text = await resp.text().catch(() => "");
                    throw new Error(`Similar items error ${resp.status}: ${text || resp.statusText}`);
                }

                const data = await readJsonResponse<any>(resp).catch(() => ({}));
                const hits = Array.isArray(data?.hits) ? data.hits : [];
                const w = typeof data?.warning === "string" ? data.warning : null;

                if (cancelled) return;
                setWarning(w);
                setItems(hits.filter((x: any) => x && typeof x === "object" && x.id && x.id !== resourceId));
            } catch (e) {
                if (cancelled) return;
                setError(e instanceof Error ? e.message : "Failed to load similar items");
            } finally {
                if (cancelled) return;
                setLoading(false);
            }
        }

        run();
        return () => {
            cancelled = true;
        };
    }, [pageSize, resourceId]);

    return (
        <>
            <div className={styles.similarHeader}>
                <h2 className={styles.sectionTitle}>Similar items</h2>
                {loading ? <p className={styles.note}>Loading similar items…</p> : null}
                {!loading && error ? <p className={styles.note}>{error}</p> : null}
                {!loading && !error && warning ? <p className={styles.note}>{warning}</p> : null}
            </div>

            {!loading && !error && items.length ? (
                <div className={`${sharedStyles.grid} ${styles.similarGrid}`}>
                    {items.map((r) => {
                        const src = pickThumb(r);
                        const isVideo = (r?.kind ?? "").toLowerCase() === "video";
                        return (
                            <div key={r.id} className={sharedStyles.cardLink}>
                                <div className={sharedStyles.card}>
                                    <div className={sharedStyles.media}>
                                        <Link className={sharedStyles.mediaLink} href={`/resource/${r.id}`}>
                                            {src ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    className={sharedStyles.thumb}
                                                    src={src}
                                                    alt={r?.name ?? r.id}
                                                    loading="lazy"
                                                    draggable={false}
                                                    onContextMenu={(e) => e.preventDefault()}
                                                    onDragStart={(e) => e.preventDefault()}
                                                />
                                            ) : (
                                                <div className={sharedStyles.missing}>No preview</div>
                                            )}
                                        </Link>

                                        <div className={`${sharedStyles.centerWatermark} ${sharedStyles.centerWatermarkTop}`} aria-hidden="true">AB Designer</div>
                                        <div className={`${sharedStyles.centerWatermark} ${sharedStyles.centerWatermarkMiddle}`} aria-hidden="true">AB Designer</div>
                                        <div className={`${sharedStyles.centerWatermark} ${sharedStyles.centerWatermarkBottom}`} aria-hidden="true">AB Designer</div>

                                        {isVideo ? (
                                            <div className={sharedStyles.playOverlay} aria-hidden="true">
                                                <div className={sharedStyles.playBadge}>▶</div>
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className={sharedStyles.caption}>
                                        <div className={sharedStyles.captionTop}>
                                            <div className={sharedStyles.meta}>{r?.kind ?? "resource"}</div>
                                            <FavoriteButton
                                                resourceId={r.id}
                                                className={`${sharedStyles.favoriteInline} ${sharedStyles.captionFav}`}
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
            ) : !loading && !error ? (
                <p className={styles.note}>No similar items found.</p>
            ) : null}
        </>
    );
}
