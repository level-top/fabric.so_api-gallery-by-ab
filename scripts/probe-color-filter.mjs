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

async function attempt(label, extra) {
  const body = {
    kind: ["image"],
    includeSubfolderCount: false,
    limit: 5,
    order: { property: "createdAt", direction: "DESC" },
    ...extra,
  };

  const res = await fetch(`${baseUrl}/v2/resources/filter`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  const preview =
    typeof payload === "string"
      ? payload.slice(0, 350)
      : JSON.stringify(payload).slice(0, 350);

  console.log(`\n== ${label} status ${res.status}`);
  console.log(preview);
  return res.ok;
}

const candidates = [
  ["colors:[120]", { colors: [120] }],
  ["dominantColors:[120]", { dominantColors: [120] }],
  ["dominant_colors:[120]", { dominant_colors: [120] }],
  ["hues:[120]", { hues: [120] }],
  ["color:120", { color: 120 }],
  ["palette:[120]", { palette: [120] }],
  ["colors:[#25D366]", { colors: ["#25D366"] }],
  ["dominantColors:[#25D366]", { dominantColors: ["#25D366"] }],
];

let success = false;
for (const [label, extra] of candidates) {
  try {
    const ok = await attempt(label, extra);
    if (ok) {
      console.log(`SUCCESS FIELD: ${label}`);
      success = true;
      break;
    }
  } catch (e) {
    console.log(`\n== ${label} ERROR ${(e && e.message) || String(e)}`);
  }
}

if (!success) {
  console.log("\nNo tested color filter fields succeeded.");
}
