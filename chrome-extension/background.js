importScripts("config.js");

// ── Startup: auto-clear bad captures (e.g. Cloudflare /cdn-cgi/ beacons) ───
chrome.storage.local.get(["z2uUploadEndpoint"], (d) => {
  const saved = d.z2uUploadEndpoint;
  if (saved?.url && /cdn-cgi|beacon|analytics|rum|ping|track/i.test(saved.url)) {
    console.log("[Z2U] Auto-clearing bad captured endpoint:", saved.url);
    chrome.storage.local.remove("z2uUploadEndpoint");
  } else if (saved?.url) {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  }
});

// ── Fetch mappings from all configured backends on startup ────────────────────
const backendMappings = new Map(); // backendUrl → { name, mappings }

async function fetchAllMappings() {
  console.log("[Z2U] Fetching mappings from all backends...");
  for (const backend of CONFIG.BACKENDS) {
    try {
      const res = await fetch(`${backend.url}/api/admin/mappings`);
      if (res.ok) {
        const mappings = await res.json();
        backendMappings.set(backend.url, { name: backend.name, mappings });
        console.log(`[Z2U] ✅ ${backend.name}: ${Object.keys(mappings).length} mappings loaded`);
      } else {
        console.warn(`[Z2U] ⚠ ${backend.name}: HTTP ${res.status}`);
      }
    } catch (e) {
      console.warn(`[Z2U] ⚠ ${backend.name}: unreachable — ${e.message}`);
    }
  }
}

function findBackendForTitle(title) {
  // Exact match first
  for (const [url, data] of backendMappings) {
    if (data.mappings && Object.prototype.hasOwnProperty.call(data.mappings, title)) {
      return { url, name: data.name };
    }
  }
  // Fuzzy match (trim + collapse spaces)
  const norm = title.replace(/\s+/g, " ").trim();
  for (const [url, data] of backendMappings) {
    if (data.mappings) {
      const keys = Object.keys(data.mappings);
      const match = keys.find((k) => k.replace(/\s+/g, " ").trim() === norm);
      if (match) return { url, name: data.name };
    }
  }
  return null;
}

// Fetch mappings on startup (and periodically to keep them fresh)
fetchAllMappings();
setInterval(fetchAllMappings, 5 * 60 * 1000); // refresh every 5 min

// ── Debugger-based upload URL capture ────────────────────────────────────────
let captureTabIds = new Set();
let captureTabId  = null;
let captureActive = false;

chrome.storage.session.get(["captureTabIds", "captureActive"], async (d) => {
  if (d.captureActive && d.captureTabIds?.length) {
    captureActive = true;
    for (const tid of d.captureTabIds) captureTabIds.add(tid);
    captureTabId = [...captureTabIds][0];
    console.log("[Z2U-debugger] Restored capture on tabs:", [...captureTabIds]);
  }
});

const pendingRequests = new Map();

chrome.debugger.onEvent.addListener(function onDebugEvent(source, method, params) {
  if (captureActive && captureTabIds.has(source.tabId)) {
    handleDebugEvent(source, method, params);
    return;
  }
  if (!captureActive) {
    chrome.storage.session.get(["captureTabIds", "captureActive"], (d) => {
      if (d.captureActive && d.captureTabIds?.length) {
        captureActive = true;
        for (const tid of d.captureTabIds) captureTabIds.add(tid);
        captureTabId = [...captureTabIds][0];
        if (captureTabIds.has(source.tabId)) {
          handleDebugEvent(source, method, params);
        }
      }
    });
  }
});

