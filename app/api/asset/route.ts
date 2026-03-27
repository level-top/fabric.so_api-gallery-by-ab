import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

function buildWatermarkSvg(width: number, height: number): Buffer {
    // NOTE: Avoid <text> in SVG: on Vercel/serverless the font stack can be missing,
    // resulting in the watermark rendering as small "□" boxes. Use a font-free vector mark.
    const minDim = Math.min(width, height);
    // Keep it subtle: scale with image size, but clamp to avoid huge "badge" looking marks.
    const size = Math.round(Math.max(56, Math.min(220, minDim * 0.14)));
    const x = Math.round(width / 2 - size / 2);
    const y = Math.round(height / 2 - size / 2);
    const scale = size / 64;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <g transform="translate(${x} ${y}) rotate(-18 ${Math.round(size / 2)} ${Math.round(size / 2)}) scale(${scale})">
        <path d="M22 42V22h22v6H29v3h13v6H29v5h-7Z" fill="#FFFFFF" fill-opacity="0.14"/>
        <path d="M22 42V22h22v6H29v3h13v6H29v5h-7Z" fill="none" stroke="#000000" stroke-opacity="0.14" stroke-width="2.2"/>
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
    const dispositionType = inline ? "inline" : "attachment";

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

    // Images: optionally watermark (requires buffering).
    const upstreamBody = await upstream.arrayBuffer();
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
