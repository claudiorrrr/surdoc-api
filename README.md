# surdoc-api

API REST no oficial + dataset estático para **[SURDOC](https://www.surdoc.cl)** —
la base de datos nacional de colecciones museales de Chile (*Sistema Unificado de Registros de
Documentación*, operado por el Servicio Nacional del Patrimonio Cultural).

SURDOC cataloga **~78.000 objetos**, **~198.000 imágenes**, **298 colecciones** en
**44 museos** — pero no expone ninguna API, JSON ni exportación masiva. Este proyecto
envuelve el sitio público para que los datos sean usables por *programas*, no solo por un mouse.

> Sin afiliación con SURDOC ni el Servicio Nacional del Patrimonio Cultural.
> Solo lee páginas públicas, respeta `robots.txt` y se auto-limita. Datos ©
> los museos respectivos.

## Dos formas de usarlo

| | Qué | Dónde |
|---|---|---|
| **Dataset estático** | Crawl nocturno → JSON versionado (`data/`) en GitHub Pages. El verdadero valor: datos masivos que SURDOC no ofrece. Descarga una vez, consulta offline. | https://claudiorrrr.github.io/surdoc-api/ |
| **API en vivo** | Servidor Hono que hace scraping bajo demanda (throttled + caché). Tiempo real, todo el poder de consulta. | Bun local · Cloudflare Workers · Deno Deploy |

## API en vivo

```sh
bun install
bun run dev          # http://localhost:3000
```

| Endpoint | Descripción |
|---|---|
| `GET /record/:id` | Un objeto como JSON, ej. `/record/61-270`. `403` si requiere login, `404` si no existe. |
| `GET /search?q=&page=` | Búsqueda de texto completo + paginación. |
| `GET /search?institution=4&material=…` | Filtros por faceta (cualquier grupo de facetas como parámetro). |
| `GET /facets?q=` | Todos los grupos de facetas (institución, material, técnica, cultura, …) con conteos. |
| `GET /institutions` | Lista de museos + conteos de objetos. |
| `GET /random?institution=4` | Un objeto aleatorio público. |
| `GET /aat` | Tabla de enriquecimiento Getty AAT → Wikidata. |

Ejemplo:

```sh
curl localhost:3000/record/61-270
curl "localhost:3000/search?q=diaguita"
curl "localhost:3000/search?institution=4&page=2"
```

Cada registro incluye links al tesauro **Getty AAT** (`aatespanol.cl`) por técnica/material,
enriquecidos con etiquetas en español/inglés e IDs de Wikidata para joins de datos enlazados.

## Dataset estático

El dataset completo está publicado en **https://claudiorrrr.github.io/surdoc-api/** y se actualiza diariamente con GitHub Actions.

```sh
# Descargar archivos directamente:
curl https://claudiorrrr.github.io/surdoc-api/meta.json
curl https://claudiorrrr.github.io/surdoc-api/index.json
curl https://claudiorrrr.github.io/surdoc-api/records/4.ndjson   # Museo Histórico Nacional
curl https://claudiorrrr.github.io/surdoc-api/aat.json            # lookup AAT → Wikidata
```

Para reconstruir localmente:

```sh
bun run build:dataset                # facetas + primeras MAX_PAGES del índice
MAX_PAGES=0 bun run build:dataset     # índice completo (~3700 páginas, lento)
DETAIL=1   bun run build:dataset      # también obtiene el detalle completo de cada registro
```

Archivos en `data/`:

| Archivo | Contenido |
|---|---|
| `meta.json` | total de registros, `generatedAt`, % de cobertura |
| `facets.json` | todos los grupos de facetas + conteos |
| `institutions.json` | lista de museos + conteos |
| `index.json` | `{recordNumber, title, institution, category, thumbnail, url}[]` |
| `records/<institutionId>.ndjson` | detalle completo, un registro por línea, sharded por museo |
| `aat.json` | `{[aatId]: {label_es, label_en, wikidataId, wikidataUrl}}` |

El GitHub Action (`.github/workflows/dataset.yml`) corre diariamente, crawlea un slice,
**acumula** el índice comprometido entre ejecuciones, y publica `data/` en GitHub Pages.
Trigger manual: *Actions → Build SURDOC dataset → Run workflow*.

## Qué puedes construir

1. Buscar 78k objetos museales por palabra clave, como JSON.
2. Obtener el metadata completo + URLs de imágenes de cualquier objeto.
3. Filtrar por museo / clasificación / creador / material / técnica / cultura.
4. Listar todos los museos y colecciones con conteos.
5. Descargar el catálogo completo como dataset versionado.
6. Obtener sets de imágenes para galerías, ML, o un widget de "artefacto aleatorio".
7. Enriquecimiento de datos enlazados vía Getty AAT → grafos de conocimiento de Wikidata.
8. Dashboards de datos abiertos: conteos por material, era, museo.
9. Bots de "objeto del día" (Mastodon / Bluesky / RSS).
10. Un widget de búsqueda embebible o un servidor MCP para citación en LLMs.

## Cómo funciona

- `src/client.ts` — fetcher throttled, con caché y reintentos (educado: ~1 req/s, UA personalizado).
- `src/scraper.ts` — parsers Cheerio para páginas de registro / listado / facetas.
  Selectores verificados contra el sitio **Drupal 10** en vivo (mayo 2026).
- `src/server.ts` — app REST Hono (agnóstica al runtime), con enriquecimiento AAT en `/record/:id`.
- `scripts/build-dataset.ts` — constructor incremental de exportación estática.
- `scripts/enrich-aat.ts` — consulta Wikidata SPARQL para todos los IDs AAT del dataset.
- `museums-id.seed.json` — seed museo → id SURDOC (fallback para la enumeración de facetas).

### Notas / limitaciones

- Algunos registros pueden estar detrás de un muro de login (`Iniciar sesión`) → reportados como `not_public`. En la práctica el crawl completo encontró todos los registros accesibles públicamente (mayo 2026).
- SURDOC sirve **21** resultados por página.
- El scraping es frágil por naturaleza: si el markup del sitio cambia, actualizar los
  selectores en `src/scraper.ts` (centralizados ahí a propósito).

## Licencia

MIT. Solo el código — los datos del catálogo pertenecen a SURDOC y los museos participantes.
