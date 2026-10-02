import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { workdir } from './ffmpeg';

export type RealImageLicense = 'PD' | 'CC0' | 'CC-BY' | 'CC-BY-SA' | 'OTHER';

export type RealImageAsset = {
  id: string;
  title: string;
  pageUrl: string;
  imageUrl: string;
  thumbUrl?: string;
  width: number;
  height: number;
  author: string;
  license: RealImageLicense;
  licenseUrl?: string;
  credit: string;
  cacheKey: string;
  localPath?: string;
};

export type RealImageSearchOptions = {
  limit?: number;
  minWidth?: number;
  signal?: AbortSignal;
  endpoint?: string;
};

const DEFAULT_ENDPOINT = 'https://commons.wikimedia.org/w/api.php';
const ALLOWED_LICENSES: RealImageLicense[] = ['PD', 'CC0', 'CC-BY', 'CC-BY-SA'];

export function isAllowedLicense(license: RealImageLicense): boolean {
  return ALLOWED_LICENSES.includes(license);
}

export function buildSearchUrl(query: string, limit = 8): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${query}`,
    gsrlimit: String(Math.max(1, Math.min(20, limit))),
    gsrnamespace: '6',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName|UsageTerms',
    iiurlwidth: '1280',
  });
  return `${DEFAULT_ENDPOINT}?${params.toString()}`;
}

function detectLicense(shortName: string, usageTerms: string): RealImageLicense {
  const hay = `${shortName} ${usageTerms}`.toLowerCase();
  if (/public domain|pd-old|pd-self|pd-user|no known copyright/.test(hay)) return 'PD';
  if (/cc0|public domain dedication/.test(hay)) return 'CC0';
  if (/cc-by-sa|by-sa/.test(hay)) return 'CC-BY-SA';
  if (/cc-by|attribution/.test(hay)) return 'CC-BY';
  return 'OTHER';
}

function stripHtml(value: string): string {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Wikimedia Commons';
}

export function parseSearchResponse(json: any, minWidth = 1280): RealImageAsset[] {
  const pages = json?.query?.pages ? Object.values(json.query.pages) as any[] : [];
  const out: RealImageAsset[] = [];
  for (const page of pages) {
    const info = page?.imageinfo?.[0];
    if (!info?.url) continue;
    const width = Number(info.width) || 0;
    const height = Number(info.height) || 0;
    if (width < minWidth) continue;
    const meta = info.extmetadata || {};
    const license = detectLicense(String(meta.LicenseShortName?.value || ''), String(meta.UsageTerms?.value || ''));
    if (!isAllowedLicense(license)) continue;
    const author = stripHtml(String(meta.Artist?.value || 'Wikimedia Commons'));
    const title = String(page.title || '').replace(/^File:/, '');
    const id = `real-${createHash('sha256').update(String(info.url)).digest('hex').slice(0, 16)}`;
    const credit = formatCredit(author, license);
    out.push({
      id,
      title,
      pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(page.title || ''))}`,
      imageUrl: String(info.url),
      thumbUrl: info.thumburl ? String(info.thumburl) : undefined,
      width,
      height,
      author,
      license,
      credit,
      cacheKey: createHash('sha256').update(JSON.stringify({ u: info.url, w: width, h: height })).digest('hex'),
    });
  }
  return out.sort((a, b) => b.width - a.width);
}

export function formatCredit(author: string, license: RealImageLicense): string {
  const clean = String(author || 'Wikimedia Commons').slice(0, 60);
  const tag = license === 'PD' ? 'Public domain' : license === 'CC0' ? 'CC0' : license;
  return `Ảnh: ${clean} • Wikimedia • ${tag}`;
}

export async function searchWikimediaImages(query: string, options: RealImageSearchOptions = {}): Promise<RealImageAsset[]> {
  const q = String(query || '').trim();
  if (!q) return [];
  const limit = Math.max(1, Math.min(20, options.limit ?? 8));
  const minWidth = options.minWidth ?? 1280;
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${q}`,
    gsrlimit: String(limit),
    gsrnamespace: '6',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName|UsageTerms',
    iiurlwidth: '1280',
  });
  const res = await fetch(`${endpoint}?${params.toString()}`, { signal: options.signal });
  if (!res.ok) throw new Error(`Wikimedia search failed: HTTP ${res.status}`);
  const json = await res.json();
  return parseSearchResponse(json, minWidth);
}

export async function downloadRealImage(asset: RealImageAsset, signal?: AbortSignal): Promise<string> {
  const dir = path.join(workdir, 'assets', 'real');
  await mkdir(dir, { recursive: true });
  const ext = path.extname(new URL(asset.imageUrl).pathname).slice(0, 5) || '.jpg';
  const file = path.join(dir, `${asset.id}${ext === '.' ? '.jpg' : ext}`);
  try {
    const existing = await stat(file);
    if (existing.size > 1024) {
      await sharp(file).metadata();
      return file;
    }
  } catch { /* download */ }
  const res = await fetch(asset.imageUrl, { signal });
  if (!res.ok) throw new Error(`Tải ảnh thất bại: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error('Ảnh tải về quá nhỏ.');
  if (buf.length > 25 * 1024 * 1024) throw new Error('Ảnh vượt 25MB.');
  await sharp(buf).metadata();
  await writeFile(file, buf);
  return file;
}

export async function fetchRealImagePack(
  keywords: string[],
  options: RealImageSearchOptions & { perKeyword?: number } = {},
): Promise<RealImageAsset[]> {
  const perKeyword = Math.max(1, Math.min(3, options.perKeyword ?? 1));
  const seen = new Set<string>();
  const out: RealImageAsset[] = [];
  for (const keyword of keywords.map((k) => String(k || '').trim()).filter(Boolean).slice(0, 6)) {
    const found = await searchWikimediaImages(keyword, options).catch(() => []);
    for (const asset of found.slice(0, perKeyword)) {
      if (seen.has(asset.cacheKey)) continue;
      seen.add(asset.cacheKey);
      try {
        const localPath = await downloadRealImage(asset, options.signal);
        out.push({ ...asset, localPath });
      } catch {
        out.push(asset);
      }
      if (out.length >= keywords.length * perKeyword) break;
    }
  }
  return out;
}
