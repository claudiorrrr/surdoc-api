import { readFileSync } from "node:fs";
const aat = JSON.parse(readFileSync("data/aat.json", "utf8")) as Record<string, { wikidataId?: string; label_es?: string; label_en?: string; wikidataUrl?: string }>;
const entries = Object.entries(aat);
const matched = entries.filter(([, v]) => v.wikidataId);
const noMatch = entries.filter(([, v]) => !v.wikidataId);
console.log("sample matched:", JSON.stringify(matched.slice(0, 3), null, 2));
console.log(`\nno Wikidata match (${noMatch.length}):`, noMatch.map(([id]) => id));
