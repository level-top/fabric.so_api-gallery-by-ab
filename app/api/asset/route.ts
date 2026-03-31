import { NextResponse } from "next/server";

export const runtime = "nodejs";

function wantsOgImage(searchParams: URLSearchParams): boolean {
    const v = (searchParams.get("og") ?? "").trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
}

function parsePositiveInt(searchParams: URLSearchParams, key: string, min: number, max: number): number | null {
    const raw = (searchParams.get(key) ?? "").trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const i = Math.round(n);
    if (i < min || i > max) return null;
    return i;
}

function wantsWatermark(searchParams: URLSearchParams): boolean {
    const v = (searchParams.get("wm") ?? "").trim().toLowerCase();
    if (!v) return false;
    if (v === "true" || v === "yes") return true;
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
}

function wantsInline(searchParams: URLSearchParams): boolean {
    const v = (searchParams.get("inline") ?? "").trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
}

function sharpFormatFromContentType(contentType: string): "jpeg" | "png" | "webp" | "avif" | null {
    const ct = contentType.toLowerCase().split(";")[0].trim();
    if (ct === "image/jpeg" || ct === "image/jpg") return "jpeg";
    if (ct === "image/png") return "png";
    if (ct === "image/webp") return "webp";
    if (ct === "image/avif") return "avif";
    return null;
}

type Segment = readonly [number, number, number, number];

function glyphSegments(ch: string): { segments: Segment[]; advance: number } {
    // Simple monoline uppercase glyphs in a 10(w) x 14(h) box.
    // Rendered with strokes so we don't depend on server fonts.
    const c = ch.toUpperCase();
    const adv = 12; // 10 width + 2 spacing
    const s: Segment[] = [];

    // Common coordinates
    const top = 1;
    const mid = 7;
    const bot = 13;
    const left = 1;
    const right = 9;

    // Helper shorthands
    const seg = (x1: number, y1: number, x2: number, y2: number) => s.push([x1, y1, x2, y2] as const);

    switch (c) {
        case "A":
            seg(left, bot, 5, top);
            seg(5, top, right, bot);
            seg(3, mid, 7, mid);
            break;
        case "B":
            seg(left, top, left, bot);
            seg(left, top, 7, top);
            seg(7, top, 8, 3);
            seg(8, 3, 7, mid);
            seg(left, mid, 7, mid);
            seg(7, mid, 8, 11);
            seg(8, 11, 7, bot);
            seg(left, bot, 7, bot);
            break;
        case "D":
            seg(left, top, left, bot);
            seg(left, top, 7, 2);
            seg(7, 2, 8, 4);
            seg(8, 4, 8, 10);
            seg(8, 10, 7, 12);
            seg(7, 12, left, bot);
            break;
        case "E":
            seg(left, top, left, bot);
            seg(left, top, right, top);
            seg(left, mid, 7, mid);
            seg(left, bot, right, bot);
            break;
        case "G":
            seg(8, 4, 7, 2);
            seg(7, 2, 3, 2);
            seg(3, 2, 2, 4);
            seg(2, 4, 2, 10);
            seg(2, 10, 3, 12);
            seg(3, 12, 7, 12);
            seg(7, 12, 8, 10);
            seg(8, 8, 6, 8);
            break;
        case "I":
            seg(5, top, 5, bot);
            seg(3, top, 7, top);
            seg(3, bot, 7, bot);
            break;
        case "N":
            seg(left, bot, left, top);
            seg(left, top, right, bot);
            seg(right, bot, right, top);
            break;
        case "R":
            seg(left, top, left, bot);
            seg(left, top, 7, top);
            seg(7, top, 8, 4);
            seg(8, 4, 7, mid);
            seg(left, mid, 7, mid);
            seg(6, mid, right, bot);
            break;
        case "S":
            seg(8, 3, 7, 2);
            seg(7, 2, 3, 2);
            seg(3, 2, 2, 4);
            seg(2, 4, 8, 9);
            seg(8, 9, 7, 12);
            seg(7, 12, 3, 12);
            seg(3, 12, 2, 11);
            break;
        case " ":
            return { segments: [], advance: 8 };
        default:
            // Unknown char: draw a small dash.
            seg(3, mid, 7, mid);
            break;
    }

    return { segments: s, advance: adv };
}

