import { NextResponse } from "next/server";

import { FabricApiError, fabricFetch } from "@/lib/fabric";

export const runtime = "nodejs";

type SearchRequest = {
  text?: string;
  tagId?: string;
  mode?: "hybrid" | "keyword" | "semantic-image" | "semantic-text" | "similar-image" | "similar-text";
  createdAfter?: string;
  createdBefore?: string;
  page?: number;
  pageSize?: number;
};

const FABRIC_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as SearchRequest | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  const tagId = (body.tagId ?? "").trim();
  const mode = body.mode ?? "hybrid";
  const createdAfter = (body.createdAfter ?? "").trim();
  const createdBefore = (body.createdBefore ?? "").trim();
  const page = Math.max(body.page ?? 1, 1);
  const pageSize = Math.min(Math.max(body.pageSize ?? 30, 1), 100);

  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  if (tagId && !FABRIC_UUID_REGEX.test(tagId)) {
    return NextResponse.json(
      {
        error:
          "tagId must be a Fabric tag ID (UUID). Tip: fetch it via GET /v2/tags and use data.tags[].id (not the tag name).",
      },
      { status: 400 },
    );
  }

  if (createdAfter && Number.isNaN(Date.parse(createdAfter))) {
    return NextResponse.json(
      { error: "createdAfter must be a valid date string (ISO or YYYY-MM-DD)." },
      { status: 400 },
    );
  }

  if (createdBefore && Number.isNaN(Date.parse(createdBefore))) {
    return NextResponse.json(
      { error: "createdBefore must be a valid date string (ISO or YYYY-MM-DD)." },
      { status: 400 },
    );
  }

  const allowedModes: Array<NonNullable<SearchRequest["mode"]>> = [
    "hybrid",
    "keyword",
    "semantic-image",
    "semantic-text",
    "similar-image",
    "similar-text",
  ];

  if (!allowedModes.includes(mode)) {
    return NextResponse.json(
      { error: `mode must be one of: ${allowedModes.join(", ")}` },
      { status: 400 },
    );
  }

  const fabricBody: Record<string, unknown> = {
    // Fabric requires `mode` for text search.
    mode,
    text,
    filters: {
      kinds: ["image", "video"],
      ...(tagId ? { tagIds: [tagId] } : {}),
      ...(createdAfter ? { createdAfter } : {}),
      ...(createdBefore ? { createdBefore } : {}),
    },
    pagination: {
      page,
      pageSize,
    },
  };

  try {
    const data = await fabricFetch<unknown>("/v2/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fabricBody),
    });

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof FabricApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
