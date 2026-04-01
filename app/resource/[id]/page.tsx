import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";

import { FabricApiError, fabricFetch } from "@/lib/fabric";

import sharedStyles from "../../page.module.css";
import styles from "./resource.module.css";
import { WhatsAppShareButton } from "@/app/components/WhatsAppShareButton";
import { FavoriteButton } from "@/app/components/FavoriteButton";
import { ShareButton } from "@/app/components/ShareButton";
import { DownloadButton } from "@/app/components/DownloadButton";
import { SimilarItems } from "./SimilarItems";
import { ScrollToTopOnMount } from "@/app/components/ScrollToTopOnMount";
import { MediaCatalogSlider } from "@/app/components/MediaCatalogSlider";

type PageProps = {
  params: Promise<{ id: string }>;
};

async function loadResource(id: string): Promise<any | null> {
  try {
    return await fabricFetch<any>(`/v2/resources/${id}`, { method: "GET" });
  } catch {
    return null;
  }
}

async function getRequestOrigin(): Promise<string> {
  // Prefer explicit config if present.
  const direct = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "").trim();
  if (direct) return direct.replace(/\/$/, "");

  // Otherwise derive from the actual request host (important for custom domains).
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "")
    .split(",")[0]
    ?.trim();
  const proto = (h.get("x-forwarded-proto") ?? "https")
    .split(",")[0]
    ?.trim();
  if (!host) return "";
  return `${proto}://${host}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  if (!id) return {};

  const resource = await loadResource(id);
  const name = typeof resource?.name === "string" && resource.name.trim() ? resource.name.trim() : "Resource";
  const caption =
    typeof resource?.data?.caption === "string"
      ? resource.data.caption
      : typeof resource?.data?.description === "string"
        ? resource.data.description
        : typeof resource?.caption === "string"
          ? resource.caption
          : typeof resource?.description === "string"
            ? resource.description
            : "";
  const desc = (caption ?? "").trim().slice(0, 180) || "Client gallery powered by DNL";

  const thumb = resource ? pickImageUrl(resource) : null;
  const origin = await getRequestOrigin();
  const pagePath = `/resource/${encodeURIComponent(id)}`;
  const pageUrl = origin ? `${origin}${pagePath}` : pagePath;
  const ogImagePath = thumb
    ? `/api/asset?${new URLSearchParams({ url: thumb, inline: "1", og: "1", w: "1200" }).toString()}`
    : "/logo.jpeg";
  const ogImageUrl = origin ? `${origin}${ogImagePath}` : ogImagePath;

  return {
    title: name,
    description: desc,
    openGraph: {
      title: name,
      description: desc,
      url: pageUrl,
      images: [{ url: ogImageUrl, width: 1200, height: 630, type: "image/jpeg" }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      description: desc,
      images: [ogImageUrl],
    },
  };
}

function getFabricApiHostFromEnv(): string {
  const baseUrl = (process.env.FABRIC_API_BASE_URL ?? "https://api.fabric.so").trim();
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "api.fabric.so";
  }
}

function looksLikeFabricApiJsonUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const apiHost = getFabricApiHostFromEnv();
    if (host !== apiHost) return false;
    const path = u.pathname.toLowerCase();
    return path.startsWith("/v1/") || path.startsWith("/v2/");
  } catch {
    return false;
  }
}

function looksLikeFabricWebDocUrl(url: string): boolean {
  // These are UI pages (HTML), not binary assets.
  // Example seen in errors: https://fabric.so/home?expandedFdocId=...
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host !== "fabric.so" && !host.endsWith(".fabric.so")) return false;
    const path = u.pathname.toLowerCase();
    if (path === "/home" || path === "/" || path.startsWith("/app")) {
      const hasDocId =
        u.searchParams.has("expandedFdocId") ||
        u.searchParams.has("docId") ||
        u.searchParams.has("fdocId");
      if (hasDocId) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function pickImageUrl(resource: any): string | null {
  return (
    resource?.thumbnail?.xl ??
    resource?.thumbnail?.lg ??
    resource?.thumbnail?.md ??
    resource?.thumbnail?.sm ??
    resource?.cover?.url ??
    resource?.thumbnail?.original ??
    null
  );
}

function pickVideoUrl(resource: any): string | null {
  const candidates = [
    resource?.fileUrl,
    resource?.originUrl,
    resource?.data?.downloadUrl,
    resource?.data?.downloadURL,
    resource?.data?.source?.url,
    resource?.data?.attachment?.url,
    resource?.file?.url,
    resource?.data?.url,
    resource?.url,
  ];

  for (const v of candidates) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t) continue;
    if (looksLikeFabricApiJsonUrl(t)) continue;
    if (looksLikeFabricWebDocUrl(t)) continue;
    if (t.startsWith("http://") || t.startsWith("https://")) return t;
  }

  return null;
}

function pickHttpUrl(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t) continue;
    if (looksLikeFabricApiJsonUrl(t)) continue;
    if (looksLikeFabricWebDocUrl(t)) continue;
    if (t.startsWith("http://") || t.startsWith("https://")) return t;
  }
  return null;
}

function pickOriginalAssetUrl(resource: any): string | null {
  // Prefer real binary asset URLs; fall back to thumbnails if needed.
  return pickHttpUrl(
    resource?.fileUrl,
    resource?.originUrl,
    resource?.data?.downloadUrl,
    resource?.data?.downloadURL,
    resource?.file?.url,
    resource?.data?.source?.url,
    resource?.data?.attachment?.url,
    pickVideoUrl(resource),
    pickImageUrl(resource),
    resource?.data?.url,
    resource?.url,
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

function firstString(...values: Array<unknown>): string | null {
  for (const v of values) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t) return t;
    }
  }
  return null;
}

function isPremiumImage(resource: any): boolean {
  const kind = typeof resource?.kind === "string" ? resource.kind.toLowerCase() : "";
  return kind === "image";
}

function pickKeywords(resource: any): string[] {
  const keywords: string[] = [];

  const fromKeywords = resource?.data?.keywords ?? resource?.keywords;
  if (Array.isArray(fromKeywords)) {
    for (const k of fromKeywords) {
      if (typeof k === "string" && k.trim()) keywords.push(k.trim());
    }
  }

  const tags = resource?.tags;
  if (Array.isArray(tags)) {
    for (const t of tags) {
      const name = typeof t?.name === "string" ? t.name.trim() : "";
      if (name) keywords.push(name);
    }
  }

  // Dedupe while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

function pickDominantColors(resource: any): Array<string | number> {
  const candidates = [
    resource?.data?.dominantColors,
    resource?.data?.dominantcolors,
    resource?.data?.dominant_colors,
    resource?.data?.colors,
    resource?.data?.color,
    resource?.data?.palette,
    resource?.dominantColors,
    resource?.dominantcolors,
    resource?.dominant_colors,
    resource?.colors,
    resource?.color,
    resource?.palette,
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length) {
      return c.filter(
        (x) =>
          typeof x === "string" ||
          typeof x === "number" ||
          (x && typeof x === "object"),
      ) as any;
    }
  }
  return [];
}

function colorToCss(v: unknown): string | null {
  if (v && typeof v === "object") {
    const rgb = (v as any).rgb;
    if (
      Array.isArray(rgb) &&
      rgb.length === 3 &&
      rgb.every((n: any) => typeof n === "number" && Number.isFinite(n))
    ) {
      const [r, g, b] = rgb as [number, number, number];
      return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }

    const hex = (v as any).hex;
    if (typeof hex === "string" && hex.trim().startsWith("#")) return hex.trim();
    return null;
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    if (s.startsWith("#")) return s;
    if (s.startsWith("rgb") || s.startsWith("hsl")) return s;
    return null;
  }

  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  // Common in Fabric filters: color appears as a number; we treat 0..360 as hue.
  if (v >= 0 && v <= 360) return `hsl(${Math.round(v)}, 70%, 55%)`;
  return null;
}

function colorLabel(v: unknown): string {
  if (v && typeof v === "object") {
    const rgb = (v as any).rgb;
    const score = (v as any).score;
    const rgbLabel =
      Array.isArray(rgb) && rgb.length === 3
        ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
        : "color";
    const scoreLabel =
      typeof score === "number" && Number.isFinite(score)
        ? ` • ${Math.round(score * 100)}%`
        : "";
    return `${rgbLabel}${scoreLabel}`;
  }
  return String(v);
}

function buildWatermarkedInlineProxyUrl(url: string, filename?: string | null): string {
  const params = new URLSearchParams();
  params.set("url", url);
  params.set("inline", "1");
  // Keep this in sync with the Download button's watermark version.
  params.set("wm", "6");
  if (filename && filename.trim()) params.set("filename", filename.trim());
  return `/api/asset?${params.toString()}`;
}

export default async function ResourceDetailPage({ params }: PageProps) {
  const { id } = await params;

  if (!id) notFound();

  try {
    const resource = await loadResource(id);
    if (!resource) notFound();

    const kind = typeof resource?.kind === "string" ? resource.kind : null;
    const imageUrl = pickImageUrl(resource);
    const kindNorm = (kind ?? "").toLowerCase();
    const mimeNorm = typeof resource?.mimeType === "string" ? resource.mimeType.toLowerCase() : "";
    const isVideoKind = kindNorm === "video" || mimeNorm.startsWith("video/");
    const videoUrl = isVideoKind ? pickVideoUrl(resource) : null;
    const title = resource?.name ?? resource?.id ?? "Resource";
    const assetUrl = pickOriginalAssetUrl(resource);

    const createdAt = firstString(
      resource?.createdAt,
      resource?.created_at,
      resource?.data?.createdAt,
      resource?.data?.created_at,
    );
    const createdDate = createdAt && !Number.isNaN(Date.parse(createdAt))
      ? new Date(createdAt).toISOString().slice(0, 10)
      : null;

    const caption = firstString(
      resource?.data?.caption,
      resource?.data?.description,
      resource?.data?.comment,
      resource?.caption,
      resource?.description,
      resource?.comment,
    );
    const keywords = pickKeywords(resource);
    const dominantColors = pickDominantColors(resource);
    const dimensions = resource?.data?.attributes?.dimensions;
    const dimsText =
      typeof dimensions?.width === "number" && typeof dimensions?.height === "number"
        ? `${dimensions.width} × ${dimensions.height}`
        : null;

    const infoToggleId = `info-toggle-${id}`;

    const isPremium = isPremiumImage(resource);

    return (
      <div className={sharedStyles.page}>
        <ScrollToTopOnMount depsKey={id} />
        <main className={`${sharedStyles.main} ${styles.main}`}>
          <div className={styles.layout}>
            <div className={styles.mediaColumn}>
              {videoUrl ? (
                <div className={styles.mediaCard}>
                  <div className={`${styles.centerWatermark} ${styles.centerWatermarkTop}`} aria-hidden="true">AB Designer</div>
                  <div className={`${styles.centerWatermark} ${styles.centerWatermarkMiddle}`} aria-hidden="true">AB Designer</div>
                  <div className={`${styles.centerWatermark} ${styles.centerWatermarkBottom}`} aria-hidden="true">AB Designer</div>
                  <video
                    className={styles.media}
                    controls
                    preload="metadata"
                    poster={pickThumb(resource) ?? undefined}
                  >
                    <source src={videoUrl} />
                  </video>
                </div>
              ) : imageUrl ? (
                <MediaCatalogSlider resourceId={id} title={title} imageUrl={imageUrl} />
              ) : (
                <div className={sharedStyles.missing}>No preview</div>
              )}
            </div>

            <aside className={styles.sidebar}>
              <h2 className={styles.sectionTitle}>Info</h2>
              <div className={styles.card}>
                <div className={styles.infoActions}>
                  <WhatsAppShareButton
                    resourceId={id}
                    name={title}
                    thumbnailUrl={pickThumb(resource) ?? imageUrl ?? null}
                    className={styles.whatsAppButton}
                    label="WhatsApp"
                  />

                  <ShareButton
                    resourceId={id}
                    name={title}
                    className={styles.actionButton}
                    label="Share"
                  />

                  <DownloadButton
                    url={assetUrl}
                    filename={title}
                    className={styles.actionButton}
                    label="Download"
                  />

                  <FavoriteButton
                    resourceId={id}
                    className={styles.actionIconButton}
                    label=""
                    title="Add to favourites"
                  />

                  {isPremium ? <div className={styles.premiumPill}>Premium</div> : null}
                </div>

                <div className={styles.field}>
                  <div className={styles.fieldLabel}>Name</div>
                  <div className={styles.nameValue}>{title}</div>
                </div>

                <div className={styles.metaRow}>
                  {kind ? (
                    <span className={styles.metaItem}>
                      <span className={styles.metaKey}>Type</span>
                      <span className={styles.metaValue}>{kind}</span>
                    </span>
                  ) : null}
                  {createdDate ? (
                    <span className={styles.metaItem}>
                      <span className={styles.metaKey}>Created</span>
                      <span className={styles.metaValue}>{createdDate}</span>
                    </span>
                  ) : null}
                </div>

                <div className={styles.infoClamp}>
                  <input
                    id={infoToggleId}
                    className={styles.infoClampInput}
                    type="checkbox"
                  />

                  <div className={styles.infoClampContent}>
                    {caption ? (
                      <div className={`${styles.field} ${styles.infoHiddenUntilExpanded}`}>
                        <div className={styles.fieldLabel}>Caption</div>
                        <div>{caption}</div>
                      </div>
                    ) : null}

                    {keywords.length ? (
                      <div className={`${styles.field} ${styles.infoHiddenUntilExpanded}`}>
                        <div className={styles.fieldLabel}>Keywords</div>
                        <div className={styles.chips}>
                          {keywords.slice(0, 30).map((k) => (
                            <Link
                              key={k}
                              className={`${styles.chip} ${styles.chipLink}`}
                              href={`/?q=${encodeURIComponent(k)}`}
                              title={`Search: ${k}`}
                            >
                              {k}
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {dominantColors.length ? (
                      <div className={`${styles.field} ${styles.infoHiddenUntilExpanded}`}>
                        <div className={styles.fieldLabel}>Dominant colors</div>
                        <div className={styles.colorRow}>
                          {dominantColors.slice(0, 12).map((c, idx) => {
                            const css = colorToCss(c);
                            const q = (css ?? colorLabel(c)).trim();
                            const content = (
                              <>
                                <div
                                  className={styles.colorSwatch}
                                  aria-hidden="true"
                                  style={{ background: css ?? undefined }}
                                />
                                <div className={styles.colorText}>{colorLabel(c)}</div>
                              </>
                            );
                            return (
                              <Link
                                key={`${String(c)}-${idx}`}
                                className={`${styles.colorItem} ${styles.colorItemLink}`}
                                href={`/?q=${encodeURIComponent(q)}`}
                                title={`Search: ${q}`}
                              >
                                {content}
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {!caption && !keywords.length && !dominantColors.length && !dimsText ? (
                      <div className={styles.note}>
                        No extra metadata fields found (caption/keywords/colors).
                      </div>
                    ) : null}
                  </div>

                  <label className={styles.infoClampToggle} htmlFor={infoToggleId}>
                    <span className={styles.infoClampMore}>Show all</span>
                    <span className={styles.infoClampLess}>Show less</span>
                  </label>
                </div>
              </div>
            </aside>
          </div>

          <SimilarItems resourceId={id} />
        </main>
      </div>
    );
  } catch (error) {
    if (error instanceof FabricApiError && error.status === 404) {
      notFound();
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    return (
      <div className={sharedStyles.page}>
        <main className={`${sharedStyles.main} ${styles.main}`}>
          <h1 className={styles.title}>Resource</h1>
          <p className={styles.note}>Failed to load: {message}</p>
        </main>
      </div>
    );
  }
}
