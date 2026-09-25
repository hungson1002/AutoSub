/**
 * Injected into MAIN world on labs.google â€” has access to window.grecaptcha
 * Also intercepts TRPC fetch responses to capture fresh signed media URLs.
 */
(() => {
const BRIDGE_VERSION = '1.2.46';
if (window.__FLOW_AGENT_MAIN_INJECTED__ === BRIDGE_VERSION) return;
window.__FLOW_AGENT_MAIN_INJECTED__ = BRIDGE_VERSION;

const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';

function requestHost(value) {
  try { return new URL(value, location.href).hostname; } catch { return ''; }
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input?.url || '';
}

function isFlowApiUrl(value) {
  const host = requestHost(value);
  return host === 'flow.google.com' || host === 'aisandbox-pa.googleapis.com'
    || host === 'aisandbox-pa.sandbox.googleapis.com';
}

function relayAuthorization(value, requestUrl) {
  if (typeof value !== 'string' || !/^Bearer\s+/i.test(value)) return;
  if (!isFlowApiUrl(requestUrl)) return;
  window.postMessage({
    source: 'flow-agent-main',
    type: 'FLOW_AUTH_TOKEN',
    authorization: value,
    apiHost: requestHost(requestUrl).startsWith('aisandbox-pa.') ? 'aisandbox' : 'page',
  }, window.location.origin);
}

window.postMessage({
  source: 'flow-agent-main',
  type: 'FLOW_MAIN_READY',
}, window.location.origin);

// â”€â”€â”€ TRPC Response Monitor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Monkey-patch fetch to intercept TRPC responses containing media URLs.
// Fresh signed GCS URLs are extracted and forwarded to the agent.

if (!window.__FLOW_AGENT_NETWORK_INTERCEPTED__) {
  window.__FLOW_AGENT_NETWORK_INTERCEPTED__ = true;
  const _originalFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      const input = args[0];
      const init = args[1];
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      relayAuthorization(headers.get('authorization'), requestUrl(input));
    } catch {}
    const response = await _originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      // Only intercept TRPC calls on labs.google that return project/flow data
      if (url.includes('/fx/api/trpc/') && response.ok) {
        const clone = response.clone();
        clone.text().then(text => {
          if (text.includes('storage.googleapis.com/ai-sandbox-videofx/') || text.includes('flow-content.google/')) {
            window.dispatchEvent(new CustomEvent('TRPC_MEDIA_URLS', {
              detail: { url, body: text },
            }));
          }
        }).catch(() => {});
      }
    } catch {}
    return response;
  };

  // Some Flow bundles use XMLHttpRequest rather than window.fetch.
  const xhrUrls = new WeakMap();
  const _originalOpen = XMLHttpRequest.prototype.open;
  const _originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    xhrUrls.set(this, String(url || ''));
    return _originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (String(name).toLowerCase() === 'authorization') relayAuthorization(String(value), xhrUrls.get(this));
    return _originalSetRequestHeader.call(this, name, value);
  };
}


window.addEventListener('GET_CAPTCHA', async ({ detail }) => {
  const { requestId, pageAction } = detail;
  try {
    await ensureGrecaptcha();
    const token = await new Promise((resolve, reject) => {
      window.grecaptcha.enterprise.ready(() => {
        window.grecaptcha.enterprise.execute(SITE_KEY, { action: pageAction })
          .then(resolve)
          .catch(reject);
      });
    });
    window.dispatchEvent(new CustomEvent('CAPTCHA_RESULT', {
      detail: { requestId, token },
    }));
  } catch (e) {
    window.dispatchEvent(new CustomEvent('CAPTCHA_RESULT', {
      detail: { requestId, error: e.message },
    }));
  }
});

function waitForGrecaptcha(timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (window.grecaptcha?.enterprise?.execute) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('grecaptcha not available'));
      setTimeout(check, 200);
    };
    check();
  });
}

