"use client";

import * as React from "react";

import styles from "./ShareButton.module.css";

type Props = {
    resourceId: string;
    name?: string | null;
    className?: string;
    title?: string;
    label?: string;
};

function ShareIcon() {
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
                d="M16 8a3 3 0 1 0-2.8-4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
            <path
                d="M8 12l8-4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
            <path
                d="M8 12l8 4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
            <path
                d="M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                stroke="currentColor"
                strokeWidth="1.8"
            />
            <path
                d="M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                stroke="currentColor"
                strokeWidth="1.8"
            />
        </svg>
    );
}

function buildLink(resourceId: string): string {
    if (typeof window === "undefined") return `/resource/${resourceId}`;
    return `${window.location.origin}/resource/${resourceId}`;
}

function openPopup(url: string) {
    const w = 720;
    const h = 640;
    const left = Math.max(0, Math.round((window.screen.width - w) / 2));
    const top = Math.max(0, Math.round((window.screen.height - h) / 2));
    window.open(
        url,
        "_blank",
        `noopener,noreferrer,width=${w},height=${h},left=${left},top=${top}`,
    );
}

function buildShareUrls(opts: { url: string; text: string }) {
    const u = encodeURIComponent(opts.url);
    const t = encodeURIComponent(opts.text);
    return {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
        x: `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
        linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
        telegram: `https://t.me/share/url?url=${u}&text=${t}`,
        reddit: `https://www.reddit.com/submit?url=${u}&title=${t}`,
        whatsapp: `https://wa.me/?text=${encodeURIComponent(`${opts.text} ${opts.url}`.trim())}`,
    };
}

export function ShareButton({
    resourceId,
    name,
    className,
    title = "Share",
    label = "",
}: Props) {
    const wrapRef = React.useRef<HTMLDivElement | null>(null);
    const onClick = React.useCallback(
        async (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            // Toggle menu on click; attempt native share first.

            const url = buildLink(resourceId);
            const text = (name ?? "").trim() || "Resource";

            const nav: any = window.navigator;
            if (nav?.share) {
                try {
                    await nav.share({ title: text, text, url });
                    return;
                } catch {
                    // fall through
                }
            }

            setOpen((v) => !v);
        },
        [name, resourceId],
    );

    const [open, setOpen] = React.useState(false);
    const [copied, setCopied] = React.useState(false);

    React.useEffect(() => {
        if (!open) return;
        const onKeyDown = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") setOpen(false);
        };
        const onDown = (ev: MouseEvent) => {
            const root = wrapRef.current;
            if (!root) return;
            const target = ev.target as Node | null;
            if (target && root.contains(target)) return;
            setOpen(false);
        };
        window.addEventListener("keydown", onKeyDown);
        document.addEventListener("mousedown", onDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("mousedown", onDown);
        };
    }, [open]);

    const share = React.useMemo(() => {
        const url = buildLink(resourceId);
        const text = (name ?? "").trim() || "Resource";
        return { url, text, urls: buildShareUrls({ url, text }) };
    }, [name, resourceId]);

    const onCopy = React.useCallback(async () => {
        try {
            await window.navigator.clipboard.writeText(share.url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        } catch {
            openPopup(share.url);
        } finally {
            setOpen(false);
        }
    }, [share.url]);

    const onShareTo = React.useCallback(
        (target: keyof ReturnType<typeof buildShareUrls>) => {
            openPopup(share.urls[target]);
            setOpen(false);
        },
        [share.urls],
    );

    const showText = Boolean(label && label.trim());
    const ariaLabel = showText ? label : "Share";

    return (
        <div ref={wrapRef} className={styles.wrap}>
            <button
                type="button"
                className={className}
                onClick={onClick}
                title={title}
                aria-label={ariaLabel}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <ShareIcon />
                {showText ? <span style={{ marginLeft: 6 }}>{label}</span> : null}
            </button>

            {open ? (
                <div className={styles.menu} role="menu" aria-label="Share options">
                    <button
                        type="button"
                        className={styles.item}
                        role="menuitem"
                        onClick={() => onShareTo("facebook")}
                    >
                        Facebook
                    </button>
                    <button
                        type="button"
                        className={styles.item}
                        role="menuitem"
                        onClick={() => onShareTo("x")}
                    >
                        X (Twitter)
                    </button>
                    <button
                        type="button"
                        className={styles.item}
                        role="menuitem"
                        onClick={() => onShareTo("linkedin")}
                    >
                        LinkedIn
                    </button>
                    <button
                        type="button"
                        className={styles.item}
                        role="menuitem"
                        onClick={() => onShareTo("telegram")}
                    >
                        Telegram
                    </button>
                    <button
                        type="button"
                        className={styles.item}
                        role="menuitem"
                        onClick={() => onShareTo("reddit")}
                    >
                        Reddit
                    </button>
                    <button
                        type="button"
                        className={styles.item}
                        role="menuitem"
                        onClick={() => onShareTo("whatsapp")}
                    >
                        WhatsApp
                    </button>

                    <div className={styles.sep} aria-hidden="true" />

                    <button
                        type="button"
                        className={styles.item}
                        role="menuitem"
                        onClick={onCopy}
                    >
                        {copied ? "Copied" : "Copy link"}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
