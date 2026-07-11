// popup.js — updated for dual-backend auto-routing

// ── Load CONFIG from config.js ────────────────────────────────────────────────
// config.js is loaded by background.js via importScripts. We read it from
// there since background.js has already loaded it.
let BACKENDS = [];
async function loadBackends() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["backendConfig"], (d) => {
      if (d.backendConfig && d.backendConfig.length) {
        BACKENDS = d.backendConfig;
      } else {
        // Fallback: try to read from background's CONFIG (not directly accessible)
        // We'll use storage to pass the list from background to popup
      }
      resolve();
    });
  });
}

// ── Backend status ───────────────────────────────────────────────────────────
async function checkBackendStatus(backend, index) {
  const dot = document.getElementById(`dot${index}`);
  const url = document.getElementById(`url${index}`);
  const status = document.getElementById(`status${index}`);

  if (!dot) return;

  dot.className = "backend-dot checking";
  status.className = "backend-status checking";
  status.textContent = "checking…";
  url.textContent = backend.url.slice(0, 40);

  try {
    const res = await fetch(`${backend.url}/api/healthz`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      dot.className = "backend-dot ok";
      status.className = "backend-status ok";
      status.textContent = "✓ connected";
    } else {
      dot.className = "backend-dot error";
      status.className = "backend-status error";
      status.textContent = `HTTP ${res.status}`;
    }
  } catch (e) {
    dot.className = "backend-dot error";
    status.className = "backend-status error";
    status.textContent = "offline";
  }
}

async function checkAllBackends() {
  for (let i = 0; i < BACKENDS.length; i++) {
    await checkBackendStatus(BACKENDS[i], i);
  }
}

// ── Capture mode ───────────────────────────────────────────────────────────────
let capturing = false;

captureBtn.addEventListener("click", async () => {
  if (capturing) {
    chrome.runtime.sendMessage({ type: "STOP_CAPTURE" });
    setCaptureIdle();
    return;
  }
  captureBtn.disabled = true;
  captureMsg.textContent = "Connecting…";
  const resp = await chrome.runtime.sendMessage({ type: "START_CAPTURE" });
  captureBtn.disabled = false;
  if (!resp.ok) {
    captureMsg.style.color = "#fca5a5";
    captureMsg.textContent = "Error: " + resp.error;
    return;
  }
  capturing = true;
  captureBtn.textContent = "⏹ Stop Capture Mode";
  captureBtn.style.background = "#dc2626";
  captureMsg.style.color = "#7dd3fc";
  captureMsg.textContent = `Listening… do your upload now.`;
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "CAPTURE_COMPLETE") {
    setCaptureIdle();
    captureMsg.style.color = "#6ee7b7";
    captureMsg.textContent = "✅ Endpoint captured!";
    refreshEndpointUI();
  }
  if (msg.type === "CAPTURE_STOPPED") {
    setCaptureIdle();
  }
});

function setCaptureIdle() {
  capturing = false;
  captureBtn.textContent = "🎯 Start Capture Mode";
  captureBtn.style.background = "#0ea5e9";
  if (!captureMsg.textContent.includes("✅")) {
    captureMsg.textContent = "";
  }
}

// ── Pause toggle ──────────────────────────────────────────────────────────────
async function refreshPauseUI() {
  const { autoPaused } = await chrome.storage.local.get("autoPaused");
  if (autoPaused) {
    pauseBtn.textContent = "▶ Resume Auto-Processing";
    pauseBtn.style.background = "#22c55e";
    pauseMsg.textContent = "Paused — capture still active.";
  } else {
    pauseBtn.textContent = "⏸ Pause Auto-Processing";
    pauseBtn.style.background = "#f59e0b";
    pauseMsg.textContent = "";
  }
}

pauseBtn.addEventListener("click", async () => {
  const { autoPaused } = await chrome.storage.local.get("autoPaused");
  await chrome.storage.local.set({ autoPaused: !autoPaused });
  await refreshPauseUI();
});

// ── Endpoint UI ────────────────────────────────────────────────────────────────
async function refreshEndpointUI() {
  const box = document.getElementById("endpointBox");
  const { z2uUploadEndpoint: ep } = await chrome.storage.local.get("z2uUploadEndpoint");
  if (ep?.url) {
    const fileField = ep.fields?.find((f) => f.type === "file")?.key;
    box.innerHTML = `Upload endpoint: ✅ <span style="color:#94a3b8">${ep.url.slice(0,50)}…</span> ${fileField ? `| field: "${fileField}"` : ""}`;
  } else {
    box.textContent = "Upload endpoint: ⏳ not yet — do one manual upload";
  }
}

