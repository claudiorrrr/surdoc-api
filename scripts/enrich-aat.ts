// Queries Wikidata for every Getty AAT ID found in the detail shards.
// Writes data/aat.json: { [aatId]: { label_es, label_en, wikidataId, wikidataUrl } }
// Resumable: re-run skips already-cached IDs.
//
//   bun run scripts/enrich-aat.ts

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const DATA = new URL("../data/", import.meta.url).pathname;
const BATCH = 50;
const SLEEP_MS = 1200;

// ── 1. Extract unique AAT IDs from shards ────────────────────────────────────

const aatIds = new Set<string>();
for (const f of readdirSync(DATA + "records")) {
  const lines = readFileSync(DATA + "records/" + f, "utf8").trim().split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as { techniqueMaterial?: { aat?: string[] }[] };
      for (const tm of rec.techniqueMaterial ?? []) {
        for (const url of tm.aat ?? []) {
          const m = url.match(/(\d+)$/);
          if (m) aatIds.add(m[1]);
        }
      }
    } catch {}
  }
}
console.log(`→ ${aatIds.size} unique AAT IDs found in shards`);

// ── 2. Load cache ─────────────────────────────────────────────────────────────

export interface AatEntry {
  label_es?: string;
  label_en?: string;
  wikidataId?: string;
  wikidataUrl?: string;
}

const outPath = DATA + "aat.json";
const cache: Record<string, AatEntry> = existsSync(outPath)
  ? JSON.parse(readFileSync(outPath, "utf8"))
  : {};

const toFetch = [...aatIds].filter((id) => !(id in cache));
console.log(`→ ${toFetch.length} to fetch from Wikidata (${aatIds.size - toFetch.length} cached)`);

// ── 3. Batch SPARQL queries ───────────────────────────────────────────────────

function buildQuery(ids: string[]): string {
  const values = ids.map((id) => `"${id}"`).join(" ");
  return `
SELECT ?aat ?item ?label_es ?label_en WHERE {
  VALUES ?aat { ${values} }
  ?item wdt:P1014 ?aat .
  OPTIONAL { ?item rdfs:label ?label_es . FILTER(LANG(?label_es) = "es") }
  OPTIONAL { ?item rdfs:label ?label_en . FILTER(LANG(?label_en) = "en") }
}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const total = Math.ceil(toFetch.length / BATCH);

for (let i = 0; i < toFetch.length; i += BATCH) {
  const batch = toFetch.slice(i, i + BATCH);
  const batchNum = Math.floor(i / BATCH) + 1;
  console.log(`  batch ${batchNum}/${total} — ${batch.length} IDs`);

  const url =
    "https://query.wikidata.org/sparql?format=json&query=" +
    encodeURIComponent(buildQuery(batch));

  let ok = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "surdoc-api/0.1 (+https://github.com/claudiorrrr/surdoc-api; AAT enrichment)",
          Accept: "application/sparql-results+json",
        },
      });
      if (!res.ok) {
        console.warn(`    HTTP ${res.status} — retry ${attempt + 1}`);
        await sleep(SLEEP_MS * (attempt + 2));
        continue;
      }
      const data = (await res.json()) as {
        results: {
          bindings: Array<{
            aat: { value: string };
            item: { value: string };
            label_es?: { value: string };
            label_en?: { value: string };
          }>;
        };
      };

      // Merge rows (multiple rows per item if both labels exist)
      const rows: Record<string, AatEntry> = {};
      for (const row of data.results.bindings) {
        const id = row.aat.value;
        if (!rows[id]) {
          const wikidataId = row.item.value.replace("http://www.wikidata.org/entity/", "");
          rows[id] = {
            wikidataId,
            wikidataUrl: `https://www.wikidata.org/wiki/${wikidataId}`,
          };
        }
        if (row.label_es) rows[id].label_es = row.label_es.value;
        if (row.label_en) rows[id].label_en = row.label_en.value;
      }

      for (const id of batch) {
        cache[id] = rows[id] ?? {}; // empty = no Wikidata match
      }

      ok = true;
      break;
    } catch (e) {
      console.warn(`    error: ${e} — retry ${attempt + 1}`);
      await sleep(SLEEP_MS * (attempt + 2));
    }
  }

  if (!ok) console.warn(`  batch ${batchNum} failed after 3 attempts, skipping`);

  writeFileSync(outPath, JSON.stringify(cache, null, 2));
  if (i + BATCH < toFetch.length) await sleep(SLEEP_MS);
}

const matched = Object.values(cache).filter((v) => v.wikidataId).length;
const total_cached = Object.keys(cache).length;
console.log(`✓ ${total_cached} AAT IDs total, ${matched} matched to Wikidata (${((matched/total_cached)*100).toFixed(1)}%)`);