function handleDebugEvent(source, method, params) {
  const tabId = source.tabId;

  if (method === "Network.requestWillBeSent") {
    const req = params.request;
    if (["GET", "HEAD", "OPTIONS", "CONNECT", "TRACE"].includes(req.method)) return;

    const ct = (req.headers || {})["content-type"] || (req.headers || {})["Content-Type"] || "(no-ct)";
    console.log(`[Z2U-debugger] ${req.method}:`, req.url, "| CT:", ct, "| hasPostData:", req.hasPostData);

    pendingRequests.set(params.requestId, { url: req.url, tabId, hasPostData: req.hasPostData });
    checkAndSave(params.requestId, req.url, req.headers || {}, tabId, req.hasPostData);
    return;
  }

  if (method === "Network.requestWillBeSentExtraInfo") {
    const pending = pendingRequests.get(params.requestId);
    if (!pending) return;
    const hdrs = params.headers || {};
    if (hdrs["content-type"]) {
      checkAndSave(params.requestId, pending.url, hdrs, pending.tabId);
    }
    return;
  }

  if (method === "Network.responseReceived" || method === "Network.loadingFailed") {
    pendingRequests.delete(params.requestId);
    return;
  }

  if (method === "Fetch.requestPaused") {
    const req = params.request;
    chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
      requestId: params.requestId,
    }).catch(() => {});

    if (!captureActive) return;
    if (["GET", "HEAD", "OPTIONS", "CONNECT", "TRACE"].includes(req.method)) return;

    const ct = (req.headers || {})["content-type"] || (req.headers || {})["Content-Type"] || "(no-ct)";
    console.log(`[Z2U-fetch] ${req.method}:`, req.url, "| CT:", ct, "| postData:", !!params.postData);

    if (params.postData) {
      const boundary = ct.match(/boundary=([^;,\s]+)/i);
      if (boundary) {
        saveEndpoint(req.url, parseMultipartFields(params.postData, ct));
        stopCaptureMode(4000);
        return;
      }
    }
    if (params.networkId) {
      checkAndSave(params.networkId, req.url, req.headers || {}, tabId, true);
    } else {
      checkAndSave(params.requestId, req.url, req.headers || {}, tabId, true);
    }
  }
}

chrome.debugger.onDetach.addListener((source) => {
  if (!captureTabIds.has(source.tabId)) return;
  captureTabIds.delete(source.tabId);
  console.log("[Z2U-debugger] Tab", source.tabId, "detached. Remaining:", [...captureTabIds]);
  if (captureTabIds.size === 0) {
    captureActive = false;
    captureTabId  = null;
    chrome.storage.session.remove(["captureTabIds", "captureActive"]);
    chrome.alarms.clear("capture_keepalive");
    chrome.runtime.sendMessage({ type: "CAPTURE_STOPPED" }).catch(() => {});
  }
});

const UPLOAD_CT = [
  "multipart/form-data",
  "application/vnd.openxmlformats",
  "application/octet-stream",
];

function isUploadRequest(ct, hasPostData) {
  if (!ct && !hasPostData) return false;
  return UPLOAD_CT.some((t) => ct.toLowerCase().includes(t));
}

function checkAndSave(requestId, url, headers, tabId, hasPostData = false) {
  const ct = headers["content-type"] || headers["Content-Type"] || "";

  if (/clarity|analytics|beacon|rum|gtag|facebook|sentry|datadog|hotjar|logrocket|google\.|googleadservices|doubleclick|googlesyndication|googletagmanager|bing\.com|yahoo|twitter\.com|tiktok|snapchat/i.test(url)) return;

  const uploadUrl = /upload|deliver|\.xlsx|attach|file[_-]?upload|importFile/i.test(url);
  if (!isUploadRequest(ct, hasPostData) && !uploadUrl) return;

  console.log("[Z2U-debugger] ✅ Upload candidate:", url, "| CT:", ct);
  pendingRequests.delete(requestId);
  stopCaptureMode(4000);

  chrome.debugger.sendCommand({ tabId }, "Network.getRequestPostData", { requestId })
    .then((r) => {
      const parsed = parseMultipartFields(r?.postData || "", ct);
      saveEndpoint(url, parsed);
    })
    .catch(() => saveEndpoint(url, null));
}

function parseMultipartFields(postData, contentType) {
  const fields = [];
  const bm = contentType.match(/boundary=([^;,\s]+)/i);
  if (!bm) return null;
  for (const part of postData.split("--" + bm[1].trim())) {
    const m = part.match(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/i);
    if (!m) continue;
    if (m[2]) fields.push({ key: m[1], type: "file" });
    else {
      const v = part.split(/\r?\n\r?\n/);
      fields.push({ key: m[1], type: "string", value: v.length > 1 ? v[1].trim() : "" });
    }
  }
  return fields.length ? fields : null;
}

