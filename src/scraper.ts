// Parsers for surdoc.cl HTML. Selectors verified against the live Drupal 10
// site (May 2026). The legacy patrimoniobot used `td.record--title-and-type`
// from the old table layout — that markup is gone; we use the current
// `.field--name-*` div blocks instead.

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { BASE_URL, Fetcher } from "./client.ts";
import {
  NotPublicError,
  type Facets,
  type FacetValue,
  type ObjectCategory,
  type SearchResponse,
  type SearchResult,
  type SurdocRecord,
  type TechniqueMaterial,
} from "./types.ts";

const RECORD_IMAGE_STYLE = /\/sites\/default\/files\/styles\/[^/]+\/public\//;

/** Detect the login wall a non-public record redirects to. */
function isLoginWall($: CheerioAPI): boolean {
  const title = $("title").first().text();
  return /Iniciar sesión/i.test(title);
}

/** Strip Drupal image-style derivative + cache token → original full-res URL. */
function toOriginalImage(src: string): string {
  let url = src.replace(RECORD_IMAGE_STYLE, "/sites/default/files/");
  url = url.replace(/\?itok=[^&]*/, "");
  if (url.startsWith("/")) url = BASE_URL + url;
  return url;
}

function classifyCategory(text: string | undefined): ObjectCategory {
  if (!text) return "unknown";
  const t = text.toLowerCase();
  if (t.includes("antropolog") || t.includes("arqueolog") || t.includes("etnograf"))
    return "archaeology";
  if (t.includes("arte")) return "art";
  if (t.includes("historia")) return "history";
  return "unknown";
}

/** Read a top-level inline field block by its field--name-* suffix. */
function field($: CheerioAPI, name: string): string | undefined {
  const el = $(`.field--name-${name}`).first();
  if (!el.length) return undefined;
  // Prefer the value node; fall back to the block minus its label.
  const items = el
    .find(".field-item, .field-items.field-item")
    .map((_, n) => $(n).text().trim())
    .get()
    .filter(Boolean);
  if (items.length) return items.join(" / ");
  const label = el.find(".field-label").first().text().trim();
  return el.text().replace(label, "").trim() || undefined;
}

/** Parse a single /registro/{id} page into a structured record. */
export function parseRecord(html: string, recordNumber: string): SurdocRecord {
  const $ = cheerio.load(html);
  if (isLoginWall($)) throw new NotPublicError(recordNumber);

  const classification = field($, "second-level-classification");
  const category = classifyCategory(
    $("article.record").attr("class") + " " + (classification ?? ""),
  );

  // The nested "object" field group holds title / alt name / dimensions /
  // technique-material / location / transcription as form-item rows.
  const objGroup = $(".field--name-object").first();
  const objRows = new Map<string, ReturnType<CheerioAPI>>();
  objGroup.find(".js-form-item.form-item").each((_, el) => {
    const $el = $(el);
    const label = $el.find(".form-item__label").first().text().trim().toLowerCase();
    if (label) objRows.set(label, $el as unknown as ReturnType<CheerioAPI>);
  });
  const objRow = (label: string) => objRows.get(label);
  const objText = (label: string) =>
    objRow(label)?.find(".field-item").first().text().trim() || undefined;

  // Technique/material rows: each `.technical-item` is one pair, with AAT links.
  const techniqueMaterial: TechniqueMaterial[] = [];
  objRow("técnica / material")
    ?.find(".technical-item")
    .each((_, el) => {
      const $el = $(el);
      const links = $el.find("a");
      const aat = links
        .map((_, a) => $(a).attr("href") ?? "")
        .get()
        .filter((h) => h.includes("aatespanol"));
      const technique = links.eq(0).text().trim() || undefined;
      const material = links.eq(1).text().trim() || undefined;
      techniqueMaterial.push({ technique, material, aat });
    });

  const images = $("article.record .slick__slide a, .field--name-visuals a, a.photoswipe")
    .map((_, a) => $(a).attr("href") ?? "")
    .get()
    .filter((h) => h.includes("/record_images/"))
    .map(toOriginalImage);

  return {
    recordNumber: field($, "record-number") ?? recordNumber,
    inventoryNumbers: field($, "inventory-numbers"),
    title: objText("objeto") ?? ($("h1.h1").first().text().trim() || undefined),
    alternativeName: objText("nombre alternativo"),
    institution: field($, "institution-id"),
    classification,
    category,
    collection: field($, "collection"),
    dimensions: objText("dimensiones"),
    techniqueMaterial: techniqueMaterial.length ? techniqueMaterial : undefined,
    description: field($, "physical-description"),
    conservationState: field($, "conservation-state"),
    location: objText("ubicación"),
    transcription: objText("transcripción"),
    ownershipHistory: field($, "hist-geo-ownership-use-history"),
    objectHistory: field($, "hist-geo-history"),
    ingressMode: field($, "ingress-mode"),
    images: dedupe(images),
    url: `${BASE_URL}/registro/${recordNumber}`,
  };
}

