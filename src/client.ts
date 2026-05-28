// Polite HTTP client for surdoc.cl: throttle + in-memory cache + UA.
// robots.txt has no Crawl-delay, so we self-impose one to avoid hammering.

export const BASE_URL = "https://www.surdoc.cl";

const DEFAULT_UA =
  "surdoc-api/0.1 (+https://github.com/yourname/surdoc-api; unofficial open-data wrapper)";

export interface FetcherOptions {
  /** Minimum ms between requests. Default 800ms. */
  minIntervalMs?: number;
  /** Cache TTL in ms. Default 15 min. 0 disables caching. */
  cacheTtlMs?: number;
  userAgent?: string;
  /** Retries on network error / 5xx. Default 2. */
  retries?: number;
}

interface CacheEntry {
  html: string;
  expires: number;
}

export class Fetcher {
  private minInterval: number;
  private cacheTtl: number;
  private ua: string;
  private retries: number;
  private cache = new Map<string, CacheEntry>();
  private queue: Promise<void> = Promise.resolve();
  private lastRequest = 0;

  constructor(opts: FetcherOptions = {}) {
    this.minInterval = opts.minIntervalMs ?? 800;
    this.cacheTtl = opts.cacheTtlMs ?? 15 * 60 * 1000;
    this.ua = opts.userAgent ?? DEFAULT_UA;
    this.retries = opts.retries ?? 2;
  }

  /** Fetch a path or absolute URL as HTML, throttled and cached. */
  async get(pathOrUrl: string): Promise<string> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : BASE_URL + pathOrUrl;

    if (this.cacheTtl > 0) {
      const hit = this.cache.get(url);
      if (hit && hit.expires > this.monotonicNow()) return hit.html;
    }

    // Serialize all requests through a single queue so the throttle holds
    // even under concurrent callers.
    const result = this.queue.then(() => this.throttledFetch(url));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    const html = await result;

    if (this.cacheTtl > 0) {
      this.cache.set(url, { html, expires: this.monotonicNow() + this.cacheTtl });
    }
    return html;
  }

  private async throttledFetch(url: string): Promise<string> {
    const wait = this.lastRequest + this.minInterval - this.monotonicNow();
    if (wait > 0) await sleep(wait);
    this.lastRequest = this.monotonicNow();

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": this.ua,
            "Accept-Language": "es-CL,es;q=0.9",
          },
          redirect: "follow",
        });
        if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status} for ${url}`) as Error & {
            status?: number;
          };
          err.status = res.status;
          throw err;
        }
        return await res.text();
      } catch (e) {
        lastErr = e;
        // Don't retry definite 4xx (has status set, < 500).
        const status = (e as { status?: number }).status;
        if (status && status < 500) throw e;
        if (attempt < this.retries) await sleep(500 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  // performance.now() is monotonic and allowed; Date.now() is blocked in some
  // sandboxes (workflows). performance.now() works everywhere we deploy.
  private monotonicNow(): number {
    return performance.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
