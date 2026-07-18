(() => {
  "use strict";

  const href = window.location.href;
  const isListPage   = /sellOrder\/index/.test(href);
  const isDetailPage = !isListPage && /sellOrder(\?|$)/.test(href);

  // ── Listen for upload requests captured by injected.js ──────────────────────
  window.addEventListener("message", (e) => {
    if (e.data?.source !== "__z2u_injected__") return;
    if (e.data.type === "UPLOAD_REQUEST_CAPTURED") {
      const captured = { url: e.data.url, method: e.data.method, fields: e.data.fields };
      console.log("[Z2U][CAPTURE] Upload endpoint learned:", captured.method, captured.url, captured.fields);
      chrome.storage.local.set({ z2uUploadEndpoint: captured }, () => {
        chrome.runtime.sendMessage({ type: "ENDPOINT_CAPTURED" });
      });
    }
  });

  // ── Logging helpers ──────────────────────────────────────────────────────

  function log(step, msg, ...extra) {
    const ts = new Date().toISOString().slice(11, 23);
    if (extra.length) {
      console.log(`[Z2U][${ts}] ${step} ${msg}`, ...extra);
    } else {
      console.log(`[Z2U][${ts}] ${step} ${msg}`);
    }
  }
  function warn(step, msg, ...extra) {
    console.warn(`[Z2U] ${step} ⚠️  ${msg}`, ...extra);
  }
  function err(step, msg, ...extra) {
    console.error(`[Z2U] ${step} ❌ ${msg}`, ...extra);
  }

  // ── Analytics helpers ──────────────────────────────────────────────────

  function extractOrderAmount() {
    const allEls = Array.from(document.querySelectorAll("*"));
    for (const el of allEls) {
      if (el.childElementCount > 0) continue;
      const t = (el.textContent || "").trim();
      if (/^(price|total|order\s*(total|price|value)|sale\s*price|amount)$/i.test(t)) {
        const candidates = [
          el.nextElementSibling,
          el.parentElement?.nextElementSibling,
          el.parentElement?.nextElementSibling?.querySelector("span,div,p"),
        ];
        for (const c of candidates) {
          if (!c) continue;
          const m = (c.textContent || "").trim().match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
          if (m) {
            const v = parseFloat(m[1]);
            if (v > 0 && v < 100000) return v;
          }
        }
      }
    }
    const matches = (document.body.innerText || "").match(/\$\s*(\d+(?:\.\d{1,2})?)/g);
    if (matches) {
      const amounts = matches
        .map((m) => parseFloat(m.replace("$", "").trim()))
        .filter((v) => v > 0.5 && v < 100000);
      if (amounts.length) return Math.max(...amounts);
    }
    return null;
  }

  function recordAnalytics(orderId, title, quantity) {
    try {
      const amount = extractOrderAmount();
      chrome.runtime.sendMessage({
        type: "RECORD_ANALYTICS",
        orderId, title, quantity, amount,
      }).catch(() => {});
    } catch (_) {}
  }

  function dumpButtons(label) {
    const btns = Array.from(document.querySelectorAll("button, a[class*='btn'], a[class*='button']"))
      .map((b) => `"${b.textContent?.trim()}"`)
      .filter((t) => t !== '""')
      .join(", ");
    log(label, `Buttons on page → [${btns}]`);
  }

  // ── Shared utilities ─────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitForElementByText(selectors, text, timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      for (const sel of selectors.split(",")) {
        const els = document.querySelectorAll(sel.trim());
        const found = Array.from(els).find(
          (el) => el.textContent?.trim().toUpperCase().includes(text.toUpperCase())
        );
        if (found) return found;
      }
      await sleep(400);
    }
    return null;
  }

  async function waitForSelector(selector, timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(400);
    }
    return null;
  }

  function clickBtn(el, label) {
    if (!el) { err("CLICK", `Not found: ${label}`); return false; }
    el.click();
    log("CLICK", `✅ Clicked: ${label}`);
    return true;
  }

  // ── Persistent processed set ─────────────────────────────────────────

  const sessionDone = new Set();

  function bgIsProcessed(orderId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "IS_PROCESSED", orderId }, (r) =>
        resolve(r?.processed === true)
      );
    });
  }

  function bgMarkProcessed(orderId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "MARK_PROCESSED", orderId }, resolve);
    });
  }

  // ── Template download ────────────────────────────────────────────────

  async function downloadBlob(url) {
    log("DL", `Downloading template from: ${url}`);
    const res = await fetch(url, { credentials: "include" });
    log("DL", `Download response: HTTP ${res.status}`);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const cd = res.headers.get("content-disposition") || "";
    const cdMatch = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
    const filename = (cdMatch?.[1] || url.split("/").pop() || "template.xlsx")
      .replace(/[^\w\-. ]/g, "_")
      .replace(/^_+|_+$/g, "")
      || "template.xlsx";
    log("DL", `Downloaded ${bytes.byteLength} bytes → filename: "${filename}"`);
    return { bytes, filename };
  }

  // ── Backend call ─────────────────────────────────────────────────────

  async function sendToBackend({ orderId, title, quantity, templateBlob, templateFilename }) {
    log("BACKEND", `Sending to backend → orderId=${orderId} title="${title.slice(0, 40)}..." qty=${quantity} blobSize=${templateBlob.length} filename="${templateFilename}"`);
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "PROCESS_ORDER", data: { orderId, title, quantity, templateBlob, templateFilename } }, (r) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        log("BACKEND", `Backend response received: ok=${r?.ok} filledSize=${r?.result?.filledFile?.length ?? 0}`);
        resolve(r);
      });
    });
    if (!result?.ok) throw new Error(result?.error || "Unknown backend error");
    return new Uint8Array(result.result.filledFile);
  }

  // ── Upload filled file ─────────────────────────────────────────────

  function findXlsxInput() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    log("UPLOAD", `[B] All file inputs: ${inputs.map(i => `id="${i.id}" name="${i.name}" accept="${i.accept}"`).join(" | ")}`);
    const byId   = inputs.find((i) => i.id === "upfile" || i.name === "upload");
    if (byId) return byId;
    const byAccept = inputs.find((i) => /xlsx|spreadsheet|csv|xls/i.test(i.accept || ""));
    if (byAccept) return byAccept;
    const nonFilePond = inputs.find((i) => !/filepond|order_before|order_after/i.test(i.id + i.name));
    if (nonFilePond) return nonFilePond;
    return null;
  }

  // ── Confirm Delivered flow ────────────────────────────────────────

  async function confirmDeliveredFlow(quantity) {
    function hasViewDeliveryBtn() {
      return Array.from(document.querySelectorAll("button, a"))
        .some((b) => /view\s+delivery\s+account/i.test(b.textContent || ""));
    }

    log("UPLOAD", "[D1] Waiting up to 30s for 'View Delivery Account Information'…");
    const viewEnd = Date.now() + 30_000;
    while (Date.now() < viewEnd) {
      if (hasViewDeliveryBtn()) break;
      await sleep(800);
    }

    if (!hasViewDeliveryBtn()) {
      warn("UPLOAD", "[D1] ❌ 'View Delivery Account Information' never appeared — XLSX not accepted by Z2U.");
      dumpButtons("UPLOAD-NO-VIEW-DELIVERY");
      return false;
    }
    log("UPLOAD", "[D1] ✅ 'View Delivery Account Information' present — upload accepted.");

    dumpButtons("UPLOAD-BEFORE-CONFIRM");

    log("UPLOAD", "[D2] Looking for 'Confirm Delivered' button…");
    const confirmBtn =
      await waitForElementByText("button", "confirm delivered", 8000) ||
      await waitForElementByText("button", "delivered", 5000);

    if (!confirmBtn) {
      warn("UPLOAD", "[D2] 'Confirm Delivered' button not found.");
      dumpButtons("UPLOAD-FAILED");
      return false;
    }
    log("UPLOAD", `[D2] Found: "${confirmBtn.textContent?.trim()}"`);

    function fillInput(el, val) {
      const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (nativeSet) nativeSet.call(el, String(val)); else el.value = String(val);
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const inlineInput = await (async () => {
      const end = Date.now() + 4000;
      while (Date.now() < end) {
        const container = confirmBtn.closest("div, section, form, td, li") || document.body;
        const nearby = Array.from(container.querySelectorAll("input"))
          .find((i) => i.type !== "file" && i.type !== "hidden" && i.type !== "checkbox" && !i.readOnly);
        if (nearby) return nearby;
        const page = Array.from(document.querySelectorAll("input"))
          .find((i) =>
            i.type !== "file" && i.type !== "hidden" && i.type !== "checkbox" &&
            !i.readOnly &&
            !i.closest(".ant-modal, [role='dialog'], [class*='modal'], [class*='search'], header, nav") &&
            i.offsetParent !== null
          );
        if (page) return page;
        await sleep(300);
      }
      return null;
    })();

    if (inlineInput) {
      fillInput(inlineInput, quantity);
      log("UPLOAD", `[D2b] ✅ Filled inline quantity input: ${quantity}`);
      await sleep(600);
    } else {
      log("UPLOAD", "[D2b] No inline quantity input found — clicking without pre-fill.");
    }

    const _navOrderId = new URLSearchParams(window.location.search).get("order_id") || "";
    if (_navOrderId) {
      await chrome.storage.local.set({ pendingNavigateToList: _navOrderId });
      log("UPLOAD", `[D2c] 🔖 Set pendingNavigateToList=${_navOrderId}`);
    }
    confirmBtn.click();
    await sleep(2000);

    const modalEl = () => document.querySelector(
      ".ant-modal, .ant-modal-content, .modal, [role='dialog'], [class*='modal'], [class*='dialog']"
    );

    const numInput = await (async () => {
      const end = Date.now() + 4000;
      while (Date.now() < end) {
        const vis = Array.from(document.querySelectorAll("input[type='number']"))
          .find((i) => !i.closest("[style*='display:none'], [hidden]"));
        if (vis) return vis;
        const m = modalEl();
        if (m) {
          const inp = Array.from(m.querySelectorAll("input"))
            .find((i) => i.type !== "file" && i.type !== "hidden" && i.type !== "checkbox");
          if (inp) return inp;
        }
        await sleep(400);
      }
      return null;
    })();

    if (numInput) {
      fillInput(numInput, quantity);
      log("UPLOAD", `[D3] Filled post-click modal quantity: ${quantity}`);
      await sleep(400);
    }

    const okBtn = await (async () => {
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        const m = modalEl();
        if (m) {
          const btn = Array.from(m.querySelectorAll("button"))
            .find((b) => /^(ok|confirm|yes)$/i.test(b.textContent?.trim() || ""));
          if (btn) return btn;
        }
        const global = Array.from(document.querySelectorAll("button"))
          .find((b) => /^(ok|confirm|yes)$/i.test(b.textContent?.trim() || ""));
        if (global) return global;
        await sleep(400);
      }
      return null;
    })();

    if (okBtn) {
      log("UPLOAD", `[D3] Clicking dialog button: "${okBtn.textContent?.trim()}"`);
      okBtn.click();
      await sleep(2500);
    } else {
      log("UPLOAD", "[D3] No OK/Confirm dialog appeared — continuing.");
    }

    const errBanner = document.querySelector(".ant-message-notice, .ant-message-error, .ant-message-warning");
    if (errBanner) {
      const txt = errBanner.textContent?.trim() || "";
      warn("UPLOAD", `[D4] Z2U message after confirm: "${txt.slice(0, 200)}"`);
      if (/error|fail|invalid|reject/i.test(txt)) return false;
    }

    log("UPLOAD", "[D4] ✅ Confirm Delivered flow complete.");
    await chrome.storage.local.remove(["pendingNavigateToList"]);
    window.location.href = "https://www.z2u.com/sellOrder/index";
    return true;
  }

  // ── Direct API upload ───────────────────────────────────────────────

  const Z2U_FILE_FIELDS = ["upfile", "file", "upload", "excel", "formFile"];

  async function tryUploadWithField(url, method, fieldName, extraFields, file, orderId, csrfToken, note) {
    const formData = new FormData();
    for (const field of (extraFields || [])) {
      if (field.type !== "file") {
        const val = /^Z\d+$/i.test(field.value) ? orderId : (field.value || "");
        formData.append(field.key, val);
      }
    }
    if (orderId && !(extraFields || []).some((f) => /order_?id/i.test(f.key))) {
      formData.append("order_id", orderId);
    }
    const noteValue = note || "Delivered";
    if (!(extraFields || []).some((f) => /^note$/i.test(f.key))) {
      formData.append("note", noteValue);
    }
    formData.append(fieldName, file, file.name);
    log("UPLOAD-API", `  Trying field="${fieldName}" note="${noteValue}"`);

    const headers = {
      "X-Requested-With": "XMLHttpRequest",
      "Referer": window.location.href,
      "Origin": window.location.origin,
    };
    if (csrfToken) {
      headers["X-XSRF-TOKEN"] = csrfToken;
      headers["X-CSRF-TOKEN"]  = csrfToken;
    }

    const res = await fetch(url, { method: method || "POST", body: formData, credentials: "include", headers });
    const text = await res.text();
    log("UPLOAD-API", `  HTTP ${res.status} → ${text.slice(0, 300)}`);

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);

    let json = null;
    try { json = JSON.parse(text); } catch (_) {}

    if (json) {
      const code = json.code ?? json.status ?? json.errCode;
      const isOkCode = code === 0 || code === 200 || code === "0" || code === "200" || code === true || code === 1;
      if (!isOkCode) {
        throw new Error(`app-error code=${code} msg=${json.msg ?? json.message ?? "?"}`);
      }
      const msg = (json.msg || json.message || "").toLowerCase();
      if (/select|no file|missing|require|please/i.test(msg)) {
        throw new Error(`app-error: "${json.msg ?? json.message}"`);
      }
      const hasData = json.data !== null && json.data !== undefined && json.data !== "" && json.data !== false;
      log("UPLOAD-API", `  code=${code} data=${JSON.stringify(json.data)?.slice(0,100)} hasData=${hasData}`);
      return hasData;
    }

    return !text.toLowerCase().includes("<html") && !text.toLowerCase().includes("error");
  }

  const Z2U_KNOWN_ENDPOINTS = [
    { url: "https://www.z2u.com/sellOrder/uploadSellForm",   method: "POST" },
    { url: "https://www.z2u.com/SellOrder/uploadSellForm",   method: "POST" },
    { url: "https://www.z2u.com/sellOrder/uploadDelivery",   method: "POST" },
    { url: "https://www.z2u.com/sellOrder/deliveryUpload",   method: "POST" },
    { url: "https://www.z2u.com/sellOrder/uploadFile",       method: "POST" },
    { url: "https://www.z2u.com/api/sellOrder/uploadSellForm", method: "POST" },
    { url: "https://www.z2u.com/api/sellOrder/uploadDelivery", method: "POST" },
    { url: "https://www.z2u.com/api/upload/sellForm",        method: "POST" },
  ];

  function isImageEndpoint(url) {
    return /uploadOrderImg|uploadImg|uploadImage|orderImg/i.test(url || "");
  }

  async function tryEndpoint(epUrl, epMethod, extraFields, file, orderId, label, csrfToken) {
    for (const fieldName of Z2U_FILE_FIELDS) {
      try {
        const ok = await tryUploadWithField(epUrl, epMethod, fieldName, extraFields, file, orderId, csrfToken);
        if (ok) {
          log("UPLOAD-API", `✅ [${label}] field="${fieldName}" worked!`);
          return fieldName;
        }
        warn("UPLOAD-API", `[${label}] field="${fieldName}": no data — trying next`);
      } catch (e) {
        warn("UPLOAD-API", `[${label}] field="${fieldName}" error: ${e.message}`);
      }
    }
    return null;
  }

  async function directApiUpload(file, orderId, csrfToken) {
    const stored = await new Promise((r) =>
      chrome.storage.local.get(["z2uUploadEndpoint"], (d) => r(d.z2uUploadEndpoint))
    );

    if (stored?.url && !isImageEndpoint(stored.url)) {
      log("UPLOAD-API", `Stored endpoint: ${stored.method || "POST"} ${stored.url}`);
      if (!stored.probeFields && stored.fields?.length) {
        const fileField  = stored.fields.find((f) => f.type === "file");
        const fieldName  = fileField?.key || "upfile";
        const extraFields = stored.fields.filter((f) => f.type !== "file");
        log("UPLOAD-API", `Using captured field name: "${fieldName}"`);
        try {
          const ok = await tryUploadWithField(stored.url, stored.method, fieldName, extraFields, file, orderId, csrfToken);
          if (ok) return true;
          warn("UPLOAD-API", `Stored endpoint returned empty data — will probe fallbacks`);
        } catch (e) {
          warn("UPLOAD-API", `Stored endpoint failed: ${e.message} — will probe fallbacks`);
        }
      } else {
        const extraFields = (stored.fields || []).filter((f) => f.type !== "file");
        const winField = await tryEndpoint(stored.url, stored.method || "POST", extraFields, file, orderId, "stored", csrfToken);
        if (winField) {
          const updatedFields = [...extraFields, { key: winField, type: "file" }];
          chrome.storage.local.set({ z2uUploadEndpoint: { ...stored, fields: updatedFields, probeFields: false } });
          return true;
        }
        warn("UPLOAD-API", `All field probes failed on stored endpoint — trying known fallbacks`);
      }
    } else {
      log("UPLOAD-API", "No stored endpoint — going straight to known fallbacks");
    }

    const storedUrl = stored?.url || "";
    for (const ep of Z2U_KNOWN_ENDPOINTS) {
      if (ep.url === storedUrl) continue;
      log("UPLOAD-API", `Probing fallback: ${ep.method} ${ep.url}`);
      const winField = await tryEndpoint(ep.url, ep.method, [], file, orderId, ep.url.split("/").pop(), csrfToken);
      if (winField) {
        const saved = {
          url: ep.url, method: ep.method,
          fields: [{ key: winField, type: "file" }],
          probeFields: false,
        };
        chrome.storage.local.set({ z2uUploadEndpoint: saved });
        log("UPLOAD-API", `✅ Saved new endpoint: ${ep.url} / field="${winField}"`);
        return true;
      }
    }

    warn("UPLOAD-API", "All known endpoints failed. Falling back to UI approach.");
    return null;
  }

  async function uploadAndConfirm(filledBytes, filename, quantity) {
    const uploadName = filename || "template.xlsx";
    log("UPLOAD", `[A] Creating file object as: "${uploadName}" (qty=${quantity})`);
    const file = new File([new Uint8Array(filledBytes)], uploadName, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const _params  = new URLSearchParams(window.location.search);
    const _orderId = _params.get("order_id") || _params.get("orderId") || "";

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(500);

    log("UPLOAD", `[B] Downloading XLSX to disk…`);
    const dlResult = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "CDP_DOWNLOAD_FILE", fileBytes: Array.from(filledBytes), filename: uploadName },
        (r) => resolve(r || { ok: false, error: "No response" })
      );
    });
    if (dlResult.ok) {
      log("UPLOAD", `[B] ✅ File on disk: "${dlResult.filePath}"`);
    } else {
      warn("UPLOAD", `[B] Download to disk failed (non-fatal): ${dlResult.error}`);
    }

    log("UPLOAD", "[C_LOCAL] Sending XLSX to bridge via background.js…");
    try {
      const bridgeResp = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: "BRIDGE_UPLOAD",
          fileBytes: Array.from(filledBytes),
          orderId: _orderId,
          pageUrl: window.location.href,
          filename: uploadName,
        }, (r) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        });
      });

      if (bridgeResp.ok) {
        const bridgeJson = bridgeResp.result;
        if (bridgeJson.ok) {
          log("UPLOAD", `[C_LOCAL] ✅ Bridge upload succeeded`);
          await chrome.storage.local.set({
            pendingConfirmOrderId: _orderId,
            pendingConfirmQty:     quantity,
          });
          sessionDone.add(_orderId);
          await bgMarkProcessed(_orderId);
          log("UPLOAD", `[C_LOCAL] 🔒 Order ${_orderId} locked as processed.`);
          await sleep(1500);
          const confirmed = await confirmDeliveredFlow(quantity);
          await chrome.storage.local.remove(["pendingConfirmOrderId", "pendingConfirmQty"]);
          return confirmed;
        }
        warn("UPLOAD", `[C_LOCAL] Bridge returned failure: ${bridgeJson.error || "unknown"}`);
      } else {
        warn("UPLOAD", `[C_LOCAL] Bridge unreachable: ${bridgeResp.error || "unknown error"}`);
      }
    } catch (e) {
      warn("UPLOAD", `[C_LOCAL] Bridge error: ${e.message}`);
    }

    err("UPLOAD", "[C_LOCAL] ❌ Upload failed. Make sure bridge.py is running on your local machine.");
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  CHAT DELIVERY — M3U Credential Extraction & Form Auto-Fill
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Parse an M3U URL and extract username, password, and base domain.
   *
   * Example URL: http://line.dndnscloud.ru/get.php?username=457e964314&password=4973877680&type=m3u_plus&output=ts
   *   → username: "457e964314"
   *   → password: "4973877680"
   *   → baseDomain: "http://line.dndnscloud.ru"
   *
   * @param {string} m3uUrl - Full M3U URL with query parameters
   * @returns {{ username: string, password: string, baseDomain: string } | null}
   */
  function parseM3uUrl(m3uUrl) {
    if (!m3uUrl || typeof m3uUrl !== 'string') {
      log("CHAT-DELIVERY", `parseM3uUrl: invalid input`, m3uUrl);
      return null;
    }
    const trimmed = m3uUrl.trim();
    if (!trimmed) return null;

    try {
      const url = new URL(trimmed);
      const username = url.searchParams.get('username') || '';
      const password = url.searchParams.get('password') || '';

      if (!username || !password) {
        log("CHAT-DELIVERY", `parseM3uUrl: missing username or password in URL params`);
        return null;
      }

      // Extract base domain: protocol + host only (no path, no query string)
      const baseDomain = `${url.protocol}//${url.host}`;

      log("CHAT-DELIVERY", `parseM3uUrl: ✅ username="${username}" password="${password.slice(0, 4)}..." domain="${baseDomain}"`);
      return {
        username,
        password,
        baseDomain,
        rawUrl: trimmed,
      };
    } catch (e) {
      log("CHAT-DELIVERY", `parseM3uUrl: failed to parse URL "${trimmed.slice(0, 80)}" — ${e.message}`);
      return null;
    }
  }

  function getAlternativeDomains(baseDomain) {
    const config = {
      "http://line.dndnscloud.ru": ["http://vpn.trxdnscloud.ru", "http://tv.trexiptv.com"],
    };
    const normalized = (baseDomain || "").trim().toLowerCase();
    return config[normalized] || config[baseDomain?.trim()] || [];
  }

  /**
   * Format the chat message with credentials, optional alternative domains.
   *
   * @param {{ username: string, password: string, baseDomain: string }} parsed
   * @returns {string}
   */
  function formatChatMessage(parsed) {
    if (!parsed || !parsed.username || !parsed.password || !parsed.baseDomain) {
      log("CHAT-DELIVERY", "formatChatMessage: invalid parsed input");
      return '';
    }
    const { username, password, baseDomain } = parsed;
    const altDomains = getAlternativeDomains(baseDomain);

    const lines = [
      'Login Account',
      `: ${username}`,
      '',
      'Login Password',
      `: ${password}`,
      '',
      'Domain',
      `: ${baseDomain}`,
    ];

    if (altDomains.length > 0) {
      for (const alt of altDomains) {
        lines.push(`alternative domain : ${alt}`);
      }
    }

    const message = lines.join('\n');
    log("CHAT-DELIVERY", `formatChatMessage: ✅ ${altDomains.length} alt domains — ${lines.length} lines`);
    return message;
  }

  /**
   * Inject a value into an input element and dispatch proper events for React.
   * Returns true if the value was successfully injected.
   *
   * @param {HTMLInputElement} input
   * @param {string} value
   * @returns {boolean}
   */
  function safeInjectValue(input, value) {
    if (!input) return false;

    // Set the value using native setter
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (nativeSetter) nativeSetter.call(input, value); else input.value = value;

    // Try React 17+ __reactProps approach
    const reactPropsKey = Object.keys(input).find((k) => k.startsWith("__reactProps") || k.startsWith("__reactInternals"));
    if (reactPropsKey) {
      const props = input[reactPropsKey];
      const onChangeFn = props?.onChange;
      if (typeof onChangeFn === "function") {
        const syntheticEvent = {
          target: input,
          currentTarget: input,
          type: "input",
          bubbles: true,
          nativeEvent: { target: input, data: value },
          preventDefault: () => {},
          stopPropagation: () => {},
          persist: () => {},
        };
        onChangeFn(syntheticEvent);
        log("CHAT-DELIVERY", `[inject] ✅ React onChange via ${reactPropsKey}`);
      }
    }

    // Try React 16 __reactFiber approach
    const fiberKey = Object.keys(input).find((k) => k.startsWith("__reactFiber"));
    if (fiberKey) {
      const onChange = input[fiberKey]?.memoizedProps?.onChange;
      if (typeof onChange === "function") {
        const syntheticEvent = {
          target: input,
          currentTarget: input,
          type: "input",
          bubbles: true,
          nativeEvent: { target: input },
          preventDefault: () => {},
          stopPropagation: () => {},
          persist: () => {},
        };
        onChange(syntheticEvent);
        log("CHAT-DELIVERY", `[inject] ✅ React onChange via __reactFiber`);
      }
    }

    // Dispatch standard DOM events
    input.dispatchEvent(new Event("input",  { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

    const landed = input.value;
    log("CHAT-DELIVERY", `[inject] field="${input.name || input.id}" → "${landed.slice(0, 40)}" (${landed.length} chars)`);
    return landed.length > 0;
  }

  /**
   * Fill the Z2U order page form with M3U credentials.
   * Targets:
   *   - input[name="delivery[98]"]  → Login Account (username)
   *   - input[name="delivery[99]"]  → Login Password (password)
   *   - input[name="delivery[113]"] → Additional information (domain)
   *
   * @param {{ username: string, password: string, baseDomain: string }} parsed
   * @returns {{ usernameFilled: boolean, passwordFilled: boolean, domainFilled: boolean }}
   */
  function fillOrderPageForm(parsed) {
    if (!parsed) return { usernameFilled: false, passwordFilled: false, domainFilled: false };

    const results = { usernameFilled: false, passwordFilled: false, domainFilled: false };

    // Login Account (username)
    const usernameField = document.querySelector('input[name="delivery[98]"]');
    if (usernameField) {
      results.usernameFilled = safeInjectValue(usernameField, parsed.username);
      log("CHAT-DELIVERY", `✅ Filled delivery[98] (Login Account) with "${parsed.username}"`);
    } else {
      warn("CHAT-DELIVERY", `❌ delivery[98] field not found on page`);
    }

    // Login Password (password)
    const passwordField = document.querySelector('input[name="delivery[99]"]');
    if (passwordField) {
      results.passwordFilled = safeInjectValue(passwordField, parsed.password);
      log("CHAT-DELIVERY", `✅ Filled delivery[99] (Login Password) with "${parsed.password.slice(0, 4)}..."`);
    } else {
      warn("CHAT-DELIVERY", `❌ delivery[99] field not found on page`);
    }

    // Additional information (domain)
    const domainField = document.querySelector('input[name="delivery[113]"]');
    if (domainField) {
      results.domainFilled = safeInjectValue(domainField, parsed.baseDomain);
      log("CHAT-DELIVERY", `✅ Filled delivery[113] (Additional info) with "${parsed.baseDomain}"`);
    } else {
      warn("CHAT-DELIVERY", `❌ delivery[113] field not found on page`);
    }

    const allOk = results.usernameFilled && results.passwordFilled && results.domainFilled;
    log("CHAT-DELIVERY", `fillOrderPageForm: ${allOk ? '✅ ALL fields filled' : `⚠️  ${Object.values(results).filter(Boolean).length}/3 filled`}`);

    return results;
  }

  /**
   * Find and return the primary send button in the chat UI.
   * Filters out sidebar buttons and search inputs.
   *
   * @returns {HTMLButtonElement | null}
   */
  function findChatSendButton() {
    const SIDEBAR_SEL = '[class*="sideBar"], [class*="sidebar"], [class*="chatList"], aside, nav';

    const allBtns = Array.from(document.querySelectorAll("button, [role='button']"))
      .filter((b) => b.offsetParent && !b.closest(SIDEBAR_SEL));

    // Priority 1: button with send/submit text or aria-label
    const named = allBtns.find((b) => {
      const txt  = (b.textContent || "").trim().toLowerCase();
      const cls  = (b.className || "").toLowerCase();
      const aria = (b.getAttribute("aria-label") || "").toLowerCase();
      const ttip = (b.getAttribute("title") || "").toLowerCase();
      return /send|submit|发送|确认/i.test(txt + " " + cls + " " + aria + " " + ttip);
    });
    if (named) {
      log("CHAT-DELIVERY", `findChatSendButton: ✅ Found by name: "${named.textContent?.trim()}"`);
      return named;
    }

    // Priority 2: single visible button in the chat panel (likely Send)
    if (allBtns.length === 1) {
      log("CHAT-DELIVERY", `findChatSendButton: ✅ Only one button visible — using it`);
      return allBtns[0];
    }

    // Priority 3: last visible button (send is usually on the right/bottom)
    const lastBtn = allBtns[allBtns.length - 1];
    if (lastBtn) {
      log("CHAT-DELIVERY", `findChatSendButton: ✅ Using last button: "${lastBtn.textContent?.trim()}"`);
      return lastBtn;
    }

    return null;
  }

  /**
   * Inject message into the chat textarea and send it.
   * 1. Set value via execCommand insertText (native IME path)
   * 2. Dispatch input and change events
   * 3. Wait 500ms
   * 4. Click the send button
   *
   * @param {string} message
   * @returns {Promise<boolean>}
   */
  async function sendChatMessage(message) {
    if (!message) return false;

    // Find the chat textarea
    const SIDEBAR_SEL = '[class*="sideBar"], [class*="sidebar"], [class*="chatList"], aside, nav';

    function isSearchField(el) {
      if (el.type === "search") return true;
      const ph = (el.placeholder || el.getAttribute("placeholder") || "").toLowerCase();
      if (/search|find|filter|look|buscar|suche|chercher/i.test(ph)) return true;
      let node = el;
      for (let i = 0; i < 5; i++) {
        if (!node) break;
        if (/search|filter|find/i.test(node.className || "")) return true;
        node = node.parentElement;
      }
      return false;
    }

    // Find all visible inputs that are NOT in the sidebar and NOT search fields
    const candidates = Array.from(document.querySelectorAll('textarea, input[type="text"]'))
      .filter((el) => el.offsetParent && !el.closest(SIDEBAR_SEL) && !isSearchField(el));

    if (!candidates.length) {
      warn("CHAT-DELIVERY", `sendChatMessage: no chat input found on page`);
      return false;
    }

    // Prefer input with "message" placeholder
    const byPlaceholder = candidates.find((el) => {
      const ph = (el.placeholder || el.getAttribute("placeholder") || "").toLowerCase();
      return /message|type|write|send|reply|chat/i.test(ph);
    });
    const chatInput = byPlaceholder || candidates[candidates.length - 1];

    log("CHAT-DELIVERY", `sendChatMessage: targeting <${chatInput.tagName} name="${chatInput.name}" placeholder="${chatInput.placeholder}" class="${chatInput.className.slice(0, 60)}">`);

    // Focus and click the input
    chatInput.focus();
    chatInput.click();
    await sleep(100);

    // Clear existing content
    const proto = chatInput.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(chatInput, ""); else chatInput.value = "";
    chatInput.dispatchEvent(new Event("input",  { bubbles: true }));
    chatInput.dispatchEvent(new Event("change", { bubbles: true }));

    // Method 1: execCommand insertText (routes through native IME → React synthetic events)
    const execOk = document.execCommand("insertText", false, message);
    log("CHAT-DELIVERY", `sendChatMessage: execCommand insertText → ${execOk}`);

    // Method 2: Dispatch proper InputEvent for React
    chatInput.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: message,
    }));
    chatInput.dispatchEvent(new Event("input",  { bubbles: true, cancelable: true }));
    chatInput.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));

    // Method 3: Try React onChange directly
    const reacted = safeInjectValue(chatInput, message);
    log("CHAT-DELIVERY", `sendChatMessage: safeInjectValue → ${reacted}`);

    // Verify content landed
    const landed = chatInput.value || chatInput.textContent || "";
    log("CHAT-DELIVERY", `sendChatMessage: content after injection = "${landed.slice(0, 60)}"`);

    if (!landed.trim()) {
      warn("CHAT-DELIVERY", `sendChatMessage: ⚠️  Content appears empty after injection — proceeding anyway`);
    }

    // Wait 500ms before clicking send button
    log("CHAT-DELIVERY", `sendChatMessage: waiting 500ms before clicking send...`);
    await sleep(500);

    // Find and click the send button
    const sendBtn = findChatSendButton();
    if (sendBtn) {
      sendBtn.click();
      log("CHAT-DELIVERY", `✅ Clicked send button: "${sendBtn.textContent?.trim()}"`);
      return true;
    }

    // Fallback: dispatch Enter key
    log("CHAT-DELIVERY", `sendChatMessage: no send button found — dispatching Enter key`);
    const evtOpts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    chatInput.dispatchEvent(new KeyboardEvent("keydown",  evtOpts));
    chatInput.dispatchEvent(new KeyboardEvent("keypress", evtOpts));
    chatInput.dispatchEvent(new KeyboardEvent("keyup",    evtOpts));
    return true;
  }

  /**
   * Main chat delivery pipeline for a single order.
   * Orchestrates: parse M3U URL → fill order page form → send chat message.
   *
   * @param {string} orderId
   * @param {string} title
   * @param {number} quantity
   * @param {string} m3uUrl - The M3U URL from prepare-order response
   * @returns {Promise<boolean>}
   */
  async function runChatDelivery(orderId, title, quantity, m3uUrl) {
    log("CHAT-DELIVERY", `🚀 Starting chat delivery | orderId=${orderId} | m3uUrl="${(m3uUrl || "").slice(0, 80)}"`);

    if (!m3uUrl) {
      err("CHAT-DELIVERY", "No M3U URL provided — cannot extract credentials");
      return false;
    }

    // Step 1: Parse M3U URL to extract credentials
    const parsed = parseM3uUrl(m3uUrl);
    if (!parsed) {
      err("CHAT-DELIVERY", `Failed to parse M3U URL: "${m3uUrl.slice(0, 80)}"`);
      return false;
    }

    // Step 2: Fill the order page form with credentials
    const fillResults = fillOrderPageForm(parsed);
    if (!fillResults.usernameFilled && !fillResults.passwordFilled) {
      warn("CHAT-DELIVERY", `Form fill failed — continuing to chat anyway`);
    }
    await sleep(800);

    // Step 3: Format the chat message
    const message = formatChatMessage(parsed);
    if (!message) {
      err("CHAT-DELIVERY", "Failed to format chat message");
      return false;
    }
    log("CHAT-DELIVERY", `Message preview:\n${message}`);

    // Step 4: Send the chat message
    const sent = await sendChatMessage(message);
    if (!sent) {
      warn("CHAT-DELIVERY", `Chat message send failed`);
      return false;
    }

    log("CHAT-DELIVERY", `✅ Chat delivery completed for order ${orderId}`);
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  LIST PAGE
  // ══════════════════════════════════════════════════════════════════════════

  function normalizeMappingEntry(raw) {
    if (!raw) return null;
    if (typeof raw === "string") {
      return { serviceId: raw, deliveryMethod: "file", columnMap: { email: "A", password: "B" } };
    }
    return {
      serviceId: raw.serviceId || "",
      deliveryMethod: raw.deliveryMethod || "file",
      columnMap: raw.columnMap || { email: "A", password: "B" },
    };
  }

  async function prepareOrderPayload(orderId, title, quantity) {
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "PREPARE_ORDER", data: { orderId, title, quantity } }, (r) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!r?.ok) return reject(new Error(r?.error || "prepare-order failed"));
        resolve(r.result);
      });
    });
    return result;
  }

  function formatDirectPayload(accounts) {
    return (accounts || []).map((a) => [a.user, a.pass, a.email, a.email_pass].filter(Boolean).join(" | ")).join("\n");
  }

  async function runDirectDelivery(accounts, quantity) {
    const text = formatDirectPayload(accounts.slice(0, quantity));
    const input = document.querySelector("textarea, input[type='text']:not([readonly]), [contenteditable='true']");
    if (!input) {
      warn("DIRECT", "No writable direct-delivery field found.");
      return false;
    }
    if (input.matches("[contenteditable='true']")) {
      input.focus();
      input.textContent = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (setter && input.tagName === "INPUT") setter.call(input, text);
      else input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return await confirmDeliveredFlow(quantity);
  }

  async function runListPage() {
    log("LIST", "📋 Scan started.");
    const mappings = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_MAPPINGS" }, (r) => resolve(r?.mappings || {}));
    });
    const mappingKeys = Object.keys(mappings);
    log("LIST", `Mappings loaded: ${mappingKeys.length} entries → ${JSON.stringify(mappingKeys)}`);
    if (!mappingKeys.length) { warn("LIST", "No mappings configured — nothing to do."); return; }

    function normaliseTitle(s) {
      return (s || "").replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "").replace(/\s+/g, " ").trim();
    }
    function findMapping(title) {
      if (mappings[title]) return title;
      const norm = normaliseTitle(title);
      return mappingKeys.find((k) => normaliseTitle(k) === norm) || null;
    }

    const panels = document.querySelectorAll(".orderPanel");
    log("LIST", `Found ${panels.length} .orderPanel(s).`);
    if (!panels.length) { warn("LIST", "No .orderPanel divs found."); log("LIST", "Page body preview:", document.body.innerHTML.slice(0, 500)); }

    for (const panel of panels) {
      const statusBadge = panel.querySelector(".smLabel.dangerLabel, .smLabel.warningLabel, .smLabel");
      const statusText  = statusBadge?.textContent?.trim().toUpperCase() || "(no status)";
      log("LIST", `Panel status: "${statusText}"`);
      const isActionable = statusText.includes("NEW ORDER") || statusText.includes("PREPARING") || statusText.includes("DELIVERING");
      if (!isActionable) continue;

      const copyBtn = panel.querySelector("[data-clipboard-text]");
      const orderIdFromClipboard = copyBtn?.getAttribute("data-clipboard-text")?.trim();
      const orderIdFromLink = panel.querySelector(".o-number a")?.textContent?.trim();
      const orderId = orderIdFromClipboard || orderIdFromLink;

      const titleEl = (
        panel.querySelector(".o-l-col.productInfo a") ||
        panel.querySelector(".productInfo a") ||
        panel.querySelector('[class*="productInfo"] a') ||
        panel.querySelector('[class*="goodsName"]') ||
        panel.querySelector('[class*="offerTitle"]') ||
        panel.querySelector('[class*="productTitle"]')
      );
      const title = titleEl?.textContent?.trim() || "";
      if (!title) warn("LIST", `Could not extract title for panel — orderId="${panel.querySelector("[data-clipboard-text]")?.getAttribute("data-clipboard-text")?.trim()}"`);

      const detailLink = panel.querySelector('.o-l-col.productStatus a[href*="sellOrder"]');
      const detailHref = detailLink?.getAttribute("href") || "";
      const resolvedListTitle = findMapping(title);
      log("LIST", `🔍 NEW ORDER → orderId="${orderId}" | title="${title}" | resolvedTitle="${resolvedListTitle}" | href="${detailHref}"`);

      if (!orderId) { warn("LIST", "Could not extract orderId — skipping."); continue; }

      if (!resolvedListTitle) {
        if (!statusText.includes("NEW ORDER")) { log("LIST", `Unmapped order ${orderId} in state "${statusText}" — ignoring.`); continue; }
        if (sessionDone.has(orderId)) { log("LIST", `Unmapped order ${orderId} already prepared this session.`); continue; }
        if (!detailHref) { warn("LIST", `No detail link for unmapped order ${orderId}.`); continue; }
        log("LIST", `⚡ Unmapped NEW ORDER "${title}" (${orderId}) → navigating to click Prepare only`);
        sessionDone.add(orderId);
        await chrome.storage.local.set({ prepareOnly: true, pendingOrderId: orderId, pendingUnmappedTitle: title });
        window.location.href = detailHref;
        return;
      }

      if (sessionDone.has(orderId)) { log("LIST", `Order ${orderId} already in progress this session.`); continue; }
      const alreadyDone = await bgIsProcessed(orderId);
      if (alreadyDone) { log("LIST", `Order ${orderId} already processed (persistent storage).`); continue; }
      if (!detailHref) { warn("LIST", `No Order Detail link for ${orderId}.`); continue; }
      await chrome.storage.local.set({ pendingOrderId: orderId, pendingTitle: resolvedListTitle });
      log("LIST", `🔗 Navigating to detail page: ${detailHref}`);
      window.location.href = detailHref;
      return;
    }
    log("LIST", "✅ Scan complete — no unprocessed NEW ORDER panels.");
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DETAIL PAGE
  // ══════════════════════════════════════════════════════════════════════════

  async function runDetailPage() {
    const params  = new URLSearchParams(window.location.search);
    const orderId = params.get("order_id") || params.get("orderId");
    log("DETAIL", `📄 Page loaded | orderId="${orderId}"`);
    if (!orderId) { warn("DETAIL", "No order_id in URL — stopping."); return; }
    log("DETAIL", "Waiting 1s for page to fully render…");
    await sleep(1000);

    // ── [0] Resume pending Confirm Delivery after page reload ─────────────────
    const { pendingConfirmOrderId, pendingConfirmQty } = await new Promise((r) =>
      chrome.storage.local.get(["pendingConfirmOrderId", "pendingConfirmQty"], r)
    );
    if (pendingConfirmOrderId && pendingConfirmOrderId === orderId) {
      const qty = pendingConfirmQty || 1;
      log("DETAIL", `[0] ↩ Resuming confirmDeliveredFlow for ${orderId} (qty=${qty}) after page reload.`);
      await chrome.storage.local.remove(["pendingConfirmOrderId", "pendingConfirmQty"]);
      await confirmDeliveredFlow(qty);
      return;
    }

    // ── [0b] Return to list after Prepare click ───────────────────────────────
    const { pendingReturnToList, pendingReturnTitle } = await new Promise((r) =>
      chrome.storage.local.get(["pendingReturnToList", "pendingReturnTitle"], r)
    );
    if (pendingReturnToList && pendingReturnToList === orderId) {
      log("DETAIL", `[0b] ↩ Prepare already clicked for ${orderId} — returning to list.`);
      await chrome.storage.local.remove(["pendingReturnToList", "pendingReturnTitle"]);
      chrome.runtime.sendMessage({ type: "MARK_PREPARED_ONLY", orderId }).catch(() => {});
      recordAnalytics(orderId, pendingReturnTitle || "", 1);
      window.location.href = "https://www.z2u.com/sellOrder/index";
      return;
    }

    // ── [0c] Navigate to list after Confirm Delivered ─────────────────────────
    const { pendingNavigateToList } = await new Promise((r) =>
      chrome.storage.local.get(["pendingNavigateToList"], r)
    );
    if (pendingNavigateToList && pendingNavigateToList === orderId) {
      log("DETAIL", `[0c] ↩ Confirm Delivered completed for ${orderId} — navigating to order list.`);
      await chrome.storage.local.remove(["pendingNavigateToList"]);
      window.location.href = "https://www.z2u.com/sellOrder/index";
      return;
    }

    // ── [1] Status check ──────────────────────────────────────────────────────
    const pageText      = document.body.textContent?.toUpperCase() || "";
    const statusBadge   = document.querySelector(".smLabel.dangerLabel, .smLabel.warningLabel, .smLabel, [class*='statusLabel'], .order-status");
    const badgeText     = statusBadge?.textContent?.trim().toUpperCase() || "not found";
    const hasNew        = pageText.includes("NEW ORDER");
    const hasPreparing  = pageText.includes("PREPARING");
    const hasDelivering = pageText.includes("DELIVERING");
    const isActionable  = hasNew || hasPreparing || hasDelivering;
    log("DETAIL", `[1] Status → NEW ORDER:${hasNew} | PREPARING:${hasPreparing} | DELIVERING:${hasDelivering} | badge:"${badgeText}"`);
    if (!isActionable) { log("DETAIL", `[1] Order ${orderId} is not in an actionable state — skipping.`); return; }

    // ── [2] Title extraction ─────────────────────────────────────────────────
    let title = "";
    function cleanTitle(raw) { return (raw || "").replace(/^[\s:]+/, "").trim(); }
    const allEls = Array.from(document.querySelectorAll("*"));
    for (const el of allEls) {
      if (el.childElementCount > 0) continue;
      const t = el.textContent?.trim() || "";
      if (/^product\s*title$/i.test(t)) {
        const sib = el.nextElementSibling || el.parentElement?.nextElementSibling;
        const raw = sib?.textContent?.trim() || "";
        title = cleanTitle(raw);
        log("DETAIL", `[2A] Found "Product Title" label → raw: "${raw.slice(0, 80)}" → cleaned: "${title.slice(0, 80)}"`);
        break;
      }
    }
    if (!title) {
      for (const row of document.querySelectorAll("tr, dl dt, .info-row, .detail-row")) {
        if ((row.textContent || "").toLowerCase().includes("product title")) {
          const next = row.nextElementSibling || row.querySelector("td:nth-child(2), dd");
          title = cleanTitle(next?.textContent?.trim() || "");
          log("DETAIL", `[2B] Row approach → "${title.slice(0, 80)}"`);
          if (title) break;
        }
      }
    }
    if (!title) {
      const el = document.querySelector('[class*="productTitle"], [class*="product-title"], [class*="goodsName"]');
      title = cleanTitle(el?.textContent?.trim() || "");
      log("DETAIL", `[2C] Class-based approach → "${title.slice(0, 80)}"`);
    }
    log("DETAIL", `[2] Final title: "${title}"`);
    if (!title) { err("DETAIL", "[2] Could not extract product title from page."); return; }

    // ── [3] Mapping check ────────────────────────────────────────────────────
    const mappings = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_MAPPINGS" }, (r) => resolve(r?.mappings || {}));
    });
    log("DETAIL", `[3] Mappings available: ${JSON.stringify(Object.keys(mappings))}`);
    function normalise(s) { return s.replace(/\s+/g, " ").trim(); }
    let resolvedTitle = title;
    if (!mappings[title]) {
      const keys = Object.keys(mappings);
      const fuzzy = keys.find((k) => normalise(k) === normalise(title));
      if (fuzzy) {
        warn("DETAIL", `[3] Exact miss but fuzzy match found. Using: "${fuzzy.slice(0, 60)}"`);
        resolvedTitle = fuzzy;
      } else {
        warn("DETAIL", `[3] No mapping for title: "${title}"`);
        log("DETAIL", `[3] Available keys: ${JSON.stringify(keys)}`);
        await chrome.storage.local.remove(["pendingOrderId", "pendingTitle"]);
        log("DETAIL", `[3] Unmapped order — leaving page alone.`);
        return;
      }
    }
    const mappingEntry = normalizeMappingEntry(mappings[resolvedTitle]);
    if (!mappingEntry?.serviceId) { err("DETAIL", `[3] Mapping found but invalid for "${resolvedTitle}"`); return; }
    log("DETAIL", `[3] ✅ Mapping found → productId="${mappingEntry.serviceId}" deliveryMethod="${mappingEntry.deliveryMethod}"`);

    // ── [4] Dedup ─────────────────────────────────────────────────────────────
    if (sessionDone.has(orderId)) { log("DETAIL", `[4] Already in progress this session — skipping.`); return; }
    const alreadyDone = await bgIsProcessed(orderId);
    log("DETAIL", `[4] bgIsProcessed → ${alreadyDone}`);
    if (alreadyDone) { log("DETAIL", `[4] Order ${orderId} already completed. Use popup → Clear History to retry.`); return; }
    sessionDone.add(orderId);
    await chrome.storage.local.remove(["pendingOrderId", "pendingTitle"]);

    // ── [5] Quantity ────────────────────────────────────────────────────────────
    let quantity = 1;
    const allNodes = Array.from(document.querySelectorAll("*"));
    for (let j = 0; j < allNodes.length; j++) {
      if (allNodes[j].childElementCount > 0) continue;
      const t = allNodes[j].textContent?.trim() || "";
      if (/^quantity$/i.test(t)) {
        const next = allNodes[j].nextElementSibling || allNodes[j].parentElement?.nextElementSibling;
        const val  = parseInt(next?.textContent?.trim() || "0", 10);
        log("DETAIL", `[5] Found QUANTITY label → next element text: "${next?.textContent?.trim()}" → parsed: ${val}`);
        if (val > 0) { quantity = val; break; }
      }
    }
    log("DETAIL", `[5] Using quantity: ${quantity}`);
    recordAnalytics(orderId, title, quantity);
    log("DETAIL", `🚀 Starting fulfillment | orderId=${orderId} | qty=${quantity}`);
    dumpButtons("DETAIL-BEFORE-PREPARING");

    // ── [6] Determine delivery method ────────────────────────────────────────────
    const deliveryMethod = mappingEntry.deliveryMethod || "file";
    log("DETAIL", `[6] Delivery method: "${deliveryMethod}"`);

    // ── CHAT DELIVERY PATH ────────────────────────────────────────────────────
    if (deliveryMethod === "chat") {
      log("DETAIL", `[6] 🚀 CHAT DELIVERY path`);

      const allBtnsNow = Array.from(document.querySelectorAll("button, a"));
      const hasStartTrading = allBtnsNow.some((b) => b.textContent?.trim().toUpperCase().includes("START TRADING"));
      const hasPrepBtn      = allBtnsNow.some((b) => b.textContent?.trim().toUpperCase() === "PREPARING");

      if (!hasStartTrading && hasPrepBtn) {
        const preparingBtn = allBtnsNow.find((b) => b.textContent?.trim().toUpperCase() === "PREPARING");
        log("DETAIL", `[6] CHAT: Clicking PREPARING`);
        preparingBtn.click();
        log("DETAIL", "[6] CHAT: ✅ Clicked PREPARING. Waiting 3s…");
        await sleep(3000);

        log("DETAIL", "[7] CHAT: Waiting for START TRADING button (10s)…");
        const startBtn = await waitForElementByText("button, a", "START TRADING", 10000);
        if (startBtn) {
          log("DETAIL", `[7] CHAT: Clicking START TRADING`);
          startBtn.click();
          await sleep(2500);
        }
      } else if (hasStartTrading) {
        log("DETAIL", "[6] CHAT: START TRADING already visible — proceeding to click it.");
        const startBtn = await waitForElementByText("button, a", "START TRADING", 5000);
        if (startBtn) {
          startBtn.click();
          await sleep(2500);
        }
      } else {
        warn("DETAIL", "[6] CHAT: Neither PREPARING nor START TRADING buttons are present. Order may already be in 'Delivering' state. Proceeding straight to credentials injection.");
      }

      // Check for confirm modal safely without crashing if absent
      const allConfirmBtns = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent?.trim().toUpperCase() === "CONFIRM");
      if (allConfirmBtns.length) {
        const green = allConfirmBtns[allConfirmBtns.length - 1];
        log("DETAIL", `[8] CHAT: Found CONFIRM modal button, clicking it.`);
        green.click();
        await sleep(3000);
      }

      // ── [9] Fetch M3U URL from backend ──────────────────────────────────
      log("DETAIL", "[9] CHAT: Calling prepare-order to get M3U URL…");
      let m3uUrl = null;

      try {
        const prepared = await prepareOrderPayload(orderId, resolvedTitle, quantity);
        log("DETAIL", "[9] CHAT: prepare-order response preview:", JSON.stringify(prepared).slice(0, 300));

        // Handle explicit API error fields
        if (prepared?.error) {
          throw new Error(`Lfollowers API Error: ${prepared.error}`);
        }

        // Try nested order object first: prepared.order.m3u_url
        const orderObj = prepared?.order || prepared?.data?.order || prepared?.data;
        if (orderObj) {
          m3uUrl = orderObj.m3u_url || orderObj.dns_link || orderObj.url || prepared.m3u_url || prepared.dns_link;
          log("CHAT-DELIVERY", `[9] CHAT: extracted m3uUrl="${(m3uUrl || "").slice(0, 80)}"`);
        } else {
          // Fallback: try flat keys
          m3uUrl = prepared?.m3u_url || prepared?.dns_link || prepared?.url || prepared?.data;
        }

        if (!m3uUrl && typeof prepared?.data === "string" && prepared.data.includes("http")) {
          const match = prepared.data.match(/(https?:\/\/[^\s]+)/);
          if (match) m3uUrl = match[1];
        }

        if (m3uUrl) {
          log("DETAIL", `[9] CHAT: M3U URL extracted: "${m3uUrl.slice(0, 80)}"`);
        } else {
          err("DETAIL", `[9] CHAT: Could not find M3U URL in payload. Full JSON dump:`, JSON.stringify(prepared));
        }
      } catch (e) {
        err("DETAIL", `[9] CHAT: prepare-order failed: ${e.message}`);
      }

      if (!m3uUrl) {
        err("DETAIL", "[9] CHAT: No M3U URL found in Lfollowers response — cannot proceed.");
        return;
      }

      // ── [10] Run the full chat delivery pipeline ─────────────────────────────
      const chatOk = await runChatDelivery(orderId, resolvedTitle, quantity, m3uUrl);
      if (chatOk) {
        await bgMarkProcessed(orderId);
        log("DETAIL", `[11] ✅ Chat delivery completed for ${orderId}.`);
      } else {
        warn("DETAIL", "[11] Chat delivery did not complete successfully.");
      }

      log("DETAIL", "↩ Returning to order list in 3s…");
      await sleep(3000);
      window.location.href = "/sellOrder/index";
      return;
    }

    // ── DIRECT DELIVERY PATH ──────────────────────────────────────────────────
    if (deliveryMethod === "direct") {
      log("DETAIL", "[9] deliveryMethod=direct — preparing payload (no XLSX upload).");
      const prepared = await prepareOrderPayload(orderId, resolvedTitle, quantity);
      const ok = await runDirectDelivery(prepared.accounts || [], quantity);
      if (ok) { await bgMarkProcessed(orderId); log("DETAIL", `[11] ✅ Direct delivery completed for ${orderId}.`); }
      return;
    }

    // ── FILE DELIVERY PATH (default) ───────────────────────────────────────

    function findTemplateLink() {
      const allAnchors = Array.from(document.querySelectorAll("a, button"));
      const byText = allAnchors.find((el) => {
        const t = el.textContent?.trim().toUpperCase() || "";
        return t.includes("DOWNLOAD") && (
          t.includes("TEMPLATE") || t.includes("BULK DELIVERY") ||
          t.includes("DELIVERY FORM") || t.includes("SELL FORM")
        );
      });
      if (byText) return byText;
      return document.querySelector('a[href*=".xlsx"], a[download][href*="sell"]');
    }

    const allBtnsNow = Array.from(document.querySelectorAll("button, a"));
    const templateLinkEl  = findTemplateLink();
    const hasTemplateLink = !!templateLinkEl;
    const hasStartTrading = allBtnsNow.some((b) => b.textContent?.trim().toUpperCase().includes("START TRADING"));
    const hasPrepBtn      = allBtnsNow.some((b) => b.textContent?.trim().toUpperCase() === "PREPARING");

    if (templateLinkEl) {
      log("DETAIL", `[6] Template link found: text="${templateLinkEl.textContent?.trim()}" href="${templateLinkEl.getAttribute("href")}"`);
    }
    log("DETAIL", `[6] Page state → hasTemplateLink:${hasTemplateLink} | hasStartTrading:${hasStartTrading} | hasPrepBtn:${hasPrepBtn}`);
    dumpButtons("DETAIL-STATE-CHECK");

    const hasWaitForConfirm = badgeText.includes("WAIT FOR CONFIRM") || badgeText.includes("WAITING FOR CONFIRM");
    if (hasWaitForConfirm) {
      log("DETAIL", `[6] 🟡 Badge="${badgeText}" → WAIT FOR CONFIRMED — skipping upload, going straight to confirm delivery.`);
      return await confirmDeliveredFlow(quantity);
    }

    if (!hasTemplateLink) {
      if (!hasStartTrading) {
        if (!hasPrepBtn) { err("DETAIL", "[6] FILE: Neither PREPARING nor START TRADING nor template link found."); dumpButtons("DETAIL-[6]-STUCK"); return; }
        const preparingBtn = allBtnsNow.find((b) => b.textContent?.trim().toUpperCase() === "PREPARING");
        log("DETAIL", `[6] FILE: Clicking PREPARING: tag=${preparingBtn.tagName} class="${preparingBtn.className}"`);
        preparingBtn.click();
        log("DETAIL", "[6] FILE: ✅ Clicked PREPARING. Waiting 3s…");
        await sleep(3000);
      } else {
        log("DETAIL", "[6] FILE: START TRADING already visible — skipping PREPARING.");
      }

      log("DETAIL", "[7] FILE: Waiting for START TRADING button (10s)…");
      dumpButtons("DETAIL-BEFORE-START-TRADING");
      const startBtn = await waitForElementByText("button, a", "START TRADING", 10000);
      if (!startBtn) { err("DETAIL", "[7] FILE: START TRADING button not found after 10s."); dumpButtons("DETAIL-[7]-FAILED"); return; }
      log("DETAIL", `[7] FILE: Clicking START TRADING: tag=${startBtn.tagName} text="${startBtn.textContent?.trim()}" class="${startBtn.className}"`);
      startBtn.click();
      log("DETAIL", "[7] FILE: ✅ Clicked START TRADING. Waiting 2.5s…");
      await sleep(2500);

      log("DETAIL", "[8] FILE: Waiting for CONFIRM button in modal (8s)…");
      dumpButtons("DETAIL-AFTER-START-TRADING");
      const allConfirmBtns = await (async () => {
        const end = Date.now() + 8000;
        while (Date.now() < end) {
          const btns = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent?.trim().toUpperCase() === "CONFIRM");
          if (btns.length) return btns;
          await sleep(400);
        }
        return [];
      })();

      if (allConfirmBtns.length) {
        const green = allConfirmBtns[allConfirmBtns.length - 1];
        log("DETAIL", `[8] FILE: Found ${allConfirmBtns.length} CONFIRM btn(s), clicking last: class="${green.className}"`);
        green.click();
        log("DETAIL", "[8] FILE: ✅ Clicked CONFIRM. Waiting 3s…");
        await sleep(3000);
      } else {
        warn("DETAIL", "[8] FILE: CONFIRM modal not found — continuing anyway.");
        dumpButtons("DETAIL-[8]-NO-MODAL");
      }
    } else {
      log("DETAIL", "[6-8] Template link already on page — order is in Delivering state. Jumping to download.");
    }

    // ── [9] Download template & process ──────────────────────────────────────
    log("DETAIL", "[9] FILE: Looking for template download link…");
    const templateLink = findTemplateLink();
    if (!templateLink) {
      err("DETAIL", "[9] FILE: Template download link NOT found.");
      log("DETAIL", "[9] FILE: All <a> elements on page:",
        Array.from(document.querySelectorAll("a")).map((a) => `"${a.textContent?.trim()}" → ${a.getAttribute("href")}`).join(" | "));
      return;
    }
    const templateUrl = templateLink.getAttribute("href");
    log("DETAIL", `[9] FILE: Template link: text="${templateLink.textContent?.trim()}" href="${templateUrl}"`);
    const { bytes: templateBlob, filename: templateFilename } = await downloadBlob(templateUrl);
    log("DETAIL", `[9] FILE: Original template filename: "${templateFilename}"`);

    log("DETAIL", "[10] FILE: Sending to backend…");
    let filledBytes;
    try {
      filledBytes = await sendToBackend({ orderId, title: resolvedTitle, quantity, templateBlob: Array.from(templateBlob), templateFilename });
      log("DETAIL", `[10] ✅ Backend success. Filled file size: ${filledBytes.length} bytes`);
    } catch (backendErr) { err("DETAIL", `[10] FILE: Backend failed: ${backendErr.message}`); return; }

    log("DETAIL", "[11] FILE: Uploading filled file…");
    const uploaded = await uploadAndConfirm(filledBytes, templateFilename, quantity);
    if (uploaded) { await bgMarkProcessed(orderId); log("DETAIL", `[11] ✅ Order ${orderId} fully completed and marked processed.`); }
    else { warn("DETAIL", "[11] FILE: Upload/confirm step did not complete."); }

    log("DETAIL", "↩ Returning to order list in 3s to process next order…");
    await sleep(3000);
    window.location.href = "/sellOrder/index";
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  function init() {
    chrome.storage.local.get(["autoPaused"], ({ autoPaused }) => {
      if (autoPaused) { log("INIT", "⏸ Auto-processing is PAUSED. Network capture still active. Resume from popup."); return; }
      if (isListPage) {
        log("INIT", "▶ Running on LIST page. Will scan every 30s.");
        setTimeout(runListPage, 2500);
        setInterval(runListPage, 30000);
      } else if (isDetailPage) {
        log("INIT", "▶ Running on DETAIL page.");
        setTimeout(runDetailPage, 2500);
      } else {
        log("INIT", `Page not matched: ${href}`);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();