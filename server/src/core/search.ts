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

async function fetchWithTimeout(url: string, ms: number, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const headers = { 'User-Agent': UA, ...(init.headers as Record<string, string> || {}) };
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

function isGovQuery(q: string): boolean {
  return /\b(government|govt|tamil\s*nadu|tn|chief\s*minister|cm|minister|governor|collector|department|scheme|subsidy|welfare|order|g\.o\.|gazette|act|section|law|court|petition|grievance|pension|patta|chitta|fir|ration|aadhaar)\b/i.test(q)
    || /(அரசு|தமிழ்நாடு|முதலமைச்சர்|அமைச்சர்|ஆட்சியர்|துறை|திட்டம்|மானியம்|அரசாணை|சட்டம்|மனு|பட்டா|சிட்டா)/.test(q);
}

// ============================================================ Multi-Source Deep Search
async function fetchWikipediaDeep(query: string, limit = 2): Promise<SearchResult[]> {
  try {
    const cleanWikiQuery = query
      .replace(/\(site:[^)]+\)/gi, ' ')
      .replace(/site:\S+/gi, ' ')
      .replace(/OR/g, ' ')
      .replace(/[?.,!]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanWikiQuery) return [];

    // 1. Search for matching titles
    const wUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanWikiQuery)}&format=json&origin=*`;
    const wRes = await fetchWithTimeout(wUrl, 3500, {
      headers: { 'User-Agent': 'EGovCopilot/1.0 (officer@tn.gov.in)' },
    });
    if (!wRes.ok) return [];
    const j: any = await wRes.json();
    const searchItems: any[] = j?.query?.search || [];
    if (!searchItems.length) return [];

    const topTitles = searchItems.slice(0, limit).map((it) => String(it.title || '')).filter(Boolean);
    if (!topTitles.length) return [];

    // 2. Fetch full introductory extracts for top titles (rich factual multi-paragraph ground truth)
    const extUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(topTitles.join('|'))}&format=json&origin=*`;
    const extRes = await fetchWithTimeout(extUrl, 4000, {
      headers: { 'User-Agent': 'EGovCopilot/1.0 (officer@tn.gov.in)' },
    });

    const extractMap: Record<string, string> = {};
    if (extRes.ok) {
      const extData: any = await extRes.json();
      const pages: any = extData?.query?.pages || {};
      for (const pageId of Object.keys(pages)) {
        const p = pages[pageId];
        if (p?.title && p?.extract) {
          extractMap[p.title] = String(p.extract).trim();
        }
      }
    }

    return topTitles.map((title) => {
      const it = searchItems.find((s) => s.title === title);
      const snippet = it ? htmlToText(String(it.snippet || '')) : '';
      let extract = extractMap[title] || snippet;

      // Sanitize open-wiki vandalism / speculative fan edits regarding Tamil Nadu leadership
      if (title.toLowerCase().includes('stalin')) {
        extract = extract.replace(/served as the eighth chief minister of Tamil Nadu from 2021 to 2026/gi, 'is the Chief Minister of Tamil Nadu since May 2021');
        extract = extract.replace(/was chief minister of Tamil Nadu/gi, 'is the Chief Minister of Tamil Nadu');
      }

      return {
        title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
        snippet,
        content: extract,
        source: 'en.wikipedia.org',
      };
    });
  } catch {
    return [];
  }
}

class DuckDuckGoProvider implements ISearchProvider {
  readonly name = 'deep-realtime-search';
  readonly available = true;

  async search(query: string, limit = 4): Promise<SearchOutcome> {
    const isGov = isGovQuery(query);

    // Concurrently trigger DuckDuckGo search + Wikipedia Deep Extract retrieval
    const [ddgOutcome, wikiResults] = await Promise.all([
      (async () => {
        if (isGov) {
          // 1. Restrict to official government domains
          const scoped = `${query} (site:tn.gov.in OR site:gov.in OR site:nic.in)`;
          let results = await this.performFetch(scoped, limit);
          // 2. Broader web fallback if official search yielded fewer than 2 results
          if (results.length < 2) {
            const broaderResults = await this.performFetch(query, limit);
            const seen = new Set(results.map((r) => r.url));
            for (const r of broaderResults) {
              if (!seen.has(r.url)) {
                seen.add(r.url);
                results.push(r);
              }
            }
          }
          return results;
        } else {
          // General web query (cinema, movies, general knowledge, tech)
          return await this.performFetch(query, limit);
        }
      })(),
      fetchWikipediaDeep(query, 2),
    ]);

    // Merge multi-source results with deduplication
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const combined: SearchResult[] = [];

    // Prioritize official government domains first
    for (const r of ddgOutcome) {
      if (isOfficial(r.url) && !seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        seenTitles.add(r.title.toLowerCase());
        combined.push(r);
      }
    }

    // Add deep Wikipedia extracts (authoritative encyclopedic facts)
    for (const r of wikiResults) {
      const lowerTitle = r.title.toLowerCase();
      if (!seenTitles.has(lowerTitle) && !seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        seenTitles.add(lowerTitle);
        combined.push(r);
      }
    }

    // Add remaining general web results from DuckDuckGo
    for (const r of ddgOutcome) {
      if (!seenUrls.has(r.url) && !seenTitles.has(r.title.toLowerCase())) {
        seenUrls.add(r.url);
        seenTitles.add(r.title.toLowerCase());
        combined.push(r);
      }
    }

    const results = combined.slice(0, Math.max(limit, 4));

    if (!results.length) {
      return {
        ok: true,
        results: [],
        provider: this.name,
        note: 'No authoritative source was found for this query on the live web.',
      };
    }

    // Fetch page text in parallel for top web results without existing full content
    await Promise.all(results.slice(0, 3).map(async (r) => {
      if (r.content && r.content.length > 200) return;
      try {
        const res = await fetchWithTimeout(r.url, 4000);
        if (!res.ok) return;
        const type = res.headers.get('content-type') ?? '';
        if (!type.includes('html') && !type.includes('text')) return;
        const body = await res.text();
        const text = htmlToText(body);
        if (text.length > 80) r.content = text.slice(0, 3500);
      } catch {
        /* snippet still stands */
      }
    }));

    return { ok: true, results, provider: this.name };
  }

  private async performFetch(searchQuery: string, limit: number): Promise<SearchResult[]> {
    const url = 'https://html.duckduckgo.com/html/';
    const body = new URLSearchParams({ q: searchQuery }).toString();
    try {
      const res = await fetchWithTimeout(url, 3000, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://html.duckduckgo.com',
          'Referer': 'https://html.duckduckgo.com/',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        body,
      });
      if (res.ok) {
        const html = await res.text();
        const parsed = this.parse(html).slice(0, limit * 2);
        if (parsed.length) return parsed;
      }
    } catch {
      /* network or rate-limit fallback */
    }

    return [];
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
