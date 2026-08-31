const send = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['AUTOSUB_FLOW_TYPE_AND_SUBMIT', 'AUTOSUB_FLOW_CLICK', 'AUTOSUB_FLOW_CAPTURE_VIDEO', 'AUTOSUB_FLOW_SET_FILE'].includes(message?.type) || !sender.tab?.id) return;
  const tabId = sender.tab.id;
  (async () => {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      if (message.type === 'AUTOSUB_FLOW_SET_FILE') {
        const document = await send(tabId, 'DOM.getDocument', { depth: -1, pierce: true });
        const matches = await send(tabId, 'DOM.querySelectorAll', { nodeId: document.root.nodeId, selector: 'input[type="file"]' });
        const nodeId = matches.nodeIds?.at(-1);
        if (!nodeId) throw new Error('Flow không hiển thị ô chọn ảnh tham chiếu.');
        const files = Array.isArray(message.paths) ? message.paths.map(String).filter(Boolean).slice(0, 3) : [];
        if (!files.length) throw new Error('Không nhận được đường dẫn ảnh tham chiếu.');
        await send(tabId, 'DOM.setFileInputFiles', { nodeId, files });
        respond({ ok: true });
        return;
      }
      if (message.type === 'AUTOSUB_FLOW_CAPTURE_VIDEO') {
        await send(tabId, 'Network.enable');
        const videoUrl = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            chrome.debugger.onEvent.removeListener(onEvent);
            reject(new Error('Không thấy request video từ Flow sau khi mở thẻ kết quả.'));
          }, 30_000);
          const onEvent = (source, method, params) => {
            if (source.tabId !== tabId || method !== 'Network.responseReceived') return;
            const response = params?.response || {};
            if (!/^video\//i.test(response.mimeType || '') && !/\.mp4(?:\?|$)/i.test(response.url || '')) return;
            clearTimeout(timer);
            chrome.debugger.onEvent.removeListener(onEvent);
            resolve(response.url);
          };
          chrome.debugger.onEvent.addListener(onEvent);
          send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: Number(message.x), y: Number(message.y) })
            .then(() => send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: Number(message.x), y: Number(message.y), button: 'left', clickCount: 1 }))
            .then(() => send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: Number(message.x), y: Number(message.y), button: 'left', clickCount: 1 }))
            .catch(reject);
        });
        respond({ ok: true, url: videoUrl });
        return;
      }
      if (message.type === 'AUTOSUB_FLOW_CLICK') {
        await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: Number(message.x), y: Number(message.y) });
        await send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: Number(message.x), y: Number(message.y), button: 'left', clickCount: 1 });
        await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: Number(message.x), y: Number(message.y), button: 'left', clickCount: 1 });
        respond({ ok: true });
        return;
      }
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      for (const character of String(message.text || '')) {
        await send(tabId, 'Input.insertText', { text: character });
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      respond({ ok: true });
    } catch (error) {
      respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      chrome.debugger.detach({ tabId }).catch(() => undefined);
    }
  })();
  return true;
});
