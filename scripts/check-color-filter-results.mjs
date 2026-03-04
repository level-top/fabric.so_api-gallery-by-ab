import fs from "node:fs";

function readEnvLocal() {
  const txt = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

const env = readEnvLocal();
const apiKey = (env.FABRIC_API_KEY ?? "").trim();
const baseUrl = (env.FABRIC_API_BASE_URL ?? "https://api.fabric.so").trim();

if (!apiKey) {
  console.error("Missing FABRIC_API_KEY in .env.local");
  process.exit(1);
}

async function fetchFirstIds(hue) {
  const body = {
    kind: ["image"],
    includeSubfolderCount: false,
    limit: 10,
    order: { property: "createdAt", direction: "DESC" },
    colors: [hue],
  };

  const res = await fetch(`${baseUrl}/v2/resources/filter`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    console.log(`hue=${hue} status=${res.status}`);
    console.log(payload);
    return [];
  }

  const resources = Array.isArray(payload?.resources) ? payload.resources : [];
  return resources.slice(0, 5).map((r) => ({ id: r?.id, name: r?.name }));
}

const hues = [0, 60, 120, 180, 240, 300];
const results = {};
for (const h of hues) {
  const rows = await fetchFirstIds(h);
  results[h] = rows;
  console.log(`\nHue ${h}° (first ${rows.length}):`);
  for (const row of rows) {
    console.log(`- ${row.id} | ${(row.name ?? "").slice(0, 80)}`);
  }
}

// Compare whether the first IDs are identical across hues.
const sig = (rows) => rows.map((r) => r.id).join(",");
console.log("\nSignatures:");
for (const h of hues) {
  console.log(`${h}: ${sig(results[h])}`);
}