function saveEndpoint(url, fields) {
  const endpoint = { url, method: "POST", fields: fields || null, probeFields: !fields };
  chrome.storage.local.set({ z2uUploadEndpoint: endpoint }, () => {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
    console.log("[Z2U-debugger] Endpoint saved:", url, fields);
    chrome.runtime.sendMessage({ type: "CAPTURE_COMPLETE", url }).catch(() => {});
  });
}

async function startCaptureMode() {
  const tabs = await chrome.tabs.query({ url: ["https://z2u.com/*", "https://www.z2u.com/*"] });
  if (!tabs.length) return { ok: false, error: "No Z2U tab open. Open z2u.com first." };

  captureTabIds.clear();
  const attached = [];

  for (const tab of tabs) {
    try {
      await chrome.debugger.attach({ tabId: tab.id }, "1.3");
    } catch (e) {
      if (!e.message.includes("already attached")) {
        console.warn("[Z2U-debugger] Could not attach to tab", tab.id, ":", e.message);
        continue;
      }
    }
    try {
      await chrome.debugger.sendCommand({ tabId: tab.id }, "Network.enable");
      await chrome.debugger.sendCommand({ tabId: tab.id }, "Fetch.enable", {
        patterns: [{ requestStage: "Request" }],
      });
      captureTabIds.add(tab.id);
      attached.push(tab.id);
      console.log("[Z2U-debugger] Attached to tab", tab.id, tab.url);
    } catch (e) {
      console.warn("[Z2U-debugger] Enable failed on tab", tab.id, ":", e.message);
      chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    }
  }

  if (captureTabIds.size === 0) return { ok: false, error: "Could not attach to any Z2U tab." };

  captureActive = true;
  captureTabId  = attached[0];
  await chrome.storage.session.set({ captureTabIds: attached, captureActive: true });

  chrome.alarms.create("capture_keepalive", { periodInMinutes: 20 / 60 });

  console.log("[Z2U-debugger] Capture started on", attached.length, "tab(s):", attached);
  return { ok: true, tabCount: attached.length };
}

function stopCaptureMode(delayDetachMs = 0) {
  if (!captureActive) return;
  captureActive = false;
  captureTabId  = null;
  chrome.storage.session.remove(["captureTabIds", "captureActive"]);
  chrome.alarms.clear("capture_keepalive");
  chrome.runtime.sendMessage({ type: "CAPTURE_STOPPED" }).catch(() => {});
  console.log("[Z2U-debugger] Capture watching stopped. Detach in", delayDetachMs, "ms.");

  const tids = [...captureTabIds];
  const doDetach = () => {
    captureTabIds.clear();
    for (const tid of tids) chrome.debugger.detach({ tabId: tid }).catch(() => {});
    console.log("[Z2U-debugger] Detached tabs:", tids);
  };
  if (delayDetachMs > 0) {
    setTimeout(doDetach, delayDetachMs);
  } else {
    doDetach();
  }
}