// ── Clear history ─────────────────────────────────────────────────────────────
document.getElementById("clearBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove(["processed", "preparedOnly"]);
  const el = document.getElementById("clearMsg");
  el.textContent = "History cleared — orders can be reprocessed.";
  setTimeout(() => (el.textContent = ""), 3000);
});

document.getElementById("resetEndpointBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove("z2uUploadEndpoint");
  chrome.runtime.sendMessage({ type: "RESET_ENDPOINT" });
  await refreshEndpointUI();
});

// ── Telegram settings ─────────────────────────────────────────────────────────
document.getElementById("tgSaveBtn").addEventListener("click", async () => {
  const token  = document.getElementById("tgToken").value.trim();
  const chatId = document.getElementById("tgChatId").value.trim();
  if (!token || !chatId) {
    document.getElementById("tgMsg").textContent = "Both fields required.";
    document.getElementById("tgMsg").style.color = "#fca5a5";
    return;
  }
  await chrome.storage.local.set({ tgToken: token, tgChatId: chatId });
  document.getElementById("tgMsg").textContent = "Saved!";
  document.getElementById("tgMsg").style.color = "#6ee7b7";
  setTimeout(() => (document.getElementById("tgMsg").textContent = ""), 2000);
  await verifyTgBot(token, chatId);
});

document.getElementById("tgTestBtn").addEventListener("click", async () => {
  const testEl = document.getElementById("tgTestMsg");
  const token  = document.getElementById("tgToken").value.trim();
  const chatId = document.getElementById("tgChatId").value.trim();
  if (!token || !chatId) {
    testEl.textContent = "Save Bot Token + Chat ID first.";
    testEl.style.color = "#fca5a5";
    return;
  }
  testEl.textContent = "Sending…";
  testEl.style.color = "#c4b5fd";
  try {
    const text =
      `💬 <b>Z2U Chat</b>\n` +
      `👤 <b>TestUser</b>:\n` +
      `This is a test message from your extension.\n\n` +
      `<i>↩ Reply to this message to test the reply pipeline</i>`;
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const d = await r.json();
    if (d.ok) {
      const stored = await chrome.storage.local.get(["tgMsgMap"]);
      const map = stored.tgMsgMap || {};
      map[String(d.result.message_id)] = "TestUser";
      await chrome.storage.local.set({ tgMsgMap: map });
      testEl.textContent = `✅ Sent! Reply to it in Telegram to test replies.`;
      testEl.style.color = "#6ee7b7";
    } else {
      testEl.textContent = `❌ ${d.description}`;
      testEl.style.color = "#fca5a5";
    }
  } catch (e) {
    testEl.textContent = `❌ ${e.message}`;
    testEl.style.color = "#fca5a5";
  }
});

async function verifyTgBot(token, chatId) {
  const statusEl = document.getElementById("tgStatus");
  statusEl.textContent = "Verifying bot…";
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const d = await r.json();
    if (d.ok) {
      statusEl.textContent = `✅ Bot: @${d.result.username}`;
      statusEl.style.color = "#6ee7b7";
    } else {
      statusEl.textContent = `❌ ${d.description}`;
      statusEl.style.color = "#fca5a5";
    }
  } catch {
    statusEl.textContent = "❌ Could not reach Telegram";
    statusEl.style.color = "#fca5a5";
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Get backend list from background via message
  const resp = await chrome.runtime.sendMessage({ type: "GET_BACKEND_CONFIG" });
  if (resp?.backends?.length) {
    BACKENDS = resp.backends;
  } else {
    // Fallback defaults — updated to port 3006
    BACKENDS = [
      { name: "Backend A", url: "http://YOUR_VPS_IP:3006" },
      { name: "Backend B", url: "http://YOUR_VPS_IP:3006" },
    ];
  }

  // Update UI with backend names
  BACKENDS.forEach((b, i) => {
    const nameEl = document.getElementById(`name${i}`);
    if (nameEl) nameEl.textContent = b.name;
  });

  // Check connectivity
  await checkAllBackends();

  // Refresh status every 30s
  setInterval(checkAllBackends, 30000);

  await refreshPauseUI();
  await refreshEndpointUI();

  // Restore Telegram fields
  const data = await chrome.storage.local.get(["tgToken", "tgChatId"]);
  if (data.tgToken)  document.getElementById("tgToken").value  = data.tgToken;
  if (data.tgChatId) document.getElementById("tgChatId").value = data.tgChatId;
  if (data.tgToken && data.tgChatId) verifyTgBot(data.tgToken, data.tgChatId);
});

// ── Backend config handler in background ─────────────────────────────────────
// (background.js handles GET_BACKEND_CONFIG and returns CONFIG.BACKENDS)