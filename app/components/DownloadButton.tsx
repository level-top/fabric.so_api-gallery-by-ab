"use client";

import * as React from "react";

type Props = {
    url: string | null;
    filename?: string | null;
    className?: string;
    title?: string;
    label?: string;
};

function extFromContentType(contentType: string): string {
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
    return "";
}

function hasExtension(name: string): boolean {
    return /\.[a-z0-9]{2,6}$/i.test(name.trim());
}

function sanitizeFilename(value: string): string {
    const t = String(value ?? "").trim().slice(0, 180);
    if (!t) return "asset";
    return t.replace(/[\\/:*?"<>|\r\n]+/g, "-");
}

function parseFilenameFromContentDisposition(value: string | null): string | null {
    if (!value) return null;

    // filename*=UTF-8''...
    const star = value.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
    if (star && star[1]) {
        const raw = star[1].trim().replace(/^"|"$/g, "");
        try {
            const decoded = decodeURIComponent(raw);
            return decoded ? sanitizeFilename(decoded) : null;
        } catch {
            return sanitizeFilename(raw);
        }
    }

    const m = value.match(/filename=([^;]+)/i);
    if (!m || !m[1]) return null;
    const raw = m[1].trim().replace(/^"|"$/g, "");
    return raw ? sanitizeFilename(raw) : null;
}

function DownloadIcon() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            focusable="false"
        >
            <path
                d="M12 3v10"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
            <path
                d="M8 11.5 12 14.8l4-3.3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M5 20h14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    );
}

function buildProxyUrl(url: string, filename?: string | null): string {
    const params = new URLSearchParams();
    params.set("url", url);
    // `wm` is versioned to help bust CDN/browser caches after watermark tweaks.
    params.set("wm", "2");
    if (filename && filename.trim()) params.set("filename", filename.trim());
    return `/api/asset?${params.toString()}`;
}

export function DownloadButton({
    url,
    filename,
    className,
    title = "Download",
    label = "",
}: Props) {
    const [busy, setBusy] = React.useState(false);

    const onClick = React.useCallback(
        async (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!url) return;
            if (busy) return;

            setBusy(true);
            try {
                const href = buildProxyUrl(url, filename);
                const resp = await fetch(href, { method: "GET" });

                if (!resp.ok) {
                    const json = (await resp.json().catch(() => null)) as any;
                    const msg =
                        typeof json?.error === "string"
                            ? json.error
                            : `Download failed (${resp.status})`;
                    window.alert(msg);
                    return;
                }

                const contentType = resp.headers.get("content-type") ?? "application/octet-stream";
                const ctLower = contentType.toLowerCase();
                const isImageOrVideo = ctLower.startsWith("image/") || ctLower.startsWith("video/");
                if (!isImageOrVideo) {
                    window.alert("This URL did not return an image/video file.");
                    return;
                }

                const blob = await resp.blob();
                const cdName = parseFilenameFromContentDisposition(
                    resp.headers.get("content-disposition"),
                );
                const baseName = sanitizeFilename(filename || cdName || "asset");
                const finalName = hasExtension(baseName)
                    ? baseName
                    : `${baseName}${extFromContentType(contentType)}`;

                const objectUrl = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = objectUrl;
                a.download = finalName;
                a.rel = "noopener";
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(objectUrl);
            } finally {
                setBusy(false);
            }
        },
        [busy, filename, url],
    );

    const showText = Boolean(label && label.trim());
    const ariaLabel = showText ? label : "Download";

    return (
        <button
            type="button"
            className={className}
            onClick={onClick}
            title={title}
            aria-label={ariaLabel}
            disabled={!url || busy}
        >
            <DownloadIcon />
            {showText ? <span style={{ marginLeft: 6 }}>{label}</span> : null}
        </button>
    );
}
