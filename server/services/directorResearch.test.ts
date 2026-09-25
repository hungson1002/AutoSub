import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackResearchQueries, formatDirectorResearchDossier, parseDuckDuckGoResults, verifyIndependentResearchSources } from './directorResearch';

test('parses DuckDuckGo result links and keeps the search snippet', () => {
  const html = [
    '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Freport&amp;rut=abc">Official report</a>',
    '<a class="result__snippet">A concise evidence summary.</a>',
  ].join('');
  assert.deepEqual(parseDuckDuckGoResults(html), [{
    title: 'Official report',
    url: 'https://example.com/report',
    snippet: 'A concise evidence summary.',
  }]);
});

test('fallback research queries stay bounded and follow the brief language', () => {
  const queries = fallbackResearchQueries('Vì sao giá nhà tăng nhanh hơn tiền lương?');
  assert.equal(queries.length, 4);
  assert.ok(queries.every((query) => query.includes('giá nhà')));
  assert.ok(queries.some((query) => query.includes('nguồn chính thức')));
});

test('research dossier includes URLs so the director can trace every usable fact', () => {
  const dossier = formatDirectorResearchDossier([{ title: 'Report', url: 'https://example.com/report', domain: 'example.com', excerpt: 'Evidence.' }]);
  assert.match(dossier, /URL: https:\/\/example\.com\/report/);
  assert.match(formatDirectorResearchDossier([]), /NO WEB SOURCES WERE RETRIEVED/);
});

test('a factual claim needs fetched excerpts from two independent publishers', () => {
  const sources = [
    { title: 'A', url: 'https://www.example.co.uk/report', domain: 'www.example.co.uk', excerpt: 'Fetched evidence A.' },
    { title: 'A subdomain', url: 'https://news.example.co.uk/another-report', domain: 'news.example.co.uk', excerpt: 'Fetched evidence from the same publisher.' },
    { title: 'B', url: 'https://independent.org/report', domain: 'independent.org', excerpt: 'Fetched evidence B.' },
    { title: 'Snippet only', url: 'https://third.org/report', domain: 'third.org', snippet: 'Search snippet, not fetched evidence.' },
  ];

  assert.deepEqual(verifyIndependentResearchSources([
    'https://www.example.co.uk/report?utm_source=search',
    'https://news.example.co.uk/another-report',
  ], sources), {
    sourceUrls: ['https://www.example.co.uk/report', 'https://news.example.co.uk/another-report'],
    publisherCount: 1,
    independentlyCorroborated: false,
  });
  assert.equal(verifyIndependentResearchSources([
    'https://www.example.co.uk/report',
    'https://independent.org/report',
    'https://third.org/report',
  ], sources).independentlyCorroborated, true);
  assert.equal(verifyIndependentResearchSources([
    'https://www.example.co.uk/report',
    'https://third.org/report',
  ], sources).independentlyCorroborated, false);
});
