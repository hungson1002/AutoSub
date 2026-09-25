export type DirectorWebSource = {
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  excerpt?: string;
};

type SearchResult = { title: string; url: string; snippet?: string };

const MAX_QUERIES = 4;
const MAX_RESULTS_PER_QUERY = 4;
const MAX_SOURCES = 8;
const REQUEST_HEADERS = {
  'User-Agent': 'AutoSub-Director/1.0 (research)',
  Accept: 'text/html,application/xhtml+xml',
};

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&#(\d+);/gu, (_match: string, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_match: string, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function htmlToText(html: string) {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/giu, ' ')
    .replace(/<[^>]+>/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim();
}

function resolveSearchUrl(value: string) {
  const decoded = decodeHtml(value);
  const candidate = decoded.startsWith('//') ? `https:${decoded}` : decoded;
  try {
    const url = new URL(candidate);
    const redirected = url.searchParams.get('uddg');
    return redirected ? decodeURIComponent(redirected) : url.toString();
  } catch {
    return '';
  }
}

export function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const attributes = match[1] || '';
    if (!/\bclass=["'][^"']*\bresult__a\b[^"']*["']/iu.test(attributes)) continue;
    const href = attributes.match(/\bhref=["']([^"']+)["']/iu)?.[1] || '';
    const url = resolveSearchUrl(href);
    const title = htmlToText(match[2] || '');
    if (!url || !/^https?:\/\//iu.test(url) || !title) continue;
    results.push({ title: title.slice(0, 240), url });
  }
  const snippets = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)]
    .filter((match) => /\bclass=["'][^"']*\bresult__snippet\b[^"']*["']/iu.test(match[1] || ''))
    .map((match) => htmlToText(match[2] || '').slice(0, 500));
  return results.slice(0, MAX_RESULTS_PER_QUERY).map((item, index) => ({ ...item, snippet: snippets[index] || undefined }));
}

export function fallbackResearchQueries(brief: string): string[] {
  const compact = String(brief || '').replace(/\s+/gu, ' ').trim();
  const topic = (compact.split(/[.!?\u00a1\u00bf\u3002\uff01\uff1f]/u)[0] || compact).slice(0, 180);
  if (!topic) return [];
  const vietnamese = /[\u0103\u00e2\u0111\u00ea\u00f4\u01a1\u01b0\u00e0-\u00e3\u1ea1-\u1ef9]/iu.test(topic);
  return vietnamese
    ? [`${topic} số liệu nguồn chính thức`, `${topic} nghiên cứu học thuật bằng chứng`, `${topic} nguyên nhân cơ chế nghiên cứu`, `${topic} tranh luận giới hạn ngoại lệ`]
    : [`${topic} official data primary sources`, `${topic} peer reviewed research evidence`, `${topic} causes mechanism study`, `${topic} limitations counter evidence`];
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(endpoint, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Search HTTP ${response.status}`);
  return parseDuckDuckGoResults(await response.text());
}

async function enrichSource(result: SearchResult): Promise<DirectorWebSource> {
  let excerpt = '';
  try {
    const response = await fetch(result.url, { headers: REQUEST_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(7_000) });
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && /text\/html|application\/xhtml\+xml/iu.test(contentType)) {
      const pageText = htmlToText((await response.text()).slice(0, 900_000));
      excerpt = selectRelevantExcerpt(pageText, `${result.title} ${result.snippet || ''}`);
    }
  } catch {
    // Search snippets remain useful when a source blocks automated page reads.
  }
  let domain = '';
  try { domain = new URL(result.url).hostname.replace(/^www\./iu, ''); } catch { /* URL was validated by the search parser. */ }
  return { title: result.title, url: result.url, domain, snippet: result.snippet, excerpt: excerpt || undefined };
}

const EXCERPT_CHARS = 2_400;
const EXCERPT_STOP_WORDS = new Set([
  'about', 'after', 'also', 'from', 'have', 'into', 'more', 'over', 'that', 'their', 'there', 'these', 'this', 'through', 'with',
  'bằng', 'cho', 'của', 'được', 'trong', 'theo', 'những', 'người', 'một', 'này', 'với', 'về', 'khi', 'tại', 'các', 'đang',
]);

/** Prefer the part of a fetched page that overlaps its search result, not boilerplate at the top. */
export function selectRelevantExcerpt(pageText: string, searchContext: string) {
  const text = String(pageText || '').replace(/\s+/gu, ' ').trim();
  if (text.length <= EXCERPT_CHARS) return text;
  const terms = [...new Set((String(searchContext || '').toLocaleLowerCase().normalize('NFC').match(/[\p{L}\p{N}]{4,}/gu) || [])
    .filter((term) => !EXCERPT_STOP_WORDS.has(term)))].slice(0, 20);
  if (!terms.length) return text.slice(0, EXCERPT_CHARS);

  const normalized = text.toLocaleLowerCase().normalize('NFC');
  const starts = new Set<number>([0]);
  for (const term of terms) {
    let cursor = 0;
    for (let occurrence = 0; occurrence < 4; occurrence += 1) {
      const position = normalized.indexOf(term, cursor);
      if (position < 0) break;
      starts.add(Math.min(Math.max(0, position - 400), Math.max(0, text.length - EXCERPT_CHARS)));
      cursor = position + term.length;
    }
  }

  let bestStart = 0;
  let bestScore = -1;
  for (const start of starts) {
    const window = normalized.slice(start, start + EXCERPT_CHARS);
    const score = terms.reduce((total, term) => total + (window.includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  return text.slice(bestStart, bestStart + EXCERPT_CHARS);
}

export async function collectDirectorResearchSources(queries: string[], onStage: (stage: string) => Promise<void> = async () => {}) {
  const selectedQueries = queries.map((query) => String(query || '').replace(/\s+/gu, ' ').trim()).filter(Boolean).slice(0, MAX_QUERIES);
  if (!selectedQueries.length) return { queries: [], sources: [], failedQueries: 0 };
  const searched = await Promise.all(selectedQueries.map(async (query) => {
    try { return await searchDuckDuckGo(query); }
    catch { return []; }
  }));
  const candidates = new Map<string, SearchResult>();
  for (const results of searched) for (const result of results) {
    const key = result.url.replace(/[?#].*$/u, '').toLowerCase();
    if (!candidates.has(key)) candidates.set(key, result);
  }
  const selected = [...candidates.values()].slice(0, MAX_SOURCES);
  await onStage(`\u0110\u00e3 t\u00ecm th\u1ea5y ${selected.length} ngu\u1ed3n \u00b7 \u0111ang \u0111\u1ecdc n\u1ed9i dung t\u00f3m t\u1eaft`);
  const sources = await Promise.all(selected.map(enrichSource));
  return { queries: selectedQueries, sources, failedQueries: searched.filter((results) => !results.length).length };
}

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set(['ac.uk', 'co.uk', 'gov.uk', 'org.uk', 'com.au', 'edu.au', 'gov.au', 'org.au', 'co.nz', 'com.br', 'com.cn', 'com.hk', 'com.sg', 'com.vn', 'co.in', 'co.jp', 'co.kr', 'com.mx', 'co.za']);

function researchUrlKey(value: string) {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/u, '')}`;
  } catch {
    return '';
  }
}

function publisherDomain(value: string) {
  const host = String(value || '').toLowerCase().replace(/^www\d*\./u, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return host;
  const suffix = labels.slice(-2).join('.');
  return labels.slice(-(MULTI_LABEL_PUBLIC_SUFFIXES.has(suffix) ? 3 : 2)).join('.');
}

/** Only treat claims as cross-checked when both URLs were fetched and span publishers. */
export function verifyIndependentResearchSources(candidateUrls: string[], sources: DirectorWebSource[]) {
  const fetchedByUrl = new Map(sources
    .filter((source) => Boolean(source.excerpt?.trim()))
    .map((source) => [researchUrlKey(source.url), source] as const)
    .filter(([key]) => Boolean(key)));
  const verifiedSources = [...new Set(candidateUrls.map(researchUrlKey).filter(Boolean))]
    .map((key) => fetchedByUrl.get(key))
    .filter((source): source is DirectorWebSource => Boolean(source));
  const publisherDomains = new Set(verifiedSources.map((source) => publisherDomain(source.domain || new URL(source.url).hostname)).filter(Boolean));
  return {
    sourceUrls: [...new Set(verifiedSources.map((source) => source.url))],
    publisherCount: publisherDomains.size,
    independentlyCorroborated: publisherDomains.size >= 2,
  };
}

export function formatDirectorResearchDossier(sources: DirectorWebSource[]) {
  if (!sources.length) return 'NO WEB SOURCES WERE RETRIEVED. Treat precise/current claims as unsupported and mark them qualify or avoid.';
  return sources.map((source, index) => [
    `SOURCE ${index + 1}`,
    `Title: ${source.title}`,
    `Domain: ${source.domain}`,
    `URL: ${source.url}`,
    source.excerpt ? `Fetched page excerpt (preferred evidence): ${source.excerpt}` : '',
    source.snippet ? `Search snippet (discovery hint only; not sufficient evidence by itself): ${source.snippet}` : '',
  ].filter(Boolean).join('\n')).join('\n\n').slice(0, 24_000);
}
