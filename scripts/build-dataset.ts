// Builds the static JSON dataset published to GitHub Pages — the open-data
// export surdoc.cl doesn't provide. Designed to run incrementally inside a
// GitHub Action (6h cap) and be resumed across runs.
//
//   bun run build:dataset                 # facets + first MAX_PAGES of the index
//   MAX_PAGES=0 bun run build:dataset     # full index (~3700 pages, slow)
//   DETAIL=1 bun run build:dataset        # also fetch full record detail
//
// Outputs under ./data:
//   meta.json          total count, generatedAt, coverage
//   facets.json        all facet groups
//   institutions.json  museum list + counts
//   index.json         [{recordNumber,title,institution,category,thumbnail,url}]
//   records/<institutionId>.ndjson  full detail, one record per line
//                                   (only when DETAIL=1; sharded per museum so
//                                    the repo holds ~45 files, not ~54k)

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Surdoc } from "../src/scraper.ts";
import { Fetcher } from "../src/client.ts";
import { NotPublicError, type SearchResult, type SurdocRecord } from "../src/types.ts";

const DATA = new URL("../data/", import.meta.url).pathname;
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 25); // 0 = all
const DETAIL = process.env.DETAIL === "1";
const SKIP_INDEX = process.env.SKIP_INDEX === "1"; // reuse committed index.json
const MIN_INTERVAL_MS = Number(process.env.MIN_INTERVAL_MS ?? 700); // throttle

const sd = new Surdoc(new Fetcher({ minIntervalMs: MIN_INTERVAL_MS, cacheTtlMs: 0 }));

async function writeJson(name: string, data: unknown) {
  await writeFile(DATA + name, JSON.stringify(data, null, name.endsWith("index.json") ? 0 : 2));
}

async function loadIndex(): Promise<SearchResult[]> {
  const p = DATA + "index.json";
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return [];
  }
}

/** Load an existing NDJSON shard into a recordNumber → record map. */
async function loadShard(file: string): Promise<Map<string, SurdocRecord>> {
  const m = new Map<string, SurdocRecord>();
  if (!existsSync(DATA + file)) return m;
  const text = await readFile(DATA + file, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as SurdocRecord;
      m.set(rec.recordNumber, rec);
    } catch {
      // skip malformed line
    }
  }
  return m;
}

async function writeShard(file: string, recs: Map<string, SurdocRecord>) {
  const lines = [...recs.values()].map((r) => JSON.stringify(r)).join("\n");
  await writeFile(DATA + file, lines + (lines ? "\n" : ""));
}

async function main() {
  await mkdir(DATA + "records", { recursive: true });

  console.log("→ facets + institutions");
  const facets = await sd.facets();
  await writeJson("facets.json", facets);
  await writeJson("institutions.json", facets.institution ?? []);

  const first = await sd.search({ page: 0 });
  const total = first.total;
  const lastPage = MAX_PAGES > 0 ? Math.min(MAX_PAGES, first.totalPages) : first.totalPages;
  console.log(`→ total=${total} pages=${first.totalPages} crawling=${lastPage}`);

  // Merge into any existing index so runs accumulate coverage.
  const byId = new Map<string, SearchResult>();
  for (const r of await loadIndex()) byId.set(r.recordNumber, r);
  for (const r of first.results) byId.set(r.recordNumber, r);

  for (let page = 1; page < lastPage && !SKIP_INDEX; page++) {
    const res = await sd.search({ page });
    for (const r of res.results) byId.set(r.recordNumber, r);
    if (page % 25 === 0) {
      await writeJson("index.json", [...byId.values()]);
      console.log(`  page ${page}/${lastPage} — ${byId.size} records`);
    }
  }
  if (SKIP_INDEX) console.log(`→ SKIP_INDEX: reusing ${byId.size} indexed records`);

  const index = [...byId.values()];
  await writeJson("index.json", index);

  let detailFetched = 0;
  let notPublic = 0;
  if (DETAIL) {
    // Shard detail per museum. institution name → id from the facet list.
    const instId = new Map<string, string>();
    for (const f of facets.institution ?? []) instId.set(f.label, f.id);
    const shards = new Map<string, SearchResult[]>();
    for (const row of index) {
      const id = instId.get(row.institution ?? "") ?? "unknown";
      (shards.get(id) ?? shards.set(id, []).get(id)!).push(row);
    }
    console.log(`→ detail for ${index.length} records across ${shards.size} shards`);
    for (const [shardId, rows] of shards) {
      const file = `records/${shardId}.ndjson`;
      const recs = await loadShard(file); // resume: keep already-fetched
      let fetchedThisShard = 0;
      for (const row of rows) {
        if (recs.has(row.recordNumber)) continue;
        try {
          recs.set(row.recordNumber, await sd.record(row.recordNumber));
          detailFetched++;
          fetchedThisShard++;
        } catch (e) {
          if (e instanceof NotPublicError) notPublic++;
          else console.warn(`  ${row.recordNumber}: ${e}`);
        }
        // Flush periodically so a crashed/timed-out run keeps progress.
        if (fetchedThisShard % 50 === 0 && fetchedThisShard) await writeShard(file, recs);
      }
      await writeShard(file, recs);
    }
  }

  await writeJson("meta.json", {
    source: "https://www.surdoc.cl",
    generatedAt: new Date().toISOString(),
    total,
    indexed: index.length,
    coverage: total ? +(index.length / total * 100).toFixed(1) : 0,
    detailFetched,
    notPublic,
    institutions: (facets.institution ?? []).length,
  });

  console.log(
    `✓ index=${index.length}/${total} (${(index.length / total * 100).toFixed(1)}%)` +
      (DETAIL ? ` detail+${detailFetched} notPublic=${notPublic}` : ""),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
