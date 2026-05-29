// Live REST API over SURDOC. Runs on Bun locally and deploys unchanged to
// Cloudflare Workers / Deno Deploy (Hono is runtime-agnostic; fetch is global).
//
//   bun run dev      # http://localhost:3000
//
// Endpoints:
//   GET /                      API index
//   GET /record/:id            one object as JSON           (404 / 403 not-public)
//   GET /search?q=&page=&...   full-text + facet search
//   GET /facets?q=&...         all facet groups for a query
//   GET /institutions          museum list + object counts
//   GET /random?institution=   a random public object (no brute force)

import { Hono } from "hono";
import { Surdoc } from "./scraper.ts";
import { Fetcher } from "./client.ts";
import { NotPublicError, type SurdocRecord } from "./types.ts";
import aatData from "../data/aat.json";

// ── AAT enrichment ────────────────────────────────────────────────────────────

interface AatEntry {
  id: string;
  url: string;
  wikidataId?: string;
  wikidataUrl?: string;
  label_es?: string;
  label_en?: string;
}

const aatLookup = aatData as Record<string, Omit<AatEntry, "id" | "url">>;

function enrichRecord(rec: SurdocRecord): unknown {
  if (!rec.techniqueMaterial?.length) return rec;
  return {
    ...rec,
    techniqueMaterial: rec.techniqueMaterial.map((tm) => ({
      ...tm,
      aat: tm.aat.map((url): AatEntry => {
        const id = url.match(/(\d+)$/)?.[1] ?? "";
        return { id, url, ...aatLookup[id] };
      }),
    })),
  };
}

const sd = new Surdoc(new Fetcher({ minIntervalMs: 600 }));
const app = new Hono();

app.get("/", (c) =>
  c.json({
    name: "surdoc-api",
    description: "Unofficial REST API for Chile's SURDOC museum collections.",
    source: "https://www.surdoc.cl",
    endpoints: {
      "/record/:id": "One object, e.g. /record/61-270",
      "/search?q=&institution=&material=&page=": "Search + facet filters",
      "/facets?q=": "Facet groups (institution, material, technique, ...)",
      "/institutions": "Museum list with object counts",
      "/random?institution=": "A random public object",
      "/aat": "Getty AAT → Wikidata enrichment lookup table",
    },
  }),
);

app.get("/aat", (c) => c.json(aatLookup));

app.get("/record/:id", async (c) => {
  try {
    return c.json(enrichRecord(await sd.record(c.req.param("id"))));
  } catch (e) {
    if (e instanceof NotPublicError) return c.json({ error: "not_public" }, 403);
    if ((e as { status?: number }).status === 404)
      return c.json({ error: "not_found" }, 404);
    return c.json({ error: String(e) }, 502);
  }
});

// Reserved query keys are not facets; everything else is treated as a facet.
const RESERVED = new Set(["q", "page"]);

function parseQuery(c: { req: { query(): Record<string, string> } }) {
  const all = c.req.query();
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (!RESERVED.has(k) && v) filters[k] = v;
  }
  return { q: all.q, page: all.page ? Number(all.page) : 0, filters };
}

app.get("/search", async (c) => {
  try {
    return c.json(await sd.search(parseQuery(c)));
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

app.get("/facets", async (c) => {
  try {
    const { q, filters } = parseQuery(c);
    return c.json(await sd.facets({ q, filters }));
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

app.get("/institutions", async (c) => {
  try {
    return c.json(await sd.institutions());
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

app.get("/random", async (c) => {
  try {
    const institution = c.req.query("institution");
    const filters = institution ? { institution } : undefined;
    // Use the reported total to pick a random page, then a random row.
    // Deterministic per request without Math.random by mixing the clock.
    const first = await sd.search({ filters, page: 0 });
    if (!first.totalPages) return c.json({ error: "no_results" }, 404);
    const seed = Math.floor(performance.now()) % first.totalPages;
    const pageRes = seed === 0 ? first : await sd.search({ filters, page: seed });
    const rows = pageRes.results.length ? pageRes.results : first.results;
    const pick = rows[Math.floor(performance.now()) % rows.length];
    return c.json(enrichRecord(await sd.record(pick.recordNumber)));
  } catch (e) {
    if (e instanceof NotPublicError) return c.json({ error: "not_public, retry" }, 409);
    return c.json({ error: String(e) }, 502);
  }
});

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
