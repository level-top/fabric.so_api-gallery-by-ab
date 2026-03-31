"use client";

import * as React from "react";

type Props = {
    phoneNumber?: string;
    resourceId: string;
    name?: string | null;
    thumbnailUrl?: string | null;
    className?: string;
    title?: string;
    label?: string;
};

function WhatsAppIcon({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            focusable="false"
        >
            <path
                d="M20.2 3.8C18 1.6 15.1.4 12.1.4 5.9.4.9 5.4.9 11.6c0 2 .5 3.9 1.5 5.7L1 23l5.9-1.5c1.7.9 3.6 1.3 5.5 1.3 6.2 0 11.2-5 11.2-11.2 0-3-.9-5.9-3.4-7.8Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
            />
            <path
                d="M8.2 7.8c.3-.8.6-.8 1.1-.8h.9c.2 0 .5 0 .7.4.2.4.9 2.1 1 2.3.1.2.1.4 0 .6-.1.2-.2.4-.4.6-.2.2-.4.4-.2.8.2.4.8 1.3 1.7 2.1.9.8 1.7 1.1 2.1 1.3.4.2.6.1.8-.1.2-.2.9-1.1 1.1-1.5.2-.4.4-.3.7-.2.3.1 2 .9 2.3 1 .3.1.5.2.6.3.1.2.1 1.1-.3 2.1-.4 1-2.1 1.9-2.9 2-.7.1-1.6.2-4.9-1.1-4-1.6-6.6-5.7-6.8-5.9-.2-.2-1.6-2.1-1.6-4 0-2 .9-2.9 1.2-3.3Z"
                fill="currentColor"
            />
        </svg>
    );
}

function toWhatsAppPhone(raw: string): string {
    const digits = raw.replace(/\D+/g, "");
    if (!digits) return "";

    // If user passes a local PK mobile number like 0324xxxxxxx, convert to 92xxxxxxxxxx.
    // WhatsApp wa.me requires country code and no leading '+'.
    if (digits.length === 11 && digits.startsWith("0")) {
        return `92${digits.slice(1)}`;
    }

    return digits;
}

function buildMessage(args: {
    name?: string | null;
    resourceId: string;
}): string {
    const lines: string[] = [];

    const name = (args.name ?? "").trim();
    if (name) lines.push(`Name: ${name}`);

    // Best-effort: include a link back to this resource.
    try {
        if (typeof window !== "undefined" && window.location?.origin) {
            // Put the URL on its own line so WhatsApp reliably auto-detects it for previews.
            lines.push(`${window.location.origin}/resource/${args.resourceId}`);
        }
    } catch {
        // ignore
    }

    return lines.join("\n");
}

export function WhatsAppShareButton({
    phoneNumber = "03247639639",
    resourceId,
    name,
    thumbnailUrl: _thumbnailUrl,
    className,
    title = "Share on WhatsApp",
    label = "WhatsApp",
}: Props) {
    const onClick = React.useCallback(
        async (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const phone = toWhatsAppPhone(phoneNumber);
            if (!phone) return;

            const text = buildMessage({ name, resourceId });
            const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
            window.open(url, "_blank", "noopener,noreferrer");
        },
        [name, phoneNumber, resourceId],
    );

    const ariaLabel = label && label.trim() ? label : "Share on WhatsApp";
    const showText = Boolean(label && label.trim());

    return (
        <button
            type="button"
            className={className}
            onClick={onClick}
            title={title}
            aria-label={ariaLabel}
        >
            <WhatsAppIcon />
            {showText ? <span style={{ marginLeft: 6 }}>{label}</span> : null}
        </button>
    );
}
