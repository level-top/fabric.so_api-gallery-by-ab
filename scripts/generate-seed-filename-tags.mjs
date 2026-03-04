import fs from "node:fs";
import path from "node:path";

function loadDotEnvIfPresent() {
  // Minimal `.env` loader (supports KEY=VALUE, ignores comments).
  // Next.js loads `.env.local` automatically, but plain `node` does not.
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, "utf8");
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    if (process.env[key] != null && String(process.env[key]).trim() !== "") continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function getFabricConfig() {
  loadDotEnvIfPresent();
  const baseUrl = process.env.FABRIC_API_BASE_URL ?? "https://api.fabric.so";
  const apiKey = (process.env.FABRIC_API_KEY ?? "").trim();
  const accessToken = (process.env.FABRIC_ACCESS_TOKEN ?? "").trim();

  if (!apiKey && !accessToken) {
    throw new Error(
      "Missing Fabric credentials. Set FABRIC_API_KEY (recommended) or FABRIC_ACCESS_TOKEN in .env.local.",
    );
  }

  const headers = apiKey
    ? { "X-Api-Key": apiKey }
    : { Authorization: `Bearer ${accessToken}` };

  return { baseUrl, headers };
}

function isUuidFilename(name) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]+$/i.test(
    String(name).trim(),
  );
}

function shouldIgnoreTagToken(tag) {
  const t = String(tag ?? "").trim();
  if (!t) return true;
  if (/^raw\b/i.test(t)) return true;
  return false;
}

function extractTagsFromName(nameRaw) {
  if (!nameRaw) return [];
  const name = String(nameRaw).trim();
  if (!name) return [];
  if (/\.webp$/i.test(name)) return [];
  if (isUuidFilename(name)) return [];

  const normalized = name
    .replace(/\s+/g, " ")
    .replace(/-\s+/g, " - ")
    .replace(/\s+-/g, " - ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = normalized
    .split(/\s-\s/g)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return [];

  const datePrefix = /^[A-Za-z]{1,6}\s*_\s*\d{1,2}\s+\d{1,2}\s+[\d.]{1,6}\s+/;
  parts[0] = parts[0].replace(datePrefix, "").trim();

  const out = [];
  for (const p of parts) {
    const t = p.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (/^[\d.]+$/.test(t)) continue;
    if (t.length < 2) continue;
    if (shouldIgnoreTagToken(t)) continue;
    out.push(t);
  }

  const seen = new Set();
  const deduped = [];
  for (const t of out) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }

  return deduped;
}

async function fetchResourcePage({ cursor, limit }) {
  const { baseUrl, headers } = getFabricConfig();

  const body = {
    kind: ["image", "video"],
    includeSubfolderCount: false,
    limit,
    ...(cursor ? { cursor } : {}),
    order: { property: "createdAt", direction: "DESC" },
  };

  const resp = await fetch(`${baseUrl}/v2/resources/filter`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Fabric API error ${resp.status}: ${text}`);
  }

  return await resp.json();
}

function toTsRecordSource(record) {
  const entries = Object.entries(record);
  entries.sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));

  const lines = [];
  for (const [k, v] of entries) {
    const safeKey = JSON.stringify(k);
    lines.push(`  ${safeKey}: ${Number(v)},`);
  }

  return `export const SEED_FILENAME_TAGS: Record<string, number> = {\n${lines.join("\n")}\n};\n`;
}

async function main() {
  const output = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(process.cwd(), "lib", "seedFilenameTags.ts");

  const maxPages = Number(process.env.SEED_TAGS_PAGES ?? "6");
  const limit = Math.min(Math.max(Number(process.env.SEED_TAGS_LIMIT ?? "50"), 1), 50);
  const topN = Math.min(Math.max(Number(process.env.SEED_TAGS_TOP ?? "80"), 1), 400);

  const counts = Object.create(null);

  let cursor = "";
  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchResourcePage({ cursor: cursor || undefined, limit });
    const resources = Array.isArray(data?.resources) ? data.resources : [];

    for (const r of resources) {
      const name = r?.name ?? r?.data?.name ?? null;
      const tags = extractTagsFromName(name);
      for (const t of tags) {
        counts[t] = (counts[t] ?? 0) + 1;
      }
    }

    const next = typeof data?.nextCursor === "string" ? data.nextCursor.trim() : "";
    const hasMore = Boolean(data?.hasMore);

    if (!hasMore || !next) break;
    cursor = next;
  }

  const entries = Object.entries(counts);
  entries.sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));

  const trimmed = Object.fromEntries(entries.slice(0, topN));

  const header = `/*
  AUTO-GENERATED FILE.
  Run: node scripts/generate-seed-filename-tags.mjs

  Env:
    FABRIC_API_KEY (recommended) or FABRIC_ACCESS_TOKEN
    Optional: SEED_TAGS_PAGES, SEED_TAGS_LIMIT, SEED_TAGS_TOP
*/

`;

  fs.writeFileSync(output, header + toTsRecordSource(trimmed), "utf8");
  console.log(`Wrote ${Object.keys(trimmed).length} seed tag(s) to: ${output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
