/**
 * Official-source web search.
 *
 * Restricts every query to government domains so the Copilot can cite live
 * sources rather than relying on a model's training data for facts that change.
 *
 * HONEST LIMITATION, stated here because it matters operationally: the default
 * provider scrapes DuckDuckGo's HTML endpoint. That has no API contract, is
 * rate-limited, and will break when their markup changes. It is adequate for a
 * proof of concept and is NOT a production search layer. When it fails it says
 * so - the Copilot then answers from the knowledge base alone and tells the
 * officer that live search was unavailable, rather than quietly returning less.
 *
 * `ISearchProvider` is the seam: a paid Search API drops in via
 * `setSearchProvider()` without touching any caller.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Domain, shown to the officer so the source is visible at a glance. */
  source: string;
  /** Page text, when the fetch succeeded. */
  content?: string;
}

export interface SearchOutcome {
  ok: boolean;
  results: SearchResult[];
  /** Why a search returned nothing, when it did. */
  note?: string;
  provider: string;
}

export interface ISearchProvider {
  readonly name: string;
  readonly available: boolean;
  search(query: string, limit?: number): Promise<SearchOutcome>;
}

/**
 * Domains treated as official.
 *
 * Only these are searched and only these are returned. A result from anywhere
 * else is dropped rather than shown - a Copilot citing a blog as a government
 * source would be worse than citing nothing.
 */
const OFFICIAL_DOMAINS = [
  'tn.gov.in',
  'gov.in',
  'nic.in',
  'tnega.tn.gov.in',
  'cms.tn.gov.in',
  'stationeryprinting.tn.gov.in',   // Tamil Nadu Gazette
  'indiacode.nic.in',                // central and state Acts
  'egazette.gov.in',
];

function isOfficial(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function domainOf(url: string): string {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
}

/** Strip HTML to readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0 Safari/537.36';

async function fetchWithTimeout(url: string, ms: number, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, ...headers },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================ DuckDuckGo
class DuckDuckGoProvider implements ISearchProvider {
  readonly name = 'duckduckgo-html';
  readonly available = true;

  async search(query: string, limit = 3): Promise<SearchOutcome> {
    // Restrict to official domains at the query level, then filter again on the
    // results - the operator is a hint to the engine, not a guarantee.
    const scoped = `${query} (site:tn.gov.in OR site:gov.in OR site:nic.in)`;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(scoped)}`;

    let html: string;
    try {
      const res = await fetchWithTimeout(url, 12000);
      if (!res.ok) {
        return {
          ok: false, results: [], provider: this.name,
          note: `The search service returned ${res.status}. Live search is unavailable; answering from the configured knowledge base only.`,
        };
      }
      html = await res.text();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false, results: [], provider: this.name,
        note: `Live search could not be reached (${msg}). Answering from the configured knowledge base only.`,
      };
    }

    const results = this.parse(html).filter((r) => isOfficial(r.url)).slice(0, limit);

    if (!results.length) {
      return {
        ok: true, results: [], provider: this.name,
        note: 'No official government source was found for this query.',
      };
    }

    // Fetch page text in parallel. A page that will not load still appears with
    // its snippet - a partial source is better than dropping it silently.
    await Promise.all(results.map(async (r) => {
      try {
        const res = await fetchWithTimeout(r.url, 10000);
        if (!res.ok) return;
        const type = res.headers.get('content-type') ?? '';
        if (!type.includes('html') && !type.includes('text')) return;
        const body = await res.text();
        const text = htmlToText(body);
        if (text.length > 100) r.content = text.slice(0, 4000);
      } catch { /* snippet still stands */ }
    }));

    return { ok: true, results, provider: this.name };
  }

  /**
   * Parse DuckDuckGo's HTML result list.
   *
   * Deliberately tolerant: markup changes are expected, and returning fewer
   * results is better than throwing.
   */
  private parse(html: string): SearchResult[] {
    const out: SearchResult[] = [];
    const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

    const snippets: string[] = [];
    for (const m of html.matchAll(snippetRe)) snippets.push(htmlToText(m[1]));

    let i = 0;
    for (const m of html.matchAll(linkRe)) {
      let url = m[1];

      // DuckDuckGo wraps results in a redirect carrying the real URL in `uddg`.
      if (url.includes('uddg=')) {
        try {
          const wrapped = new URL(url.startsWith('//') ? `https:${url}` : url, 'https://duckduckgo.com');
          const real = wrapped.searchParams.get('uddg');
          if (real) url = decodeURIComponent(real);
        } catch { /* keep as-is */ }
      }
      if (!/^https?:\/\//.test(url)) continue;

      out.push({
        title: htmlToText(m[2]).slice(0, 200),
        url,
        snippet: snippets[i] ?? '',
        source: domainOf(url),
      });
      i++;
      if (out.length >= 10) break;
    }
    return out;
  }
}

