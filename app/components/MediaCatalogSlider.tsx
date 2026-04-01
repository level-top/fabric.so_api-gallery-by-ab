"use client";

import * as React from "react";

import { NoSaveImage } from "@/app/components/NoSaveImage";
import styles from "@/app/resource/[id]/resource.module.css";

type CatalogResource = {
    id: string;
    name?: string | null;
    kind?: string | null;
    thumbnail?: {
        sm?: string | null;
        md?: string | null;
        lg?: string | null;
        xl?: string | null;
        original?: string | null;
    } | null;
    cover?: { url?: string | null } | null;
    fileUrl?: string | null;
    url?: string | null;
};

type CatalogResponse = {
    resources?: CatalogResource[];
    error?: string;
};

type SliderItem = {
    id: string;
    name: string;
    url: string;
};

function pickImageUrl(r: CatalogResource): string | null {
    return (
        r.thumbnail?.xl ??
        r.thumbnail?.lg ??
        r.thumbnail?.md ??
        r.thumbnail?.sm ??
        r.cover?.url ??
        r.fileUrl ??
        null
    );
}

function buildWatermarkedInlineProxyUrl(url: string, filename?: string | null): string {
    const params = new URLSearchParams();
    params.set("url", url);
    params.set("inline", "1");
    params.set("wm", "6");
    if (filename && filename.trim()) params.set("filename", filename.trim());
    return `/api/asset?${params.toString()}`;
}

export function MediaCatalogSlider(props: {
    resourceId: string;
    title: string;
    imageUrl: string;
}) {
    const { resourceId, title, imageUrl } = props;

    const preloadedRef = React.useRef<Set<string>>(new Set());

    const preloadSrc = React.useCallback((src: string) => {
        const s = (src ?? "").trim();
        if (!s) return;
        if (preloadedRef.current.has(s)) return;
        preloadedRef.current.add(s);

        try {
            const img = new Image();
            img.decoding = "async";
            img.src = s;
        } catch {
            // ignore
        }
    }, []);

    const [items, setItems] = React.useState<SliderItem[]>(() => [
        { id: resourceId, name: title, url: imageUrl },
    ]);
    const [activeIndex, setActiveIndex] = React.useState(0);

    const startXRef = React.useRef<number | null>(null);

    const goPrev = React.useCallback(() => {
        setActiveIndex((i) => {
            const next = i - 1;
            return next < 0 ? items.length - 1 : next;
        });
    }, [items.length]);

    const goNext = React.useCallback(() => {
        setActiveIndex((i) => {
            const next = i + 1;
            return next >= items.length ? 0 : next;
        });
    }, [items.length]);

    React.useEffect(() => {
        let cancelled = false;

        // Reset preload cache when the base resource changes.
        preloadedRef.current = new Set();

        setItems([{ id: resourceId, name: title, url: imageUrl }]);
        setActiveIndex(0);

        (async () => {
            try {
                const resp = await fetch("/api/fabric/catalog", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ resourceId, limit: 5 }),
                });

                const data = (await resp.json().catch(() => ({}))) as CatalogResponse;
                if (!resp.ok) return;

                const list = Array.isArray(data.resources) ? data.resources : [];

                const mapped: SliderItem[] = [];
                for (const r of list) {
                    if (!r || typeof r !== "object") continue;
                    if (!r.id || r.id === resourceId) continue;
                    const url = pickImageUrl(r);
                    if (!url) continue;
                    mapped.push({
                        id: r.id,
                        name: (r.name ?? r.id) as string,
                        url,
                    });
                }

                const unique = new Map<string, SliderItem>();
                unique.set(resourceId, { id: resourceId, name: title, url: imageUrl });
                for (const it of mapped) unique.set(it.id, it);

                const nextItems = Array.from(unique.values());
                if (!cancelled) setItems(nextItems);
            } catch {
                // ignore
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [resourceId, title, imageUrl]);

    // Preload the next/previous slide images in the background to make switching feel instant.
    React.useEffect(() => {
        if (items.length <= 1) return;

        const nextIdx = (activeIndex + 1) % items.length;
        const prevIdx = (activeIndex - 1 + items.length) % items.length;

        const next = items[nextIdx];
        const prev = items[prevIdx];
        if (next) preloadSrc(buildWatermarkedInlineProxyUrl(next.url, next.name));
        if (prev) preloadSrc(buildWatermarkedInlineProxyUrl(prev.url, prev.name));
    }, [items, activeIndex, preloadSrc]);

    const hasMultiple = items.length > 1;

    return (
        <div className={styles.sliderWrap}>
            <div className={styles.mediaCard}>
                <div className={`${styles.centerWatermark} ${styles.centerWatermarkTop}`} aria-hidden="true">
                    AB Designer
                </div>
                <div
                    className={`${styles.centerWatermark} ${styles.centerWatermarkMiddle}`}
                    aria-hidden="true"
                >
                    AB Designer
                </div>
                <div className={`${styles.centerWatermark} ${styles.centerWatermarkBottom}`} aria-hidden="true">
                    AB Designer
                </div>

                <div
                    className={styles.sliderStage}
                    onTouchStart={(e) => {
                        startXRef.current = e.touches?.[0]?.clientX ?? null;
                    }}
                    onTouchEnd={(e) => {
                        const startX = startXRef.current;
                        startXRef.current = null;
                        const endX = e.changedTouches?.[0]?.clientX;
                        if (startX == null || endX == null) return;
                        const delta = endX - startX;
                        if (Math.abs(delta) < 40) return;
                        if (delta > 0) goPrev();
                        else goNext();
                    }}
                >
                    <div className={styles.sliderViewport} aria-live="polite">
                        <div
                            className={styles.sliderTrack}
                            style={{ transform: `translateX(-${activeIndex * 100}%)` }}
                        >
                            {items.map((it, idx) => {
                                const src = buildWatermarkedInlineProxyUrl(it.url, it.name);
                                return (
                                    <div key={it.id} className={styles.sliderSlide} aria-hidden={idx !== activeIndex}>
                                        <NoSaveImage
                                            className={styles.media}
                                            src={src}
                                            alt={it.name ?? title}
                                            decoding="async"
                                            loading={idx === activeIndex ? "eager" : "lazy"}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {hasMultiple ? (
                        <>
                            <button
                                type="button"
                                className={`${styles.actionIconButton} ${styles.sliderPrev}`}
                                onClick={goPrev}
                                aria-label="Previous image"
                                title="Previous"
                            >
                                ‹
                            </button>
                            <button
                                type="button"
                                className={`${styles.actionIconButton} ${styles.sliderNext}`}
                                onClick={goNext}
                                aria-label="Next image"
                                title="Next"
                            >
                                ›
                            </button>
                        </>
                    ) : null}
                </div>
            </div>

            {hasMultiple ? (
                <div className={styles.sliderThumbRow} aria-label="Catalog thumbnails">
                    {items.map((it, idx) => {
                        const thumbSrc = buildWatermarkedInlineProxyUrl(it.url, it.name);
                        const activeClass = idx === activeIndex ? styles.sliderThumbActive : "";
                        return (
                            <button
                                key={it.id}
                                type="button"
                                className={`${styles.catalogItem} ${styles.sliderThumbButton} ${activeClass}`}
                                onClick={() => setActiveIndex(idx)}
                                aria-label={it.name}
                                title={it.name}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img className={styles.catalogThumb} src={thumbSrc} alt={it.name} draggable={false} />
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
