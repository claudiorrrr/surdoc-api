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
//   records/<id>.json  full detail (only when DETAIL=1)

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Surdoc } from "../src/scraper.ts";
import { Fetcher } from "../src/client.ts";
import { NotPublicError, type SearchResult } from "../src/types.ts";

const DATA = new URL("../data/", import.meta.url).pathname;
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 25); // 0 = all
const DETAIL = process.env.DETAIL === "1";

const sd = new Surdoc(new Fetcher({ minIntervalMs: 700, cacheTtlMs: 0 }));

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

  for (let page = 1; page < lastPage; page++) {
    const res = await sd.search({ page });
    for (const r of res.results) byId.set(r.recordNumber, r);
    if (page % 25 === 0) {
      await writeJson("index.json", [...byId.values()]);
      console.log(`  page ${page}/${lastPage} — ${byId.size} records`);
    }
  }

  const index = [...byId.values()];
  await writeJson("index.json", index);

  let detailFetched = 0;
  let notPublic = 0;
  if (DETAIL) {
    console.log(`→ detail for ${index.length} records (skipping existing)`);
    for (const row of index) {
      const out = `records/${row.recordNumber}.json`;
      if (existsSync(DATA + out)) continue;
      try {
        await writeJson(out, await sd.record(row.recordNumber));
        detailFetched++;
      } catch (e) {
        if (e instanceof NotPublicError) notPublic++;
        else console.warn(`  ${row.recordNumber}: ${e}`);
      }
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