// ==================================================== Google Programmable
/**
 * Google Programmable Search.
 *
 * A real API with a contract and a quota. Used automatically when
 * GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX are set.
 */
class GoogleSearchProvider implements ISearchProvider {
  readonly name = 'google-programmable-search';
  readonly available: boolean;

  constructor(private key: string, private cx: string) {
    this.available = !!key && !!cx;
  }

  async search(query: string, limit = 3): Promise<SearchOutcome> {
    const scoped = `${query} site:tn.gov.in OR site:gov.in OR site:nic.in`;
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(this.key)}` +
      `&cx=${encodeURIComponent(this.cx)}&q=${encodeURIComponent(scoped)}&num=${Math.min(limit, 10)}`;

    try {
      const res = await fetchWithTimeout(url, 12000);
      if (!res.ok) {
        return {
          ok: false, results: [], provider: this.name,
          note: `Search API returned ${res.status}. Answering from the configured knowledge base only.`,
        };
      }
      const json: any = await res.json();
      const items: any[] = json.items ?? [];
      const results: SearchResult[] = items
        .map((it) => ({
          title: String(it.title ?? ''),
          url: String(it.link ?? ''),
          snippet: String(it.snippet ?? ''),
          source: domainOf(String(it.link ?? '')),
        }))
        .filter((r) => isOfficial(r.url))
        .slice(0, limit);

      await Promise.all(results.map(async (r) => {
        try {
          const page = await fetchWithTimeout(r.url, 10000);
          if (!page.ok) return;
          const text = htmlToText(await page.text());
          if (text.length > 100) r.content = text.slice(0, 4000);
        } catch { /* snippet still stands */ }
      }));

      return {
        ok: true, results, provider: this.name,
        note: results.length ? undefined : 'No official government source was found for this query.',
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false, results: [], provider: this.name,
        note: `Search API could not be reached (${msg}). Answering from the configured knowledge base only.`,
      };
    }
  }
}

// ---------------------------------------------------------------- wiring
let searchProvider: ISearchProvider = (() => {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (key && cx) return new GoogleSearchProvider(key, cx);
  return new DuckDuckGoProvider();
})();

export function setSearchProvider(p: ISearchProvider): void { searchProvider = p; }
export function getSearchProvider(): ISearchProvider { return searchProvider; }

/**
 * Cache, because a Copilot conversation asks similar things repeatedly and the
 * scraper is rate-limited. Fifteen minutes is long enough to help a session and
 * short enough that a notification published today is not missed.
 */
const cache = new Map<string, { at: number; outcome: SearchOutcome }>();
const TTL_MS = 15 * 60 * 1000;

export async function searchOfficialSources(query: string, limit = 3): Promise<SearchOutcome> {
  const key = `${query}::${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.outcome;

  const outcome = await searchProvider.search(query, limit);

  // Only a successful search is cached; a transient failure should be retried.
  if (outcome.ok) {
    cache.set(key, { at: Date.now(), outcome });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  }
  return outcome;
}

export function searchStatus() {
  return {
    provider: searchProvider.name,
    available: searchProvider.available,
    official_domains: OFFICIAL_DOMAINS,
    note: searchProvider.name === 'duckduckgo-html'
      ? 'Using the HTML scraper. It has no API contract and may be rate-limited; set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX for a reliable search API.'
      : 'Using a search API with a service contract.',
  };
}
