// Builds the static JSON dataset published to GitHub Pages — the open-data
// export surdoc.cl doesn't provide. Designed to run incrementally inside a
// GitHub Action (6h cap) and be resumed across runs.
//
//   bun run build:dataset                 # facets + first MAX_PAGES of the index
//   MAX_PAGES=0 bun run build:dataset     # full index (~3700 pages, slow)
//   ROLL=1 bun run build:dataset          # crawl an advancing MAX_PAGES window
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
// Rolling mode: crawl a MAX_PAGES window that advances each run, wrapping at the
// end of the catalog (~19 runs for a full sweep). SURDOC has no working sort and
// new records scatter through every institution's block (not the tail), so a
// fixed window never sees most additions — a moving window eventually does.
// The cursor persists in data/crawl-state.json. Ignored when MAX_PAGES=0.
const ROLL = process.env.ROLL === "1";
const STATE_FILE = "crawl-state.json";

async function loadNextPage(): Promise<number> {
  if (!existsSync(DATA + STATE_FILE)) return 1;
  try {
    const s = JSON.parse(await readFile(DATA + STATE_FILE, "utf8"));
    return Number.isInteger(s.nextPage) && s.nextPage > 0 ? s.nextPage : 1;
  } catch {
    return 1;
  }
}
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
  // Bootstrap (facets + page 0) gates the whole crawl. If surdoc.cl is
  // transiently down here, don't fail the job red — leave the committed
  // dataset in place and exit 0 so the next scheduled run resumes. The
  // crawl is incremental, so a skipped day costs nothing.
  let facets: Awaited<ReturnType<typeof sd.facets>>;
  let first: Awaited<ReturnType<typeof sd.search>>;
  try {
    facets = await sd.facets();
    first = await sd.search({ page: 0 });
  } catch (e) {
    console.warn(`→ bootstrap failed (${e}); keeping committed dataset, exiting 0`);
    return;
  }
  await writeJson("facets.json", facets);
  await writeJson("institutions.json", facets.institution ?? []);

  const total = first.total;
  const totalPages = first.totalPages;
  // Page params are 0-based; page 0 is `first` above. Crawl [startPage, endPage).
  let startPage = 1;
  let endPage = MAX_PAGES > 0 ? Math.min(MAX_PAGES, totalPages) : totalPages;
  let nextPage = 1; // cursor to persist for the next rolling run
  if (MAX_PAGES > 0 && ROLL) {
    startPage = Math.min(Math.max(1, await loadNextPage()), totalPages - 1);
    endPage = Math.min(startPage + MAX_PAGES, totalPages);
    nextPage = endPage >= totalPages ? 1 : endPage; // wrap to the start
  }
  console.log(
    `→ total=${total} pages=${totalPages} crawling=[${startPage},${endPage})${ROLL ? ` roll next=${nextPage}` : ""}`,
  );

  // Merge into any existing index so runs accumulate coverage.
  const byId = new Map<string, SearchResult>();
  for (const r of await loadIndex()) byId.set(r.recordNumber, r);
  for (const r of first.results) byId.set(r.recordNumber, r);

  let skippedPages = 0;
  for (let page = startPage; page < endPage && !SKIP_INDEX; page++) {
    try {
      const res = await sd.search({ page });
      for (const r of res.results) byId.set(r.recordNumber, r);
    } catch (e) {
      skippedPages++;
      console.warn(`  page ${page}: ${e}`);
    }
    if (page % 25 === 0) {
      await writeJson("index.json", [...byId.values()]);
      console.log(`  page ${page}/${endPage} — ${byId.size} records${skippedPages ? ` (${skippedPages} skipped)` : ""}`);
    }
  }
  if (SKIP_INDEX) console.log(`→ SKIP_INDEX: reusing ${byId.size} indexed records`);

  const index = [...byId.values()];
  await writeJson("index.json", index);

  // Advance the rolling cursor only after a successful index crawl.
  if (ROLL && !SKIP_INDEX) await writeJson(STATE_FILE, { nextPage, updatedAt: new Date().toISOString() });

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
