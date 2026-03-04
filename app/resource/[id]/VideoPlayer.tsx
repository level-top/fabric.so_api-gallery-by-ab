"use client";

import * as React from "react";

import styles from "./resource.module.css";

type Props = {
    src: string;
};

function buildInlineProxyUrl(url: string): string {
    const params = new URLSearchParams();
    params.set("url", url);
    params.set("inline", "1");
    return `/api/asset?${params.toString()}`;
}

function PlayIcon() {
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
                d="M8 6.5v11l10-5.5-10-5.5Z"
                fill="currentColor"
            />
        </svg>
    );
}

function PauseIcon() {
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
            <path d="M7 6h3v12H7z" fill="currentColor" />
            <path d="M14 6h3v12h-3z" fill="currentColor" />
        </svg>
    );
}

function MutedIcon() {
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
                d="M11 5 6.5 9H4v6h2.5L11 19V5Z"
                fill="currentColor"
            />
            <path
                d="M16 9l4 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
            <path
                d="M20 9l-4 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    );
}

function VolumeIcon() {
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
                d="M11 5 6.5 9H4v6h2.5L11 19V5Z"
                fill="currentColor"
            />
            <path
                d="M14.5 9.2c1 .9 1.5 1.9 1.5 2.8s-.5 2-1.5 2.8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
            <path
                d="M16.8 7.2c1.7 1.6 2.6 3.3 2.6 4.8s-.9 3.2-2.6 4.8"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    );
}

export function VideoPlayer({ src }: Props) {
    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const [isPlaying, setIsPlaying] = React.useState(false);
    const [isMuted, setIsMuted] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    const proxiedSrc = React.useMemo(() => buildInlineProxyUrl(src), [src]);

    React.useEffect(() => {
        const el = videoRef.current;
        if (!el) return;
        // Ensure the element reloads when src changes.
        setError(null);
        el.load();
    }, [proxiedSrc]);

    React.useEffect(() => {
        const el = videoRef.current;
        if (!el) return;

        const sync = () => {
            setIsPlaying(!el.paused && !el.ended);
            setIsMuted(Boolean(el.muted));
        };

        sync();
        el.addEventListener("play", sync);
        el.addEventListener("pause", sync);
        el.addEventListener("ended", sync);
        el.addEventListener("volumechange", sync);

        return () => {
            el.removeEventListener("play", sync);
            el.removeEventListener("pause", sync);
            el.removeEventListener("ended", sync);
            el.removeEventListener("volumechange", sync);
        };
    }, []);

    const onTogglePlay = React.useCallback(async () => {
        const el = videoRef.current;
        if (!el) return;
        if (el.paused || el.ended) {
            try {
                await el.play();
            } catch {
                setError("This video couldn’t be played. It may be a protected link or an unsupported format.");
            }
        } else {
            el.pause();
        }
    }, []);

    const onToggleMute = React.useCallback(() => {
        const el = videoRef.current;
        if (!el) return;
        el.muted = !el.muted;
    }, []);

    return (
        <div className={styles.videoWrap}>
            <video
                ref={videoRef}
                className={styles.media}
                preload="metadata"
                muted
                playsInline
                onClick={onTogglePlay}
                onError={() =>
                    setError("This video couldn’t be loaded. The source may be unavailable or blocked.")
                }
            >
                <source src={proxiedSrc} />
            </video>

            <div className={styles.videoControls}>
                <button
                    type="button"
                    className={styles.actionIconButton}
                    onClick={onTogglePlay}
                    title={isPlaying ? "Pause" : "Play"}
                    aria-label={isPlaying ? "Pause video" : "Play video"}
                >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                </button>
                <button
                    type="button"
                    className={styles.actionIconButton}
                    onClick={onToggleMute}
                    title={isMuted ? "Unmute" : "Mute"}
                    aria-label={isMuted ? "Unmute video" : "Mute video"}
                >
                    {isMuted ? <MutedIcon /> : <VolumeIcon />}
                </button>
            </div>

            {error ? <div className={styles.videoError}>{error}</div> : null}
        </div>
    );
}
