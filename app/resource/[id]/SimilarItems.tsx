"use client";

import * as React from "react";
import Link from "next/link";

import sharedStyles from "../../page.module.css";
import styles from "./resource.module.css";
import { WhatsAppShareButton } from "@/app/components/WhatsAppShareButton";
import { FavoriteButton } from "@/app/components/FavoriteButton";

type Props = {
    resourceId: string;
    pageSize?: number;
};

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
                            mode: "similar-image",
                            pageSize,
                            preferUpload: true,
                        }),
                    },
                );

                if (!resp.ok) {
                    const text = await resp.text().catch(() => "");
                    throw new Error(`Similar items error ${resp.status}: ${text || resp.statusText}`);
                }

                const data = (await resp.json().catch(() => ({}))) as any;
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
                        return (
                            <div key={r.id} className={sharedStyles.cardLink}>
                                <div className={sharedStyles.card}>
                                    <Link className={sharedStyles.mediaLink} href={`/resource/${r.id}`}>
                                        <div className={sharedStyles.media}>
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

                                            <div className={sharedStyles.watermark} aria-hidden="true">AB Designer</div>
                                            <div className={`${sharedStyles.watermark} ${sharedStyles.watermarkTL}`} aria-hidden="true">AB Designer</div>
                                            <div className={`${sharedStyles.watermark} ${sharedStyles.watermarkTR}`} aria-hidden="true">AB Designer</div>
                                            <div className={`${sharedStyles.watermark} ${sharedStyles.watermarkBR}`} aria-hidden="true">AB Designer</div>
                                            <div className={`${sharedStyles.watermark} ${sharedStyles.watermarkCenter}`} aria-hidden="true">AB Designer</div>

                                            <WhatsAppShareButton
                                                resourceId={r.id}
                                                name={r?.name}
                                                thumbnailUrl={src}
                                                className={sharedStyles.whatsAppBadge}
                                                label=""
                                                title="Share on WhatsApp"
                                            />

                                            <FavoriteButton
                                                resourceId={r.id}
                                                className={sharedStyles.favoriteBadge}
                                                label=""
                                                title="Add to favourites"
                                            />
                                        </div>
                                    </Link>

                                    <div className={sharedStyles.caption}>
                                        <div className={sharedStyles.captionTop}>
                                            <Link
                                                className={sharedStyles.mediaLink}
                                                href={`/resource/${r.id}`}
                                                title={r?.name ?? "(untitled)"}
                                            >
                                                <div className={sharedStyles.name}>{r?.name ?? "(untitled)"}</div>
                                            </Link>
                                        </div>
                                        <div className={sharedStyles.meta}>{r?.kind ?? "resource"}</div>
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
