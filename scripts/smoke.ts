// Live smoke test: hits surdoc.cl and prints parsed output. Proves the
// scrapers work against the real site. Run: bun run smoke
import { Surdoc } from "../src/scraper.ts";

const sd = new Surdoc();

console.log("== record 61-270 ==");
const rec = await sd.record("61-270");
console.log({
  title: rec.title,
  institution: rec.institution,
  classification: rec.classification,
  category: rec.category,
  dimensions: rec.dimensions,
  techniqueMaterial: rec.techniqueMaterial,
  images: rec.images,
  description: rec.description?.slice(0, 80) + "...",
});

console.log("\n== search q='diaguita' page 0 ==");
const res = await sd.search({ q: "diaguita" });
console.log({ total: res.total, totalPages: res.totalPages, count: res.results.length });
console.log(res.results.slice(0, 3));

console.log("\n== institutions (facet) ==");
const inst = await sd.institutions();
console.log(`count=${inst.length}`);
console.log(inst.slice(0, 5));
