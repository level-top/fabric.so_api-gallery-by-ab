export type FabricThumbnail = {
  sm?: string | null;
  md?: string | null;
  lg?: string | null;
  xl?: string | null;
  original?: string | null;
};

export type FabricTag = {
  id: string;
  name?: string | null;
};

export type FabricResource = {
  id: string;
  kind?: string | null;
  name?: string | null;
  mimeType?: string | null;
  extension?: string | null;
  url?: string | null;
  thumbnail?: FabricThumbnail | null;
  cover?: {
    url?: string | null;
    width?: number | null;
    height?: number | null;
    mime?: string | null;
  } | null;
  tags?: FabricTag[];
  createdAt?: string | null;
  modifiedAt?: string | null;
};

export class FabricApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FabricApiError";
    this.status = status;
  }
}

function getFabricConfig() {
  const baseUrl = process.env.FABRIC_API_BASE_URL ?? "https://api.fabric.so";
  // Fabric currently supports Personal API Keys via X-Api-Key.
  // Keep a fallback to the older FABRIC_ACCESS_TOKEN variable to avoid breaking local setups.
  const apiKey = (process.env.FABRIC_API_KEY ?? "").trim();
  const accessToken = (process.env.FABRIC_ACCESS_TOKEN ?? "").trim();

  if (!apiKey && !accessToken) {
    throw new Error(
      "Missing Fabric credentials. Create fabric-gallery/.env.local and set FABRIC_API_KEY (recommended).",
    );
  }

  return { baseUrl, apiKey, accessToken };
}

export async function fabricFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const { baseUrl, apiKey, accessToken } = getFabricConfig();

  const authHeaders: Record<string, string> = apiKey
    ? { "X-Api-Key": apiKey }
    : { Authorization: `Bearer ${accessToken}` };

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...authHeaders,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");

    // Try to normalize JSON error bodies into a compact string.
    let detail = text;
    try {
      const parsed = text ? (JSON.parse(text) as unknown) : null;
      if (parsed && typeof parsed === "object") {
        detail = JSON.stringify(parsed);
      }
    } catch {
      // ignore
    }

    throw new FabricApiError(
      `Fabric API error ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}
