(() => {
  const endpoint = 'http://127.0.0.1:8787/api/ai-video/flow-bridge/heartbeat';
  const visibleControls = () => Array.from(document.querySelectorAll('textarea,input,[contenteditable="true"],button'))
    .filter((element) => element.offsetWidth || element.offsetHeight)
    .slice(0, 120)
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      text: (element.textContent || '').trim().slice(0, 160),
      ariaLabel: element.getAttribute('aria-label') || '',
      placeholder: element.getAttribute('placeholder') || '',
    }));
  let activeCommand = '';
  const textOf = (element) => `${element.textContent || ''} ${element.getAttribute('aria-label') || ''}`.trim();
  const reportFailure = (id, error) => fetch(`http://127.0.0.1:8787/api/ai-video/flow-bridge/commands/${encodeURIComponent(id)}/fail`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
  }).catch(() => undefined);
  const findAlwaysApprove = () => Array.from(document.querySelectorAll('button,[role="button"]')).find((element) => {
    const text = textOf(element);
    return /phê duyệt,?\s*không hỏi lại|approve,?\s*(?:and )?don.?t ask again/i.test(text) && element.offsetParent;
  });
  const trustedClick = async (element) => {
    const rect = element.getBoundingClientRect();
    const result = await chrome.runtime.sendMessage({ type: 'AUTOSUB_FLOW_CLICK', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    if (!result?.ok) throw new Error(result?.error || 'Tiện ích không thể bấm nút phê duyệt trên Flow.');
  };
  const attachReferenceImages = async (filePaths) => {
    if (!Array.isArray(filePaths) || !filePaths.length) return;
    let inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    if (!inputs.length) {
      const add = Array.from(document.querySelectorAll('button,[role="button"]')).find((element) => /^(?:\+|thêm|add)$/i.test(textOf(element)) && element.offsetParent);
      if (add) await trustedClick(add);
      const deadline = Date.now() + 5_000;
      while (!inputs.length && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      }
    }
    const result = await chrome.runtime.sendMessage({ type: 'AUTOSUB_FLOW_SET_FILE', paths: filePaths.slice(0, 3) });
    if (!result?.ok) throw new Error(result?.error || 'Không thể gắn frame cuối của cảnh trước vào Flow.');
    await new Promise((resolve) => setTimeout(resolve, 1500));
  };
  const ensureProjectPage = async () => {
    if (!/\/edit\//.test(location.pathname)) return;
    const buttons = Array.from(document.querySelectorAll('button')).filter((button) => button.offsetParent);
    const done = buttons.find((button) => /(?:xong|done)\s*$/i.test(textOf(button)));
    if (!done) throw new Error('Flow đang ở màn hình chỉnh sửa nhưng không tìm thấy nút Xong.');
    await trustedClick(done);
    const deadline = Date.now() + 15_000;
    while (/\/edit\//.test(location.pathname) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 300));
    if (/\/edit\//.test(location.pathname)) throw new Error('Flow chưa quay lại project sau khi đóng màn hình xem video.');
    await new Promise((resolve) => setTimeout(resolve, 800));
  };
  const mediaIds = () => new Set(Array.from(document.querySelectorAll('img')).map((image) => {
    const match = /getMediaUrlRedirect\?name=([^&"']+)/.exec(image.src);
    return match ? decodeURIComponent(match[1]) : '';
  }).filter(Boolean));
  const libraryThumbnails = () => Array.from(document.querySelectorAll('img')).filter((image) => {
    const rect = image.getBoundingClientRect();
    return image.offsetParent && rect.width > 150 && rect.height > 150 && image.src;
  });
  const downloadFromThumbnail = async (thumbnail) => {
    const card = thumbnail.closest('[data-media-id],[role="listitem"],li,article,button') || thumbnail;
    const rect = card.getBoundingClientRect();
    const captured = await chrome.runtime.sendMessage({ type: 'AUTOSUB_FLOW_CAPTURE_VIDEO', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    let source = captured?.ok ? captured.url : '';
    if (!source) {
      const deadline = Date.now() + 15_000;
      while (!source && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const preview = Array.from(document.querySelectorAll('video')).find((video) => video.readyState >= 1 && (video.currentSrc || video.src));
        source = preview?.currentSrc || preview?.src || '';
      }
    }
    if (!source) throw new Error(captured?.error || 'Không tìm thấy nguồn video trong phần xem trước của Flow.');
    const response = await fetch(source, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Không tải được video từ thẻ kết quả (HTTP ${response.status}).`);
    const blob = await response.blob();
    if (blob.size < 10_000) throw new Error('Video tải từ Flow không hợp lệ.');
    return blob;
  };
  const downloadMedia = async (mediaId) => {
    const url = new URL('/fx/api/trpc/media.getMediaUrlRedirect', location.origin);
    url.searchParams.set('name', mediaId);
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Không tải được media Flow (HTTP ${response.status}).`);
    const blob = await response.blob();
    if (blob.size < 10_000) throw new Error('Media Flow trả về quá nhỏ hoặc phiên đăng nhập đã hết hạn.');
    return blob;
  };
  const execute = async (command) => {
    if (!command?.id || activeCommand) return;
    activeCommand = command.id;
    try {
      await ensureProjectPage();
      const before = new Set(Array.from(document.querySelectorAll('video')).map((video) => video.currentSrc || video.src).filter(Boolean));
      const beforeMedia = mediaIds();
      const beforeThumbnails = new Set(libraryThumbnails().map((image) => image.src));
      if (command.recoverLatest) {
        const latestThumbnail = libraryThumbnails()[0];
        if (latestThumbnail) {
          const recovered = await downloadFromThumbnail(latestThumbnail);
          await ensureProjectPage();
          const upload = await fetch(`http://127.0.0.1:8787/api/ai-video/flow-bridge/commands/${encodeURIComponent(command.id)}/video`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: recovered });
          if (!upload.ok) throw new Error(`AutoSub không nhận được video đã khôi phục (HTTP ${upload.status}).`);
          return;
        }
        const latestVideoId = Array.from(beforeMedia).find((id) => /video/i.test(id));
        if (!latestVideoId) throw new Error('Không tìm thấy video đã tạo trong thư viện Flow để khôi phục.');
        let recovered;
        try {
          recovered = await downloadMedia(latestVideoId);
        } catch {
          const thumbnail = Array.from(document.querySelectorAll('img')).find((image) => image.src.includes(latestVideoId) || image.src.includes(encodeURIComponent(latestVideoId)));
          const card = thumbnail?.closest('[data-media-id],[role="listitem"],li,article') || thumbnail;
          if (!card) throw new Error('Không mở được video đã tạo trong thư viện Flow.');
          await trustedClick(card);
          const previewDeadline = Date.now() + 30_000;
          let preview;
          while (!preview && Date.now() < previewDeadline) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            preview = Array.from(document.querySelectorAll('video')).find((video) => video.readyState >= 2 && (video.currentSrc || video.src));
          }
          const previewUrl = preview?.currentSrc || preview?.src || '';
          if (!previewUrl) throw new Error('Flow không mở được nguồn video để khôi phục.');
          const response = await fetch(previewUrl, { signal: AbortSignal.timeout(60_000) });
          if (!response.ok) throw new Error(`Không tải được video khôi phục (HTTP ${response.status}).`);
          recovered = await response.blob();
        }
        await ensureProjectPage();
        const upload = await fetch(`http://127.0.0.1:8787/api/ai-video/flow-bridge/commands/${encodeURIComponent(command.id)}/video`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: recovered });
        if (!upload.ok) throw new Error(`AutoSub không nhận được video đã khôi phục (HTTP ${upload.status}).`);
        return;
      }
      await attachReferenceImages(command.referenceImagePaths);
      let approval = findAlwaysApprove();
      if (!approval) {
        const editors = Array.from(document.querySelectorAll('div[contenteditable="true"]')).filter((element) => element.offsetParent);
        const editor = editors[editors.length - 1];
        if (!editor) throw new Error('Không tìm thấy ô “Bạn muốn tạo gì?” trên Flow.');
        editor.focus();
        editor.click();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const result = await chrome.runtime.sendMessage({ type: 'AUTOSUB_FLOW_TYPE_AND_SUBMIT', text: command.prompt });
        if (!result?.ok) throw new Error(result?.error || 'Tiện ích không thể gõ prompt vào Flow.');
        const approvalDeadline = Date.now() + 30_000;
        while (!approval && Date.now() < approvalDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          approval = findAlwaysApprove();
        }
      }
      if (approval) await trustedClick(approval);
      const deadline = Date.now() + 18 * 60_000;
      let source = '';
      let freshMediaId = '';
      let freshThumbnail;
      while (Date.now() < deadline && !source && !freshMediaId && !freshThumbnail) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        freshThumbnail = libraryThumbnails().find((image) => !beforeThumbnails.has(image.src));
        freshMediaId = Array.from(mediaIds()).find((id) => !beforeMedia.has(id) && /video/i.test(id)) || '';
        const videos = Array.from(document.querySelectorAll('video'));
        const ready = videos.find((video) => video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 1 && !before.has(video.currentSrc || video.src));
        source = ready?.currentSrc || ready?.src || '';
      }
      if (!source && !freshMediaId && !freshThumbnail) throw new Error('Flow đã tính credit nhưng chưa có media mới trong thư viện. Không bấm tiếp tục để tránh tạo trùng.');
      let blob;
      if (freshThumbnail) blob = await downloadFromThumbnail(freshThumbnail);
      else if (freshMediaId) blob = await downloadMedia(freshMediaId);
      else {
        const videoResponse = await fetch(source);
        if (!videoResponse.ok) throw new Error(`Không tải được video Flow (HTTP ${videoResponse.status}).`);
        blob = await videoResponse.blob();
      }
      await ensureProjectPage();
      const upload = await fetch(`http://127.0.0.1:8787/api/ai-video/flow-bridge/commands/${encodeURIComponent(command.id)}/video`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
      if (!upload.ok) throw new Error(`AutoSub không nhận được video Flow (HTTP ${upload.status}).`);
    } catch (error) {
      await reportFailure(command.id, error);
    } finally {
      activeCommand = '';
    }
  };
  const heartbeat = () => fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: location.href, title: document.title, controls: visibleControls() }),
  }).then((response) => response.json()).then((value) => execute(value.command)).catch(() => undefined);
  heartbeat();
  setInterval(heartbeat, 2000);
})();