async function ensureGrecaptcha() {
  try {
    await waitForGrecaptcha(5000);
    return;
  } catch {
    // flow.google.com no longer guarantees that the reCAPTCHA bundle is
    // present before an API-only generation. Load Google's official bundle
    // explicitly and retry a clean script instead of reusing a failed tag.
    const bases = [
      'https://www.google.com/recaptcha/enterprise.js',
      'https://www.recaptcha.net/recaptcha/enterprise.js',
    ];
    let lastError = null;
    for (const base of bases) {
      try {
        await loadGrecaptchaScript(`${base}?render=${encodeURIComponent(SITE_KEY)}&trustedtypes=true`);
        await waitForGrecaptcha(15000);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('grecaptcha not available');
  }
}

function trustedScriptUrl(value) {
  if (!window.trustedTypes?.createPolicy) return value;
  if (!window.__FLOW_AGENT_RECAPTCHA_POLICY__) {
    window.__FLOW_AGENT_RECAPTCHA_POLICY__ = window.trustedTypes.createPolicy(
      'flow-agent-recaptcha',
      {
        createScriptURL: (url) => {
          const parsed = new URL(url);
          if (!['www.google.com', 'www.recaptcha.net'].includes(parsed.hostname)
              || parsed.pathname !== '/recaptcha/enterprise.js') {
            throw new TypeError('Blocked non-reCAPTCHA script URL');
          }
          return parsed.href;
        },
      },
    );
  }
  return window.__FLOW_AGENT_RECAPTCHA_POLICY__.createScriptURL(value);
}

function loadGrecaptchaScript(src, timeout = 15000) {
  document.querySelectorAll('script[data-flow-agent-recaptcha]').forEach((script) => script.remove());
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error(`reCAPTCHA script timed out: ${new URL(src).hostname}`));
    }, timeout);
    script.dataset.flowAgentRecaptcha = 'true';
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error(`reCAPTCHA script failed: ${new URL(src).hostname}`));
    };
    const nonceSource = [...document.querySelectorAll('script[nonce]')]
      .find((candidate) => candidate.nonce || candidate.getAttribute('nonce'));
    const nonce = nonceSource?.nonce || nonceSource?.getAttribute('nonce');
    if (nonce) script.nonce = nonce;
    script.src = trustedScriptUrl(src);
    (document.head || document.documentElement).appendChild(script);
  });
}

// â”€â”€â”€ Video Upload Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
window.addEventListener('UPLOAD_VIDEO', async ({ detail }) => {
  const { requestId, videoBase64, projectId } = detail;
  try {
    // Convert base64 to Blob
    const byteChars = atob(videoBase64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([byteArray], { type: 'video/mp4' });

    // Step 1: POST start â€” get session URL
    const startResp = await _originalFetch('/fx/api/upload-video?action=start', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Upload-Project-Id': projectId || '',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': blob.size.toString(),
      },
    });
    const sessionUrl = startResp.headers.get('X-Upload-Session-Url') || '';
    const startData = await startResp.json().catch(() => ({}));
    // sessionUrl may be in header OR in response body
    const finalSessionUrl = sessionUrl || startData.sessionUrl || '';
    startData._sessionUrl = finalSessionUrl;
    startData._status = startResp.status;

    if (!finalSessionUrl) {
      window.dispatchEvent(new CustomEvent('UPLOAD_VIDEO_RESULT', {
        detail: { requestId, error: 'NO_SESSION_URL', startData },
      }));
      return;
    }

    // Step 2: PUT directly to GCS session URL with resumable upload headers
    const uploadResp = await _originalFetch(finalSessionUrl, {
      method: 'PUT',
      body: blob,
      headers: {
        'Content-Type': 'video/mp4',
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
      },
    });
    const uploadData = await uploadResp.json().catch(() => ({}));
    uploadData._status = uploadResp.status;

    window.dispatchEvent(new CustomEvent('UPLOAD_VIDEO_RESULT', {
      detail: { requestId, startData, uploadData, status: uploadResp.status },
    }));
  } catch (e) {
    window.dispatchEvent(new CustomEvent('UPLOAD_VIDEO_RESULT', {
      detail: { requestId, error: e.message },
    }));
  }
});
})();