function buildVectorTextPaths(lines: string[]): { width: number; height: number; paths: string } {
    const lineHeight = 14;
    const lineGap = 7;

    const layouts = lines.map((line) => {
        let x = 0;
        const parts: string[] = [];
        for (const ch of line) {
            const { segments, advance } = glyphSegments(ch);
            for (const [x1, y1, x2, y2] of segments) {
                parts.push(`M ${x + x1} ${y1} L ${x + x2} ${y2}`);
            }
            x += advance;
        }
        return { d: parts.join(" "), width: x ? x - 2 : 0 };
    });

    const width = Math.max(0, ...layouts.map((l) => l.width));
    const height = lines.length * lineHeight + (lines.length - 1) * lineGap;

    const paths = layouts
        .map((l, idx) => {
            if (!l.d) return "";
            const yOff = idx * (lineHeight + lineGap);
            const xOff = Math.round((width - l.width) / 2);
            return `<path d="${l.d}" transform="translate(${xOff} ${yOff})"/>`;
        })
        .join("\n");

    return { width, height, paths };
}

function buildWatermarkSvg(width: number, height: number): Buffer {
    // NOTE: Avoid <text> in SVG: on Vercel/serverless the font stack can be missing,
    // resulting in the watermark rendering as small "□" boxes. Use a font-free vector mark.
    const minDim = Math.min(width, height);
    // Target width of the whole watermark block; clamped to remain subtle.
    const targetBlockWidth = Math.round(Math.max(160, Math.min(420, minDim * 0.30)));
    const { width: blockW, height: blockH, paths } = buildVectorTextPaths(["AB", "DESIGNER"]);

    // Scale the vector glyphs to the desired on-image size.
    const scale = blockW > 0 ? targetBlockWidth / blockW : 1;
    const scaledW = blockW * scale;
    const scaledH = blockH * scale;
    const cx = Math.round(width / 2);
    const cy = Math.round(height / 2);

    const rot = -18;
    const x = Math.round(cx - scaledW / 2);
    const y = Math.round(cy - scaledH / 2);

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <g transform="translate(${x} ${y}) rotate(${rot} ${Math.round(scaledW / 2)} ${Math.round(scaledH / 2)}) scale(${scale})">
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <g stroke="#000000" stroke-opacity="0.14" stroke-width="3.6">
        ${paths}
      </g>
      <g stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="2.8">
        ${paths}
      </g>
    </g>
  </g>
</svg>`;

    return Buffer.from(svg, "utf8");
}

async function maybeWatermarkImage(
    body: ArrayBuffer,
    contentType: string,
    enabled: boolean,
): Promise<{ body: ArrayBuffer; applied: boolean; error?: string }> {
    if (!enabled) return { body, applied: false };

    const ct = contentType.toLowerCase().split(";")[0].trim();
    if (!ct.startsWith("image/")) return { body, applied: false, error: "not-image" };
    if (ct === "image/gif" || ct === "image/svg+xml") return { body, applied: false, error: "unsupported" };

    const outFormat = sharpFormatFromContentType(contentType);
    if (!outFormat) return { body, applied: false, error: "unsupported-format" };

    try {
        const sharp = (await import("sharp")).default;
        const img = sharp(Buffer.from(body), { failOn: "none" });
        const meta = await img.metadata();
        const width = meta.width;
        const height = meta.height;
        if (!width || !height) return { body, applied: false, error: "no-dimensions" };

        const svg = buildWatermarkSvg(width, height);
        const piped = img.composite([{ input: svg, top: 0, left: 0 }]);
        const out = await (outFormat === "jpeg"
            ? piped.jpeg({ quality: 92, mozjpeg: true })
            : outFormat === "webp"
                ? piped.webp({ quality: 90 })
                : outFormat === "avif"
                    ? piped.avif({ quality: 70 })
                    : piped.png())
            .toBuffer();

        return { body: Uint8Array.from(out).buffer, applied: true };
    } catch {
        // Keep downloads working even if watermarking fails, but surface it in logs/headers.
        console.warn("[asset] watermark failed");
        return { body, applied: false, error: "sharp-failed" };
    }
}

function getFabricAuthHeaders(): Record<string, string> {
    const apiKey = (process.env.FABRIC_API_KEY ?? "").trim();
    const accessToken = (process.env.FABRIC_ACCESS_TOKEN ?? "").trim();
    if (apiKey) return { "X-Api-Key": apiKey };
    if (accessToken) return { Authorization: `Bearer ${accessToken}` };
    return {};
}

function getFabricApiHost(): string {
    const baseUrl = (process.env.FABRIC_API_BASE_URL ?? "https://api.fabric.so").trim();
    try {
        return new URL(baseUrl).hostname.toLowerCase();
    } catch {
        return "api.fabric.so";
    }
}

function isPrivateHostname(hostname: string): boolean {
    const h = hostname.toLowerCase();
    if (h === "localhost" || h === "0.0.0.0" || h === "::1") return true;

    const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
        const parts = ipv4.slice(1).map((x) => Number(x));
        if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;

        const [a, b] = parts;
        if (a === 10) return true;
        if (a === 127) return true;
        if (a === 0) return true;
        if (a === 169 && b === 254) return true;
        if (a === 192 && b === 168) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
    }

    return false;
}

function sanitizeFilename(value: string): string {
    const t = value.trim().slice(0, 180);
    if (!t) return "asset";
    return t.replace(/[\\/:*?"<>|\r\n]+/g, "-");
}

function extFromContentType(contentType: string): string | null {
    const ct = contentType.toLowerCase().split(";")[0].trim();
    if (ct === "image/jpeg") return ".jpg";
    if (ct === "image/jpg") return ".jpg";
    if (ct === "image/png") return ".png";
    if (ct === "image/webp") return ".webp";
    if (ct === "image/gif") return ".gif";
    if (ct === "image/svg+xml") return ".svg";
    if (ct === "video/mp4") return ".mp4";
    if (ct === "video/webm") return ".webm";
    if (ct === "video/quicktime") return ".mov";
    return null;
}

function looksLikeHasExtension(filename: string): boolean {
    return /\.[a-z0-9]{2,6}$/i.test(filename);
}

function extFromPathname(pathname: string): string | null {
    const base = pathname.split("?")[0].split("#")[0];
    const m = base.match(/\.[a-z0-9]{2,6}$/i);
    return m ? m[0].toLowerCase() : null;
}

function withBestExtension(filenameRaw: string, contentType: string, pathname: string): string {
    const filename = sanitizeFilename(filenameRaw);
    if (looksLikeHasExtension(filename)) return filename;

    const pathExt = extFromPathname(pathname);
    if (pathExt) return `${filename}${pathExt}`;

    const ctExt = extFromContentType(contentType);
    if (ctExt) return `${filename}${ctExt}`;

    return filename;
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const url = (searchParams.get("url") ?? "").trim();
    const filenameParam = (searchParams.get("filename") ?? "").trim();
    const watermark = wantsWatermark(searchParams);
    const inline = wantsInline(searchParams);
    const og = wantsOgImage(searchParams);
    const ogWidth = parsePositiveInt(searchParams, "w", 240, 2000);
    if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

    let target: URL;
    try {
        target = new URL(url);
    } catch {
        return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    if (target.protocol !== "https:" && target.protocol !== "http:") {
        return NextResponse.json({ error: "Unsupported protocol" }, { status: 400 });
    }

    if (target.username || target.password) {
        return NextResponse.json({ error: "Credentials not allowed" }, { status: 400 });
    }

    if (isPrivateHostname(target.hostname)) {
        return NextResponse.json({ error: "Host not allowed" }, { status: 400 });
    }

    if (target.port && target.port !== "80" && target.port !== "443") {
        return NextResponse.json({ error: "Port not allowed" }, { status: 400 });
    }

    const fabricApiHost = getFabricApiHost();
    const authHeaders = target.hostname.toLowerCase() === fabricApiHost ? getFabricAuthHeaders() : {};

    const range = req.headers.get("range") ?? undefined;

    const upstream = await fetch(target.toString(), {
        method: "GET",
        headers: {
            "User-Agent": "fabric-gallery-asset-proxy",
            ...(range ? { Range: range } : {}),
            ...authHeaders,
        },
        cache: range ? "no-store" : "force-cache",
    });

    if (!upstream.ok) {
        const preview = await upstream.text().catch(() => "");
        return NextResponse.json(
            {
                error: `Upstream error ${upstream.status}`,
                upstreamPreview: preview.slice(0, 300),
            },
            { status: 502 },
        );
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

    // Prevent downloading API error pages as "images".
    const ctLower = contentType.toLowerCase();
    const isImageOrVideo = ctLower.startsWith("image/") || ctLower.startsWith("video/");
    if (!isImageOrVideo) {
        const preview = await upstream.text().catch(() => "");
        return NextResponse.json(
            {
                error: "The download URL did not return an image/video file.",
                upstreamContentType: contentType,
                upstreamPreview: preview.slice(0, 300),
            },
            { status: 415 },
        );
    }

    const baseName = filenameParam || target.pathname.split("/").pop() || "asset";
    const filename = withBestExtension(baseName, contentType, target.pathname);
    const dispositionType = inline || og ? "inline" : "attachment";

    // Important for playable video: stream + pass through Range/206 headers.
    if (ctLower.startsWith("video/")) {
        const headers = new Headers();
        headers.set("Content-Type", contentType);
        headers.set(
            "Content-Disposition",
            `${dispositionType}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        );
        headers.set("X-Content-Type-Options", "nosniff");

        const passthrough = [
            "accept-ranges",
            "content-range",
            "content-length",
            "etag",
            "last-modified",
        ];
        for (const h of passthrough) {
            const v = upstream.headers.get(h);
            if (v) headers.set(h, v);
        }

        headers.set("Cache-Control", inline ? "no-store" : "public, max-age=86400");

        return new NextResponse(upstream.body, {
            status: upstream.status,
            headers,
        });
    }

    // Images: optionally watermark (requires buffering). For OG previews (og=1),
    // re-encode as JPEG for better compatibility with social preview scrapers.
    const upstreamBody = await upstream.arrayBuffer();

    if (og) {
        try {
            const sharp = (await import("sharp")).default;
            let img = sharp(Buffer.from(upstreamBody), { failOn: "none" });
            if (ogWidth) {
                img = img.resize({ width: ogWidth, withoutEnlargement: true, fit: "inside" });
            }
            const out = await img
                .jpeg({ quality: 82, mozjpeg: true })
                .toBuffer();

            const headers = new Headers();
            headers.set("Content-Type", "image/jpeg");
            headers.set(
                "Content-Disposition",
                `inline; filename="${sanitizeFilename(baseName)}.jpg"; filename*=UTF-8''${encodeURIComponent(
                    `${sanitizeFilename(baseName)}.jpg`,
                )}`,
            );
            headers.set("Cache-Control", "public, max-age=86400");
            headers.set("X-Content-Type-Options", "nosniff");
            headers.set("X-Asset-Og", "1");
            if (ogWidth) headers.set("X-Asset-Og-Width", String(ogWidth));

            return new NextResponse(Uint8Array.from(out), { status: 200, headers });
        } catch {
            // Fall through to normal pipeline if re-encoding fails.
            console.warn("[asset] og image re-encode failed");
        }
    }

    const wm = await maybeWatermarkImage(upstreamBody, contentType, watermark);

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set(
        "Content-Disposition",
        `${dispositionType}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    // Avoid stale CDN/browser cache issues for watermarked assets.
    headers.set("Cache-Control", watermark || inline ? "no-store" : "public, max-age=86400");
    headers.set("X-Content-Type-Options", "nosniff");
    if (watermark) {
        headers.set("X-Asset-Watermark", wm.applied ? "applied" : "skipped");
        if (!wm.applied && wm.error) headers.set("X-Asset-Watermark-Reason", wm.error);
    }

    return new NextResponse(wm.body, {
        status: 200,
        headers,
    });
}
