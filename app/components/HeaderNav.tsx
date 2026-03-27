"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import styles from "./HeaderNav.module.css";
import { SEED_FILENAME_TAGS } from "@/lib/seedFilenameTags";

const SEARCH_HISTORY_KEY = "fabric-gallery:search-history:v1";
const SEARCH_HISTORY_LIMIT = 10;
const SUGGESTION_LIMIT = 30;

const FAVORITES_KEY = "fabric-gallery:favorites:v1";
const FAVORITES_EVENT = "fabric-gallery:favorites-changed";

function loadFavoritesCount(): number {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return 0;
    const seen = new Set<string>();
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const id = v.trim();
      if (!id) continue;
      seen.add(id);
    }
    return seen.size;
  } catch {
    return 0;
  }
}

function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of parsed) {
      if (typeof v !== "string") continue;
      const term = normalizeQuery(v);
      if (!term) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(term);
      if (out.length >= SEARCH_HISTORY_LIMIT) break;
    }
    return out;
  } catch {
    return [];
  }
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/g).filter(Boolean).length;
}

function isUuidToken(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function isValidSuggestionTag(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  if (isUuidToken(t)) return false;
  if (wordCount(t) > 3) return false;
  return true;
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}

function parseHexToRgb(value: string): { r: number; g: number; b: number } | null {
  const s = value.trim();
  const raw = s.startsWith("#") ? s.slice(1) : s;
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if ([r, g, b].some((x) => Number.isNaN(x))) return null;
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
}

function toRgbText(r: number, g: number, b: number): string {
  return `rgb(${clampByte(r)},${clampByte(g)},${clampByte(b)})`;
}

function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 255);
}