/** Parse a /colecciones listing page into result rows + total/pagination. */
export function parseListing(html: string, page: number): SearchResponse {
  const $ = cheerio.load(html);

  const results: SearchResult[] = [];
  $(".views-row article.record").each((_, el) => {
    const $el = $(el);
    const link = $el.find("a.record-title, a[href^='/registro/']").first();
    const href = link.attr("href") ?? "";
    const recordNumber =
      $el.find(".field--name-record-number").first().text().trim() ||
      href.replace("/registro/", "");
    if (!recordNumber) return;
    const thumbRaw = $el.find("img").first().attr("src") ?? "";
    results.push({
      recordNumber,
      title: $el.find("a.record-title").first().text().trim() || undefined,
      institution: $el.find(".field--name-institution-id").first().text().trim() || undefined,
      category: classifyCategory($el.attr("class") ?? ""),
      thumbnail: thumbRaw ? toOriginalImage(thumbRaw) : undefined,
      url: href.startsWith("http") ? href : BASE_URL + href,
    });
  });

  const total = parseTotal($);
  // SURDOC serves 21 results per page (not 20). Prefer the pager's last page;
  // fall back to deriving it from the total.
  const pageSize = results.length || 21;
  const totalPages = parseLastPage($) ?? Math.max(1, Math.ceil(total / 21));

  return { total, page, pageSize, totalPages, results };
}

/** Site reports the count as "77917 registros". */
function parseTotal($: CheerioAPI): number {
  const m = $.root().text().match(/([\d.,]+)\s+registros/i);
  if (!m) return 0;
  return parseInt(m[1].replace(/[.,]/g, ""), 10) || 0;
}

/** Total pages from the pager's "last" link (?page=N is 0-based). */
function parseLastPage($: CheerioAPI): number | undefined {
  const href =
    $("li.pager__item--last a").attr("href") ??
    $("a[href*='page=']")
      .map((_, a) => $(a).attr("href") ?? "")
      .get()
      .sort((a, b) => pageNum(b) - pageNum(a))[0];
  if (!href) return undefined;
  const n = pageNum(href);
  return n >= 0 ? n + 1 : undefined;
}

function pageNum(href: string): number {
  const m = href.match(/[?&]page=(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

/** Parse every facet group on a listing page (institution, material, etc.). */
export function parseFacets(html: string): Facets {
  const $ = cheerio.load(html);
  const facets: Facets = {};

  $("a[data-drupal-facet-item-id]").each((_, a) => {
    const $a = $(a);
    const itemId = $a.attr("data-drupal-facet-item-id") ?? "";
    // itemId looks like "institution-4" → group "institution", value "4".
    const value = $a.attr("data-drupal-facet-item-value") ?? "";
    const group = itemId.replace(new RegExp(`-${escapeRe(value)}$`), "");
    if (!group) return;
    const count = parseInt($a.attr("data-drupal-facet-item-count") ?? "0", 10);
    const label =
      $a.find(".facet-item__value").first().text().trim() ||
      $a.clone().children().remove().end().text().trim();
    (facets[group] ??= []).push({ id: value, label, count });
  });

  return facets;
}

// --------------------------------------------------------------------------
// High-level client tying the fetcher + parsers together.
// --------------------------------------------------------------------------

export interface SearchParams {
  /** Full-text query. */
  q?: string;
  /** Facet filters keyed by facet group, e.g. { institution: "4" }. */
  filters?: Record<string, string | number>;
  /** 0-based page. */
  page?: number;
}

export class Surdoc {
  constructor(private fetcher: Fetcher = new Fetcher()) {}

  async record(recordNumber: string): Promise<SurdocRecord> {
    const html = await this.fetcher.get(`/registro/${encodeURIComponent(recordNumber)}`);
    return parseRecord(html, recordNumber);
  }

  async search(params: SearchParams = {}): Promise<SearchResponse> {
    return parseListing(await this.fetcher.get(this.listingUrl(params)), params.page ?? 0);
  }

  async facets(params: Omit<SearchParams, "page"> = {}): Promise<Facets> {
    return parseFacets(await this.fetcher.get(this.listingUrl(params)));
  }

  /** Convenience: every institution facet value = the museum list + counts. */
  async institutions(): Promise<FacetValue[]> {
    return (await this.facets()).institution ?? [];
  }

  private listingUrl({ q, filters, page }: SearchParams): string {
    const qs = new URLSearchParams();
    if (q) qs.set("query", q);
    let i = 0;
    for (const [group, value] of Object.entries(filters ?? {})) {
      qs.set(`f[${i++}]`, `${group}:${value}`);
    }
    if (page) qs.set("page", String(page));
    const s = qs.toString();
    return `/colecciones${s ? `?${s}` : ""}`;
  }
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
