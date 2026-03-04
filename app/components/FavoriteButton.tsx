"use client";

import * as React from "react";

const FAVORITES_KEY = "fabric-gallery:favorites:v1";
const FAVORITES_EVENT = "fabric-gallery:favorites-changed";

type Props = {
    resourceId: string;
    className?: string;
    title?: string;
    label?: string;
};

function HeartIcon({ filled }: { filled: boolean }) {
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
                d="M12 20.6s-7.6-4.4-9.6-9.1C1 8.2 2.8 5.7 5.7 5.2c1.8-.3 3.6.4 4.7 1.8 1.1-1.4 2.9-2.1 4.7-1.8 2.9.5 4.7 3 3.3 6.3-2 4.7-9.6 9.1-9.6 9.1Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
                fill={filled ? "currentColor" : "none"}
            />
        </svg>
    );
}

function loadFavorites(): Set<string> {
    try {
        const raw = localStorage.getItem(FAVORITES_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return new Set();
        const out = new Set<string>();
        for (const v of parsed) {
            if (typeof v === "string" && v.trim()) out.add(v);
        }
        return out;
    } catch {
        return new Set();
    }
}

function saveFavorites(set: Set<string>) {
    try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(set)));
    } catch {
        // ignore
    }
}

export function FavoriteButton({
    resourceId,
    className,
    title = "Add to favourites",
    label = "",
}: Props) {
    const [isFav, setIsFav] = React.useState(false);

    React.useEffect(() => {
        const favs = loadFavorites();
        setIsFav(favs.has(resourceId));

        const onStorage = (e: StorageEvent) => {
            if (e.key !== FAVORITES_KEY) return;
            const next = loadFavorites();
            setIsFav(next.has(resourceId));
        };

        const onCustom = () => {
            const next = loadFavorites();
            setIsFav(next.has(resourceId));
        };

        window.addEventListener("storage", onStorage);
        window.addEventListener(FAVORITES_EVENT, onCustom as EventListener);
        return () => {
            window.removeEventListener("storage", onStorage);
            window.removeEventListener(FAVORITES_EVENT, onCustom as EventListener);
        };
    }, [resourceId]);

    const onClick = React.useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const favs = loadFavorites();
            const nextIsFav = !favs.has(resourceId);
            if (nextIsFav) favs.add(resourceId);
            else favs.delete(resourceId);
            saveFavorites(favs);
            setIsFav(nextIsFav);

            try {
                window.dispatchEvent(new Event(FAVORITES_EVENT));
            } catch {
                // ignore
            }
        },
        [resourceId],
    );

    const aria = isFav ? "Remove from favourites" : "Add to favourites";
    const showText = Boolean(label && label.trim());

    return (
        <button
            type="button"
            className={className}
            onClick={onClick}
            title={isFav ? "Remove from favourites" : title}
            aria-label={aria}
        >
            <HeartIcon filled={isFav} />
            {showText ? <span style={{ marginLeft: 6 }}>{label}</span> : null}
        </button>
    );
}
