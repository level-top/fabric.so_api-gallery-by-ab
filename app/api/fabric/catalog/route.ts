import { NextResponse } from "next/server";

import { FabricApiError, fabricFetch } from "@/lib/fabric";

export const runtime = "nodejs";
export const maxDuration = 30;

type CatalogRequest = {
  resourceId?: string;
  limit?: number;
};

function jsonNoStore(body: any, init?: Parameters<typeof NextResponse.json>[1]) {
  const res = NextResponse.json(body, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function pickFolderId(resource: any): string | null {
  // Prefer an explicit folder path/id list and pick the leaf/current folder.
  const arrayCandidates = [
    resource?.folderIds,
    resource?.folderIDs,
    resource?.folderPathIds,
    resource?.folderPathIDs,
    resource?.data?.folderIds,
    resource?.data?.folderIDs,
    resource?.data?.folderPathIds,
    resource?.data?.folderPathIDs,
  ];

  for (const c of arrayCandidates) {
    if (!Array.isArray(c)) continue;
    for (let i = c.length - 1; i >= 0; i--) {
      const v = c[i];
      if (typeof v !== "string") continue;
      const t = v.trim();
      if (t) return t;
    }
  }

  // Then try direct folder ids.
  const directCandidates = [
    resource?.folderId,
    resource?.folderID,
    resource?.folder?.id,
    resource?.data?.folderId,
    resource?.data?.folderID,
    resource?.data?.folder?.id,
  ];

  for (const c of directCandidates) {
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (t) return t;
  }

  // Fabric often models hierarchy via `parent` (folder/doc) rather than explicit `folderId`.
  // For gallery-like libraries, `parent.id` is typically the folder/subfolder that contains
  // the asset, and is what we want for a per-folder "catalog".
  const parentCandidates = [
    resource?.parent?.id,
    resource?.parentId,
    resource?.parentID,
    resource?.data?.parent?.id,
    resource?.data?.parentId,
    resource?.data?.parentID,
  ];
  for (const c of parentCandidates) {
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (t) return t;
  }

  // Avoid using `root.folder.id` by default — it is often the space root and will make
  // all catalog results look identical.
  return null;
}

function resourceMatchesFolder(resource: any, folderId: string): boolean {
  if (!resource || typeof resource !== "object") return false;
  const folderIdLower = folderId.toLowerCase();

  const direct = [
    resource?.folderId,
    resource?.folderID,
    resource?.folder?.id,
    resource?.data?.folderId,
    resource?.data?.folderID,
    resource?.data?.folder?.id,
    resource?.parent?.id,
    resource?.parentId,
    resource?.parentID,
    resource?.data?.parent?.id,
    resource?.data?.parentId,
    resource?.data?.parentID,
  ];
  for (const d of direct) {
    if (typeof d === "string" && d.trim().toLowerCase() === folderIdLower) return true;
  }

  const arrays = [
    resource?.folderIds,
    resource?.folderIDs,
    resource?.folderPathIds,
    resource?.folderPathIDs,
    resource?.data?.folderIds,
    resource?.data?.folderIDs,
    resource?.data?.folderPathIds,
    resource?.data?.folderPathIDs,
  ];
  for (const a of arrays) {
    if (!Array.isArray(a)) continue;
    for (const v of a) {
      if (typeof v === "string" && v.trim().toLowerCase() === folderIdLower) return true;
    }
  }

  return false;
}

function scoreMatches(resources: any[], folderId: string) {
  const sampleCount = Math.min(resources.length, 12);
  const sample = resources.slice(0, sampleCount);
  const matches = sample.filter((r) => resourceMatchesFolder(r, folderId)).length;

  // Helpful diagnostics (keep light + non-sensitive): a few parent ids/names.
  const parents = sample
    .map((r) => ({ id: r?.parent?.id ?? r?.parentId ?? null, name: r?.parent?.name ?? null }))
    .filter((p) => typeof p.id === "string" && p.id.trim())
    .slice(0, 6);

  return {
    sampleCount,
    sampleMatches: matches,
    sampleParents: parents,
  };
}

async function tryFilter(body: any): Promise<any> {
  return await fabricFetch<any>("/v2/resources/filter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as CatalogRequest | null;
  const resourceId = (body?.resourceId ?? "").trim();
  const limit = Math.min(Math.max(body?.limit ?? 5, 1), 10);

  if (!resourceId) return jsonNoStore({ error: "resourceId is required" }, { status: 400 });

  try {
    const resource = await fabricFetch<any>(`/v2/resources/${encodeURIComponent(resourceId)}`, {
      method: "GET",
    });

    const folderId = pickFolderId(resource);
    if (!folderId) {
      return jsonNoStore(
        {
          error:
            "This resource has no usable current folder id in the API response (cannot build catalog yet).",
          debug: {
            keys: Object.keys(resource ?? {}).slice(0, 60),
            parent: resource?.parent ?? null,
            root: resource?.root ?? null,
          },
        },
        { status: 422 },
      );
    }

    // Try a few likely Fabric filter shapes; stop on the first one that works.
    const attempts: Array<{ name: string; body: any }> = [
      {
        name: "parentIds",
        body: {
          kind: ["image"],
          parentIds: [folderId],
          includeSubfolderCount: false,
          limit: Math.max(limit + 2, 7),
          order: { property: "createdAt", direction: "DESC" },
        },
      },
      {
        name: "parentId",
        body: {
          kind: ["image"],
          parentId: folderId,
          includeSubfolderCount: false,
          limit: Math.max(limit + 2, 7),
          order: { property: "createdAt", direction: "DESC" },
        },
      },
      {
        name: "parent.id",
        body: {
          kind: ["image"],
          parent: { id: folderId },
          includeSubfolderCount: false,
          limit: Math.max(limit + 2, 7),
          order: { property: "createdAt", direction: "DESC" },
        },
      },
      {
        name: "parent.ids",
        body: {
          kind: ["image"],
          parent: { ids: [folderId] },
          includeSubfolderCount: false,
          limit: Math.max(limit + 2, 7),
          order: { property: "createdAt", direction: "DESC" },
        },
      },
      {
        name: "folderIds",
        body: {
          kind: ["image"],
          folderIds: [folderId],
          includeSubfolderCount: false,
          limit: Math.max(limit + 2, 7),
          order: { property: "createdAt", direction: "DESC" },
        },
      },
      {
        name: "folderId",
        body: {
          kind: ["image"],
          folderId,
          includeSubfolderCount: false,
          limit: Math.max(limit + 2, 7),
          order: { property: "createdAt", direction: "DESC" },
        },
      },
      {
        name: "folderIds+includeDescendants",
        body: {
          kind: ["image"],
          folderIds: [folderId],
          includeDescendants: true,
          includeSubfolderCount: false,
          limit: Math.max(limit + 2, 7),
          order: { property: "createdAt", direction: "DESC" },
        },
      },
      {
        name: "folderIds+includeSubfolders",
        body: {
          kind: ["image"],
          folderIds: [folderId],
          includeSubfolders: true,
          includeSubfolderCount: false,
          limit: Math.max(limit + 2, 7),
          order: { property: "createdAt", direction: "DESC" },
        },
      },
    ];

    let data: any | null = null;
    let strategy: string | null = null;
    let lastError: unknown = null;
  const attemptDebug: Array<any> = [];

    for (const a of attempts) {
      try {
        const res = await tryFilter(a.body);
        const resources = Array.isArray(res?.resources) ? res.resources : [];
        if (!resources.length) {
          // No results for this strategy; try the next shape.
          attemptDebug.push({ name: a.name, ok: true, total: 0, sampleMatches: 0 });
          continue;
        }

        // Validate: ensure the response actually belongs to the requested folder.
        // Some APIs ignore unknown filter fields and return a default/global list.
        // We validate against a sample and require a strong match (ideally all).
        const scored = scoreMatches(resources, folderId);
        attemptDebug.push({ name: a.name, ok: true, total: resources.length, ...scored });

        const strongEnough =
          scored.sampleCount > 0 &&
          // Accept only if nearly everything in the sample matches.
          scored.sampleMatches >= Math.max(1, Math.floor(scored.sampleCount * 0.8));

        if (!strongEnough) {
          continue;
        }

        data = res;
        strategy = a.name;
        break;
      } catch (e) {
        lastError = e;
        attemptDebug.push({
          name: a.name,
          ok: false,
          message:
            e instanceof FabricApiError
              ? e.message
              : e instanceof Error
                ? e.message
                : "Unknown error",
        });
        continue;
      }
    }

    if (!data || !strategy) {
      const message =
        lastError instanceof FabricApiError
          ? lastError.message
          : lastError instanceof Error
            ? lastError.message
            : null;

      // If all attempts failed or didn't validate, return a 422 (not a server crash):
      // it means we couldn't reliably derive per-folder results.
      return jsonNoStore(
        {
          error: "Could not load catalog items from the current folder.",
          debug: { folderId, message, attempted: attemptDebug },
        },
        { status: 422 },
      );
    }

    const resources = (Array.isArray((data as any)?.resources) ? (data as any).resources : [])
      .filter((r: any) => r && typeof r === "object" && r.id && r.id !== resourceId)
      .slice(0, limit);

    return jsonNoStore({ resources, debug: { folderId, strategy } });
  } catch (e) {
    if (e instanceof FabricApiError) {
      return jsonNoStore({ error: e.message }, { status: e.status });
    }

    const message = e instanceof Error ? e.message : "Unknown error";
    return jsonNoStore({ error: message }, { status: 500 });
  }
}
