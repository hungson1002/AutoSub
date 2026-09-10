import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let enabled = false;
  let allowWrites = false;
  let failNext = false;
  let tunnelPhase = 'stopped';
  const snapshot = () => ({ enabled, allowWrites, hasToken: true, endpoint: 'http://127.0.0.1:8787/api/mcp', desktopConfig: { mcpServers: { autosub: { command: 'node', args: ['local-bridge.ts'] } } } });
  // Isolated UI fixture: never changes the user's MCP settings or credentials.
  await page.route('**/api/mcp-settings**', async (route) => {
    if (route.request().url().includes('/tunnel')) {
      if (route.request().url().endsWith('/connect')) tunnelPhase = 'ready';
      if (route.request().url().endsWith('/disconnect')) tunnelPhase = 'stopped';
      return route.fulfill({ json: { tunnelId: `tunnel_${'a'.repeat(32)}`, hasKey: true, phase: tunnelPhase, message: '' } });
    }
    if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { error: 'Fixture failure' } }); }
    if (route.request().method() === 'PUT') { const body = route.request().postDataJSON(); enabled = body.enabled; allowWrites = body.allowWrites; }
    await route.fulfill({ json: route.request().url().endsWith('/rotate-token') ? { ...snapshot(), token: 'test-token-not-a-real-credential' } : snapshot() });
  });
  await page.route('**/api/system', (route) => route.fulfill({ json: { ffmpeg: true, ffprobe: true, workdir: 'local workdir' } }));
  await page.goto('http://localhost:5173');
  await page.getByRole('button', { name: /Cài đặt/ }).click();
  const panel = page.locator('.mcp-settings');
  await panel.getByLabel('Bật MCP server').check();
  await panel.getByLabel(/Cho phép tạo/).check();
  await panel.getByRole('button', { name: 'Lưu MCP', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Đã lưu' }).waitFor();
  assert.ok(enabled && allowWrites);
  await panel.getByLabel('OpenAI Runtime API key').fill('sk-test-not-a-real-key');
  await panel.getByRole('button', { name: 'Lưu & kết nối tunnel' }).click();
  await panel.getByRole('status').filter({ hasText: 'Tunnel sẵn sàng' }).waitFor();
  assert.equal(await panel.getByLabel('OpenAI Runtime API key').inputValue(), '');
  await panel.getByRole('button', { name: 'Ngắt kết nối', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Chưa kết nối' }).waitFor();
  failNext = true;
  await panel.getByRole('button', { name: 'Tải lại trạng thái' }).click();
  await panel.getByRole('alert').waitFor();
  await panel.getByRole('button', { name: 'Thử lại' }).click();
  await panel.getByRole('alert').waitFor({ state: 'hidden' });
  await panel.locator('summary').filter({ hasText: 'desktop' }).click();
  assert.match(await panel.getByLabel('Cấu hình MCP desktop').inputValue(), /mcpServers/);
  await panel.getByRole('button', { name: 'Sao chép cấu hình', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /mcpServers/);
  await panel.locator('summary').filter({ hasText: 'Streamable HTTP' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await panel.getByRole('button', { name: 'Tạo / đổi khóa HTTP' }).click();
  await panel.getByLabel('Khóa mới (ẩn sau khi rời trang)').waitFor();
  await panel.getByRole('button', { name: 'Sao chép khóa', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'test-token-not-a-real-credential');
  await mkdir('artifacts/mcp', { recursive: true });
  const probe = await readFile('C:/Users/super/.codex/skills/frontend-craft/scripts/viewport_probe.js', 'utf8');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await panel.scrollIntoViewIfNeeded();
    const geometry = await panel.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
    assert.ok(geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry));
    await panel.getByRole('heading').first().scrollIntoViewIfNeeded();
    await panel.getByLabel('Bật MCP server').focus();
    await page.screenshot({ path: `artifacts/mcp/settings-${width}.png` });
    const report = await page.evaluate(probe);
    console.log('VIEWPORT', width, JSON.stringify({ horizontalOverflow: report.horizontalOverflow, clippedFocusedElements: report.clippedFocusedElements, panel: geometry }));
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 720, height: 500 });
  await panel.getByLabel('Bật MCP server').focus();
  await page.keyboard.press('Space');
  assert.equal(await panel.getByLabel('Bật MCP server').isChecked(), false);
  assert.deepEqual(errors, []);
  console.log('UI PASS: save, failure/retry, desktop/HTTP details, widths 390/768/1440, keyboard, reduced motion.');
} finally { await browser.close(); }
