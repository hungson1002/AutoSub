import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { workdir } from './ffmpeg';

const flowUrl = 'https://labs.google/fx/vi/tools/flow';
const executablePath = process.env.COCCOC_PATH?.trim() || 'C:\\Program Files\\CocCoc\\Browser\\Application\\browser.exe';
const profilePath = path.join(workdir, 'flow-browser-profile');
let contextPromise: Promise<BrowserContext> | undefined;

async function context() {
  if (!contextPromise) {
    await mkdir(profilePath, { recursive: true });
    contextPromise = chromium.launchPersistentContext(profilePath, {
      executablePath,
      headless: false,
      viewport: null,
      args: ['--start-maximized', '--disable-default-apps'],
    }).then((browserContext) => {
      browserContext.once('close', () => { contextPromise = undefined; });
      return browserContext;
    }).catch((error) => {
      contextPromise = undefined;
      throw error;
    });
  }
  return contextPromise;
}

async function flowPage(browserContext: BrowserContext): Promise<Page> {
  const existing = browserContext.pages().find((page) => /labs\.google|accounts\.google/.test(page.url()));
  return existing || browserContext.pages()[0] || browserContext.newPage();
}

export async function openFlowBrowser() {
  const browserContext = await context();
  const page = await flowPage(browserContext);
  if (!/labs\.google|accounts\.google/.test(page.url())) await page.goto(flowUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.bringToFront();
  return flowBrowserStatus();
}

export async function flowBrowserStatus() {
  if (!contextPromise) return { open: false, signedIn: false, url: '' };
  try {
    const browserContext = await contextPromise;
    const page = await flowPage(browserContext);
    const url = page.url();
    const signedIn = /labs\.google\/fx\//.test(url) && !/accounts\.google/.test(url) && await page.locator('body').evaluate((body) => !/đăng nhập|sign in|try google flow|get started/i.test(body.innerText.slice(0, 12000))).catch(() => false);
    return { open: true, signedIn, url };
  } catch {
    contextPromise = undefined;
    return { open: false, signedIn: false, url: '' };
  }
}

export async function closeFlowBrowser() {
  const pending = contextPromise;
  contextPromise = undefined;
  if (pending) await pending.then((browserContext) => browserContext.close()).catch(() => undefined);
  return { open: false, signedIn: false, url: '' };
}

export async function inspectFlowBrowser() {
  const browserContext = await context();
  const page = await flowPage(browserContext);
  const controls = await page.locator('textarea, input, [contenteditable="true"], button').evaluateAll((elements) => elements.slice(0, 120).map((element) => ({
    tag: element.tagName.toLowerCase(),
    text: (element.textContent || '').trim().slice(0, 160),
    ariaLabel: element.getAttribute('aria-label') || '',
    placeholder: element.getAttribute('placeholder') || '',
    type: element.getAttribute('type') || '',
    visible: Boolean((element as any).offsetWidth || (element as any).offsetHeight),
  })).filter((item) => item.visible));
  return { url: page.url(), title: await page.title(), controls };
}