function scheduleNextRefresh() {
  const seconds = Math.floor(Math.random() * (CONFIG.MAX_REFRESH_SECONDS - CONFIG.MIN_REFRESH_SECONDS + 1)) + CONFIG.MIN_REFRESH_SECONDS;
  chrome.alarms.create("refresh_orders", { delayInMinutes: seconds / 60 });
  console.log(`[Z2U] Next refresh in ${seconds}s`);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Z2U] Extension installed. Fetching mappings and scheduling refresh.");
  fetchAllMappings();
  scheduleNextRefresh();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "capture_keepalive") {
    console.log("[Z2U-debugger] Keep-alive ping — SW still active, captureActive=", captureActive);
    return;
  }

  if (alarm.name !== "refresh_orders") return;

  chrome.tabs.query({}, (allTabs) => {
    const z2uTab = allTabs.find(
      (t) => t.url && t.url.includes("z2u.com/sellOrder/index")
    );

    if (z2uTab) {
      chrome.tabs.reload(z2uTab.id, () => {
        console.log(`[Z2U] Refreshed tab ${z2uTab.id}: ${z2uTab.url}`);
      });
    } else {
      console.log("[Z2U] No Z2U sell order tab found. Skipping refresh until next cycle.");
    }

    scheduleNextRefresh();
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_BACKEND_CONFIG") {
    sendResponse({ backends: CONFIG.BACKENDS });
    return true;
  }

  if (message.type === "ENDPOINT_CAPTURED") {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "RESET_ENDPOINT") {
    chrome.action.setBadgeText({ text: "" });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "START_CAPTURE") {
    startCaptureMode()
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.type === "STOP_CAPTURE") {
    stopCaptureMode();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "INJECT_INTERCEPTOR") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "No tab ID in sender" });
      return true;
    }
    chrome.scripting.executeScript({
      target: { tabId },
      files:  ["injected.js"],
      world:  "MAIN",
    }).then(() => {
      console.log(`[Z2U] Interceptor injected into tab ${tabId}`);
      sendResponse({ ok: true });
    }).catch((e) => {
      console.warn(`[Z2U] Interceptor injection failed on tab ${tabId}:`, e.message);
      sendResponse({ ok: false, error: e.message });
    });
    return true;
  }

  if (message.type === "PROCESS_ORDER") {
    handleOrderProcessing(message.data)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "PREPARE_ORDER") {
    handleOrderPreparation(message.data)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_MAPPINGS") {
    const all = {};
    for (const [url, data] of backendMappings) {
      if (data.mappings) Object.assign(all, data.mappings);
    }
    sendResponse({ ok: true, mappings: all });
    return true;
  }

  if (message.type === "IS_PROCESSED") {
    const { orderId } = message;
    chrome.storage.local.get("processed", ({ processed }) => {
      const set = new Set(processed || []);
      sendResponse({ processed: set.has(orderId) });
    });
    return true;
  }

  if (message.type === "RECORD_ANALYTICS") {
    const { orderId, title, quantity, amount } = message;
    (async () => {
      try {
        const backend = findBackendForTitle(title);
        if (backend) {
          await fetch(`${backend.url}/api/admin/analytics/record`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId, title, quantity, amount }),
          });
          console.log(`[analytics] recorded on ${backend.name} — orderId=${orderId} amount=${amount}`);
        }
      } catch (e) {
        console.log("[analytics] record failed:", e.message);
      }
    })();
    return false;
  }

  if (message.type === "MARK_PROCESSED") {
    const { orderId } = message;
    chrome.storage.local.get("processed", ({ processed }) => {
      const set = new Set(processed || []);
      set.add(orderId);
      chrome.storage.local.set({ processed: Array.from(set) }, () => {
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  if (message.type === "IS_PREPARED_ONLY") {
    const { orderId } = message;
    chrome.storage.local.get("preparedOnly", ({ preparedOnly }) => {
      const set = new Set(preparedOnly || []);
      sendResponse({ prepared: set.has(orderId) });
    });
    return true;
  }

  if (message.type === "MARK_PREPARED_ONLY") {
    const { orderId } = message;
    chrome.storage.local.get("preparedOnly", ({ preparedOnly }) => {
      const set = new Set(preparedOnly || []);
      set.add(orderId);
      chrome.storage.local.set({ preparedOnly: Array.from(set).slice(-500) }, () => {
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  if (message.type === "GET_Z2U_COOKIES") {
    Promise.all([
      chrome.cookies.getAll({ domain: "z2u.com" }),
      chrome.cookies.getAll({ domain: "www.z2u.com" }),
    ]).then(([a, b]) => {
      const seen = new Set();
      const all = [...a, ...b].filter((c) => {
        const key = `${c.name}=${c.domain}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      sendResponse({ ok: true, cookies: all });
    }).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.type === "CDP_DOWNLOAD_FILE") {
    const { fileBytes, filename } = message;
    cdpDownloadFileToDisk(fileBytes, filename)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.type === "CDP_SET_FILE_BY_PATH") {
    const { filePath } = message;
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: "No tab ID" }); return true; }
    cdpSetFileByPath(tabId, filePath)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (message.type === "BRIDGE_UPLOAD") {
    const { fileBytes, orderId, pageUrl, filename } = message;
    fetch("http://localhost:5000/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileBytes, orderId, pageUrl, filename }),
    })
      .then((res) => res.json())
      .then((json) => sendResponse({ ok: true, result: json }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

// ── CDP helpers ────────────────────────────────────────────────────────────────

async function cdpDownloadFileToDisk(fileBytes, filename) {
  const bytes = new Uint8Array(fileBytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  const dataUrl = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
  const dlFilename = filename || "Z2U_delivery_temp.xlsx";

  const filePath = await new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: dataUrl, filename: dlFilename, conflictAction: "overwrite", saveAs: false },
      (downloadId) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        const timeout = setTimeout(() => {
          chrome.downloads.onChanged.removeListener(onChange);
          reject(new Error("Download timed out after 15s"));
        }, 15000);
        function onChange(delta) {
          if (delta.id !== downloadId) return;
          if (delta.state?.current === "complete") {
            chrome.downloads.onChanged.removeListener(onChange);
            clearTimeout(timeout);
            chrome.downloads.search({ id: downloadId }, (results) => {
              const p = results?.[0]?.filename;
              p ? resolve(p) : reject(new Error("Downloaded path not found"));
            });
          } else if (delta.state?.current === "interrupted") {
            chrome.downloads.onChanged.removeListener(onChange);
            clearTimeout(timeout);
            reject(new Error(`Download interrupted: ${delta.error?.current || "unknown"}`));
          }
        }
        chrome.downloads.onChanged.addListener(onChange);
      }
    );
  });

  console.log("[Z2U-CDP] ✅ File saved to disk:", filePath);
  return { ok: true, filePath };
}

async function cdpSetFileByPath(tabId, filePath) {
  const alreadyAttached = captureTabIds.has(tabId);
  if (!alreadyAttached) {
    await chrome.debugger.attach({ tabId }, "1.3");
    console.log("[Z2U-CDP] Debugger attached to tab", tabId);
  }
  try {
    const doc = await chrome.debugger.sendCommand({ tabId }, "DOM.getDocument", { depth: 1 });
    const selectors = [
      ".ant-modal input[type='file']",
      "[role='dialog'] input[type='file']",
      "[class*='modal'] input[type='file']",
      "[class*='dialog'] input[type='file']",
      "input[type='file']",
    ];
    let inputNodeId = 0;
    for (const sel of selectors) {
      const r = await chrome.debugger.sendCommand({ tabId }, "DOM.querySelector", {
        nodeId: doc.root.nodeId, selector: sel,
      });
      if (r?.nodeId) {
        inputNodeId = r.nodeId;
        console.log("[Z2U-CDP] File input found:", sel, "nodeId:", inputNodeId);
        break;
      }
    }
    if (!inputNodeId) throw new Error("File input not found via CDP DOM query");
    await chrome.debugger.sendCommand({ tabId }, "DOM.setFileInputFiles", {
      nodeId: inputNodeId,
      files: [filePath],
    });
    console.log("[Z2U-CDP] ✅ DOM.setFileInputFiles complete.");
    return { ok: true };
  } finally {
    if (!alreadyAttached) {
      chrome.debugger.detach({ tabId }).catch(() => {});
      console.log("[Z2U-CDP] Debugger detached.");
    }
  }
}

// ── Order processing (routes to correct backend automatically) ──────────────

async function handleOrderProcessing(orderData) {
  const { orderId, title, quantity, templateBlob, templateFilename } = orderData;

  const { processed } = await chrome.storage.local.get("processed");
  const processedSet = new Set(processed || []);

  if (processedSet.has(orderId)) {
    console.log(`[Z2U] Order ${orderId} already processed, skipping.`);
    return { skipped: true };
  }

  const backend = findBackendForTitle(title);
  if (!backend) {
    throw new Error(`No mapping found for title: "${title}"`);
  }

  console.log(`[Z2U] Title "${title}" → routing to ${backend.name} (${backend.url})`);

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(templateBlob)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    templateFilename || "template.xlsx"
  );
  formData.append("title", title);
  formData.append("quantity", String(quantity));
  formData.append("orderId", orderId);

  const res = await fetch(`${backend.url}/api/process-order`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend error: ${res.status} — ${text}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return { filledFile: Array.from(new Uint8Array(arrayBuffer)) };
}

async function handleOrderPreparation(orderData) {
  const { orderId, title, quantity } = orderData;
  console.log(`[Z2U] Preparing order payload for ${orderId} (${title}) qty=${quantity}`);

  const backend = findBackendForTitle(title);
  if (!backend) {
    throw new Error(`No mapping found for title: "${title}"`);
  }

  const res = await fetch(`${backend.url}/api/prepare-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, title, quantity }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Prepare-order failed: ${res.status} — ${text}`);
  }
  return await res.json();
}