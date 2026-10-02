import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Isolated browser storage; never changes the user's project or saved cues.
const browser = await chromium.launch({
  executablePath: process.env.EDITOR_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1760, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.route('**/__editor_test_video.mp4', async route => route.fulfill({
    contentType: 'video/mp4', body: await readFile(process.env.EDITOR_TEST_VIDEO || 'tmp/narrative-actions/actions-test.mp4'),
  }));
  await page.route('**/__editor_text_test', route => route.fulfill({ contentType: 'text/html', body: `
    <html><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module">
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    const {useState} = React;
    const {createRoot} = ReactDOM;
    import {EditorPage} from '/src/pages/EditorPage.tsx';
    import {defaultSettings} from '/src/types.ts';
    import {parseSubtitle} from '/src/lib/subtitles.ts';
    import '/src/styles.css';
    const videoUrl = URL.createObjectURL(await (await fetch('/__editor_test_video.mp4')).blob());
    function Fixture() {
      const [settings, setSettings] = useState(defaultSettings);
      const [cues, setCues] = useState(() => {
        const parsed = parseSubtitle('1\\n00:00:00,000 --> 00:00:08,000\\nImported SRT\\n\\n2\\n00:00:08,000 --> 00:00:16,000\\nSecond subtitle');
        return [...parsed.map(cue => ({...cue, translatedText: 'Translated subtitle'})),
          {...parsed[0], id: 'manual', index: 3, sourceKind: 'onscreen-text', textOrigin: 'manual', originalText: 'Manual text', translatedText: '', timelineLane: 1}];
      });
      window.editorTestCues = cues;
      return React.createElement(EditorPage, {providers: [], settings, onSettingsChange: setSettings,
        cues, onCuesChange: setCues, asset: {name: 'Test', url: videoUrl, type: 'video/mp4', durationMs: 19200},
        onAssetChange: () => {}, onNotice: () => {}});
    }
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
    </script></html>` }));
  await page.goto((process.env.EDITOR_TEST_URL || 'http://localhost:5173') + '/__editor_text_test');
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2, null, {timeout: 20000});
  const inspector = page.locator('.text-inspector');
  async function editAtTime(cueText, time) {
    await page.locator('.timeline-cue').filter({hasText: cueText}).first().click();
    await inspector.waitFor();
    await page.locator('video').evaluate((video, next) => {video.currentTime = next;}, time);
    await page.waitForFunction(next => Math.abs(document.querySelector('video').currentTime - next) < .05, time);
    await page.waitForFunction(next => document.querySelector('.timeline-playhead')?.getAttribute('aria-label')?.includes(next),
      '00:' + String(time).padStart(2, '0') + '.00', {timeout: 5000});
    const playhead = await page.locator('.timeline-playhead').getAttribute('style');
    const original = inspector.locator('textarea').nth(0);
    await original.fill(cueText + ' edited');
    await original.press('End');
    await original.pressSequentially(' typing', {delay: 25});
    await inspector.locator('textarea').nth(1).fill('New translation');
    await page.waitForTimeout(250);
    assert.ok(Math.abs(await page.locator('video').evaluate(video => video.currentTime) - time) < .05, 'Text edit must preserve media time');
    assert.equal(await page.locator('.timeline-playhead').getAttribute('style'), playhead, 'Text edit must preserve timeline playhead');
    const updated = await page.evaluate(text => window.editorTestCues.find(cue => cue.originalText.startsWith(text)), cueText);
    assert.equal(updated.originalText, cueText + ' edited typing');
    assert.equal(updated.translatedText, 'New translation');
  }
  await editAtTime('Imported SRT', 4);
  await page.locator('.timeline-cue').filter({hasText: 'Second subtitle'}).first().click();
  await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 8) < .05);
  await editAtTime('Second subtitle', 11);
  await editAtTime('Manual text', 5);
  await page.locator('.video-controls .play-button').click();
  await page.waitForTimeout(300);
  await inspector.locator('textarea').nth(1).pressSequentially(' while playing', {delay: 25});
  assert.ok(await page.locator('video').evaluate(video => !video.paused && video.currentTime > 5), 'Typing must not pause or rewind playback');
  await page.locator('.video-controls .play-button').click();
  await page.locator('.timeline-cue').filter({hasText: 'Imported SRT'}).first().click();
  await page.screenshot({path: 'tmp/editor-text-check.png', fullPage: true});
  assert.deepEqual(errors, []);
  console.log('PASS: imported SRT, translated subtitles and manual text editable; typing preserves media time and timeline, including playback; new cue selection still seeks.');
} finally {
  await browser.close();
}