export default function HeaderNav() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  const urlQuery = useMemo(() => {
    const q = searchParams.get("q");
    return typeof q === "string" ? normalizeQuery(q) : "";
  }, [searchParams]);

  const [query, setQuery] = useState<string>(urlQuery);
  const [panelOpen, setPanelOpen] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [favoritesCount, setFavoritesCount] = useState<number>(0);

  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    const refresh = () => setFavoritesCount(loadFavoritesCount());
    refresh();

    const onStorage = (e: StorageEvent) => {
      if (e.key !== FAVORITES_KEY) return;
      refresh();
    };

    const onCustom = () => refresh();

    window.addEventListener("storage", onStorage);
    window.addEventListener(FAVORITES_EVENT, onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(FAVORITES_EVENT, onCustom as EventListener);
    };
  }, []);

  const seedSuggestions = useMemo(() => {
    const q = normalizeQuery(query).toLowerCase();
    const all = Object.entries(SEED_FILENAME_TAGS)
      .map(([k, v]) => ({ k: k.trim(), v }))
      .filter((x) => isValidSuggestionTag(x.k) && typeof x.v === "number" && Number.isFinite(x.v) && x.v > 0)
      .sort((a, b) => b.v - a.v || a.k.localeCompare(b.k))
      .map((x) => x.k);

    if (!q) return all.slice(0, SUGGESTION_LIMIT);
    return all
      .filter((t) => t.toLowerCase().includes(q))
      .slice(0, SUGGESTION_LIMIT);
  }, [query]);

  const filteredHistory = useMemo(() => {
    const q = normalizeQuery(query).toLowerCase();
    if (!q) return history;
    return history.filter((t) => t.toLowerCase().includes(q));
  }, [history, query]);

  const filteredSuggestions = useMemo(() => {
    const q = normalizeQuery(query).toLowerCase();
    if (!q) return seedSuggestions;
    return seedSuggestions.filter((t) => t.toLowerCase().includes(q));
  }, [seedSuggestions, query]);

  const options = useMemo(() => {
    const out: Array<{ value: string; source: "recent" | "suggestion" }> = [];
    const seen = new Set<string>();
    for (const t of filteredHistory) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value: t, source: "recent" });
    }
    for (const t of filteredSuggestions) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value: t, source: "suggestion" });
    }
    return out;
  }, [filteredHistory, filteredSuggestions]);

  useEffect(() => {
    if (!panelOpen) return;
    setHistory(loadSearchHistory());
    setActiveIndex(-1);
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    setActiveIndex(-1);
  }, [panelOpen, query]);

  useEffect(() => {
    if (!panelOpen) return;
    const onDown = (e: MouseEvent) => {
      const root = searchWrapRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      if (target && root.contains(target)) return;
      setPanelOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [panelOpen]);

  const canSearch = normalizeQuery(query).length > 0;

  function runSearch(nextValue?: string) {
    const q = normalizeQuery(nextValue ?? query);
    if (!q) {
      router.push("/");
      return;
    }
    router.push(`/?q=${encodeURIComponent(q)}`);
    setPanelOpen(false);
    setActiveIndex(-1);
  }

  function pickFromPanel(value: string) {
    const next = normalizeQuery(value);
    if (!next) return;
    setQuery(next);
    runSearch(next);
  }

  function moveActive(dir: -1 | 1) {
    if (!options.length) return;
    setActiveIndex((prev) => {
      const next = prev < 0 ? (dir === 1 ? 0 : options.length - 1) : prev + dir;
      return Math.max(0, Math.min(options.length - 1, next));
    });
  }

  const premiumActive = pathname === "/premium";
  const favouritesActive = pathname === "/" && (searchParams.get("view") ?? "") === "favourites";

  const favouritesHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "favourites");
    // Avoid mixing favourites-only view with search/list query params.
    params.delete("q");
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }, [searchParams]);

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link className={styles.brand} href="/" aria-label="AB Designer home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.logo} src="/logo.jpeg" alt="" aria-hidden="true" />
          <div>
            <div className={styles.title}>AB Designer</div>
            <div className={styles.subtitle}>BY DNL</div>
          </div>
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          <Link
            className={`${styles.navLink} ${premiumActive ? styles.navLinkActive : ""}`}
            href="/premium"
          >
            Premium
          </Link>

          <Link
            className={`${styles.navLink} ${favouritesActive ? styles.navLinkActive : ""}`}
            href={favouritesHref}
            title={favoritesCount ? `Favourites (${favoritesCount})` : "Favourites"}
          >
            Favourites{favoritesCount ? ` (${favoritesCount})` : ""}
          </Link>
        </nav>

        <div
          ref={searchWrapRef}
          className={styles.search}
          role="search"
          aria-label="Site search"
        >
          <button
            type="button"
            className={styles.colorButton}
            onClick={() => colorInputRef.current?.click()}
            aria-label="Pick a color"
            title="Pick a color"
          >
            <svg
              className={styles.colorIcon}
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden="true"
              focusable="false"
            >
              <path
                fill="currentColor"
                d="M12 3C6.486 3 2 7.262 2 12.5 2 15.538 3.72 18 6.5 18H8c.552 0 1 .448 1 1 0 .178-.048.35-.14.5-.246.403-.386.873-.386 1.37C8.474 22.325 9.65 23 11 23h1c5.514 0 10-4.262 10-9.5S17.514 3 12 3Zm0 18h-1c-.456 0-.75-.17-.75-.13 0-.238.07-.43.193-.63.282-.462.432-.992.432-1.54 0-1.654-1.346-3-3-3H6.5C4.93 15.7 4 14.305 4 12.5 4 8.364 7.589 5 12 5s8 3.364 8 7.5S16.411 21 12 21Zm-5-8.5c-.828 0-1.5-.672-1.5-1.5S6.172 9.5 7 9.5s1.5.672 1.5 1.5S7.828 12.5 7 12.5Zm3-4c-.828 0-1.5-.672-1.5-1.5S9.172 5.5 10 5.5s1.5.672 1.5 1.5S10.828 8.5 10 8.5Zm4 0c-.828 0-1.5-.672-1.5-1.5S13.172 5.5 14 5.5s1.5.672 1.5 1.5S14.828 8.5 14 8.5Zm3 4c-.828 0-1.5-.672-1.5-1.5S16.172 9.5 17 9.5s1.5.672 1.5 1.5S17.828 12.5 17 12.5Z"
              />
            </svg>
          </button>

          <input
            ref={colorInputRef}
            className={styles.colorPickerInput}
            type="color"
            defaultValue="#000000"
            onChange={(e) => {
              const rgb = parseHexToRgb(e.target.value);
              if (!rgb) return;
              const next = toRgbText(rgb.r, rgb.g, rgb.b);
              setQuery(next);
              runSearch(next);
            }}
            tabIndex={-1}
            aria-hidden="true"
          />
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setPanelOpen(true)}
            onClick={() => setPanelOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setPanelOpen(false);
                setActiveIndex(-1);
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (!panelOpen) setPanelOpen(true);
                moveActive(1);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                if (!panelOpen) setPanelOpen(true);
                moveActive(-1);
                return;
              }
              if (e.key !== "Enter") return;
              // Avoid submitting while composing (IME).
              if ((e.nativeEvent as KeyboardEvent | undefined)?.isComposing) return;
              e.preventDefault();
              if (panelOpen && activeIndex >= 0 && activeIndex < options.length) {
                pickFromPanel(options[activeIndex]!.value);
                return;
              }
              runSearch();
            }}
            placeholder="Search designs (press Enter)…"
            aria-label="Search designs"
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="button"
            className={styles.searchButton}
            onClick={() => runSearch()}
            disabled={!canSearch}
          >
            Search
          </button>

          {panelOpen ? (
            <div className={styles.panel} role="dialog" aria-label="Search suggestions">
              <div className={styles.panelList} role="listbox" aria-label="Search suggestions list">
                {options.map((opt, idx) => (
                  <button
                    key={`${opt.source}:${opt.value}`}
                    type="button"
                    className={`${styles.panelItem} ${idx === activeIndex ? styles.panelItemActive : ""}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => pickFromPanel(opt.value)}
                    title={opt.value}
                    aria-selected={idx === activeIndex}
                    role="option"
                  >
                    {opt.value}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
