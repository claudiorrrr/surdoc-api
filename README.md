# surdoc-api

Unofficial, open-source REST API + static dataset for **[SURDOC](https://www.surdoc.cl)** —
Chile's national museum-collections database (*Sistema Unificado de Registros de
Documentación*, run by the Servicio Nacional del Patrimonio Cultural).

SURDOC catalogs **~78,000 objects**, **~198,000 images**, **298 collections** across
**44 museums** — but exposes **no API, no JSON, no bulk export**. This project wraps
the public site so the data is usable by *programs*, not just a mouse.

> Not affiliated with SURDOC or the Servicio Nacional del Patrimonio Cultural.
> Reads only public pages, respects `robots.txt`, and self-throttles. Data ©
> the respective museums.

## Two ways to use it

| | What | Hosting |
|---|---|---|
| **Static dataset** | Nightly crawl → versioned JSON (`data/`) on GitHub Pages. The real unlock: bulk open data SURDOC doesn't offer. Download once, query offline. | https://claudiorrrr.github.io/surdoc-api/ |
| **Live API** | Hono server that scrapes on demand (throttled + cached). Real-time, full query power. | Bun locally · Cloudflare Workers · Deno Deploy |

## Live API

```sh
bun install
bun run dev          # http://localhost:3000
```

| Endpoint | Description |
|---|---|
| `GET /record/:id` | One object as JSON, e.g. `/record/61-270`. `403` if behind login wall, `404` if missing. |
| `GET /search?q=&page=` | Full-text search + pagination. |
| `GET /search?institution=4&material=…` | Facet filters (any facet group as a query key). |
| `GET /facets?q=` | All facet groups (institution, material, technique, culture, …) with counts. |
| `GET /institutions` | Museum list + object counts (from the institution facet). |
| `GET /random?institution=4` | A random public object. |

Example:

```sh
curl localhost:3000/record/61-270
curl "localhost:3000/search?q=diaguita"
curl "localhost:3000/search?institution=4&page=2"
```

Each record includes Getty **AAT thesaurus** links (`aatespanol.cl`) per
technique/material — ready for linked-data joins with Wikidata/Getty.

## Static dataset

The full dataset is published at **https://claudiorrrr.github.io/surdoc-api/** and updated daily by GitHub Actions.

```sh
# Download individual files directly:
curl https://claudiorrrr.github.io/surdoc-api/meta.json
curl https://claudiorrrr.github.io/surdoc-api/index.json
curl https://claudiorrrr.github.io/surdoc-api/records/4.ndjson   # Museo Histórico Nacional
```

To rebuild locally:

```sh
bun run build:dataset                # facets + first MAX_PAGES of the index
MAX_PAGES=0 bun run build:dataset     # full index (~3700 pages, slow)
DETAIL=1   bun run build:dataset      # also fetch full record detail
```

Outputs under `data/`:

| File | Contents |
|---|---|
| `meta.json` | total count, `generatedAt`, coverage % |
| `facets.json` | every facet group + counts |
| `institutions.json` | museum list + counts |
| `index.json` | `{recordNumber, title, institution, category, thumbnail, url}[]` |
| `records/<institutionId>.ndjson` | full detail, one record per line, sharded per museum (only with `DETAIL=1`) |

The GitHub Action (`.github/workflows/dataset.yml`) runs daily, crawls a slice,
**accumulates** the committed index across runs (so it converges to full
coverage in a few days without hitting the 6h job cap), and publishes `data/`
to GitHub Pages. Trigger manually via *Actions → Build SURDOC dataset → Run*.

## What you can build with it

1. Search 78k museum objects by keyword, as JSON.
2. Fetch any object's full metadata + image URLs.
3. Filter by museum / classification / creator / material / technique / culture.
4. List all museums & collections with counts.
5. Download the whole catalog as one versioned dataset.
6. Pull image sets for galleries, ML, or a "random artifact" widget.
7. Linked-data enrichment via Getty AAT → Wikidata knowledge graphs.
8. Open-data dashboards: counts by material, era, museum.
9. "Object of the day" bots (Mastodon / Bluesky / RSS).
10. An embeddable search widget or an MCP server for LLM citation.

## How it works

- `src/client.ts` — throttled, cached, retrying fetcher (polite: ~1 req/s, custom UA).
- `src/scraper.ts` — Cheerio parsers for record / listing / facet pages.
  Selectors verified against the live **Drupal 10** site (May 2026).
- `src/server.ts` — Hono REST app (runtime-agnostic).
- `scripts/build-dataset.ts` — incremental static-export builder.
- `museums-id.seed.json` — museum → SURDOC id seed (fallback for the facet enumeration).

### Notes / limits

- Some records may be behind a login wall (`Iniciar sesión`) → reported as `not_public`. In practice the full crawl found all records publicly accessible (May 2026).
- SURDOC serves **21** results per page.
- Scraping is brittle by nature: if the site's markup changes, update the
  selectors in `src/scraper.ts` (centralized there on purpose).

## License

MIT. Code only — the catalog data belongs to SURDOC and the participating museums.
