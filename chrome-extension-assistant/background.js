// chrome-extension-assistant/background.js
// Watchdog: Heartbeat monitoring, bot modal detection, tab recovery

(() => {
  'use strict';

  const LOG = (...a) => console.log('[Z2U-Assistant][BG]', ...a);
  const WARN = (...a) => console.warn('[Z2U-Assistant][BG]', ...a);

  // ── Configuration ───────────────────────────────────────────────────────────
  const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
  const HEARTBEAT_TIMEOUT_MS  = 5 * 60_000; // 5 minutes — if no heartbeat for 5 min, reopen page
  const TARGET_URL = 'https://www.z2u.com/sellOrder/index';

  // ── State ──────────────────────────────────────────────────────────────────
  const activeTabs = new Map(); // tabId → { lastHeartbeat, url }
  let lastGlobalHeartbeat = Date.now(); // Track global last heartbeat time
  let recoveryInProgress = false; // Prevent multiple recovery attempts

  // ── Check if a URL matches the TARGET_URL pattern ───────────────────────────
  function isSellOrderTab(url) {
    if (!url) return false;
    // Match exactly sellOrder/index — not any Z2U page
    return /z2u\.com\/sellOrder\/index/i.test(url);
  }

  // ── Recovery logic: Close and reopen only the affected tab ──────────────────
  async function triggerRecovery(tabId, reason) {
    LOG(`Triggering recovery for tab ${tabId} due to ${reason}`);

    let currentUrl = TARGET_URL;
    try {
      const tab = await chrome.tabs.get(tabId);
      currentUrl = tab.url || TARGET_URL;
    } catch (e) {
      WARN(`Could not get tab ${tabId} info:`, e.message);
    }

    // Close the problematic tab
    try {
      await chrome.tabs.remove(tabId);
      LOG(`Tab ${tabId} closed`);
    } catch (e) {
      WARN(`Failed to close tab ${tabId}:`, e.message);
    }

    // Reopen fresh tab after brief delay
    setTimeout(() => {
      chrome.tabs.create({
        url: currentUrl.includes('z2u.com') ? currentUrl : TARGET_URL,
        active: true,
      });
      LOG(`Opened new tab at ${currentUrl}`);
    }, 1500);
  }

  // ── Recovery logic: Reopen sellOrder/index when ALL tabs are closed for too long ─────
  async function checkGlobalHeartbeat() {
    const now = Date.now();
    const timeSinceLastHeartbeat = now - lastGlobalHeartbeat;
    
    LOG(`[HEARTBEAT CHECK] Time since last heartbeat: ${Math.round(timeSinceLastHeartbeat / 1000)}s (timeout: ${HEARTBEAT_TIMEOUT_MS / 1000}s)`);
    
    if (timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT_MS && !recoveryInProgress) {
      LOG(`[RECOVERY] No heartbeat for ${Math.round(timeSinceLastHeartbeat / 1000)}s — checking if sellOrder/index is open...`);
      
      // Check if sellOrder/index tab is currently open
      const allTabs = await chrome.tabs.query({});
      const sellOrderTabs = allTabs.filter(tab => isSellOrderTab(tab.url));
      
      LOG(`[RECOVERY] Found ${allTabs.length} total tabs, ${sellOrderTabs.length} sellOrder/index tabs`);
      
      if (sellOrderTabs.length === 0) {
        LOG(`[RECOVERY] sellOrder/index NOT open! Reopening ${TARGET_URL}`);
        recoveryInProgress = true;
        
        try {
          await chrome.tabs.create({
            url: TARGET_URL,
            active: true,
          });
          LOG(`[RECOVERY] ✅ Successfully reopened ${TARGET_URL}`);
        } catch (e) {
          WARN(`[RECOVERY] Failed to reopen page:`, e.message);
        }
        
        // Reset recovery flag after 10 seconds to allow future recoveries
        setTimeout(() => {
          recoveryInProgress = false;
          LOG(`[RECOVERY] Recovery flag reset`);
        }, 10000);
      } else {
        LOG(`[RECOVERY] sellOrder/index tab is still open (${sellOrderTabs.length} tab(s)) — no need to reopen`);
        // Reset the global heartbeat since tab is still alive
        lastGlobalHeartbeat = now;
      }
    }
  }

  // ── Message handling ────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!sender.tab?.id) return;

    if (msg.type === 'HEARTBEAT') {
      const now = Date.now();
      lastGlobalHeartbeat = now; // Update global heartbeat
      activeTabs.set(sender.tab.id, {
        lastHeartbeat: now,
        url: sender.tab.url || '',
      });
      LOG(`[HEARTBEAT] Received from tab ${sender.tab.id} — global heartbeat updated`);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === 'MODAL_DETECTED' || msg.type === '404_DETECTED') {
      LOG(`${msg.type} detected on tab ${sender.tab.id}`);
      triggerRecovery(sender.tab.id, msg.type === 'MODAL_DETECTED' ? 'modalbox' : 'fake_404');
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === 'PROCESS_SANDBOX_DATA') {
      // Forward to VPS backend
      (async () => {
        try {
          const { serverUrl } = await chrome.storage.local.get('serverUrl');
          const base = serverUrl || 'https://z2.itspanel.com';
          
          const resp = await fetch(`${base}/api/sandbox/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg.payload),
          });
          
          if (!resp.ok) {
            const text = await resp.text();
            sendResponse({ ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` });
            return;
          }
          
          const blob = await resp.blob();
          const arrayBuffer = await blob.arrayBuffer();
          sendResponse({
            ok: true,
            filledBytes: Array.from(new Uint8Array(arrayBuffer)),
          });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true; // Keep channel open
    }
  });

  // ── Heartbeat watchdog ───────────────────────────────────────────────────────
  chrome.alarms.create('heartbeat_watchdog', { periodInMinutes: 0.5 });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'heartbeat_watchdog') return;

    const now = Date.now();
    const staleTabIds = [];

    // Check for stale individual tabs
    for (const [tabId, data] of activeTabs.entries()) {
      if (!data.lastHeartbeat || (now - data.lastHeartbeat > HEARTBEAT_TIMEOUT_MS)) {
        staleTabIds.push(tabId);
      }
    }

    if (staleTabIds.length) {
      LOG(`Found ${staleTabIds.length} stale tab(s):`, staleTabIds);
      for (const tid of staleTabIds) {
        activeTabs.delete(tid);
        chrome.tabs.create({ url: TARGET_URL, active: true });
      }
    }

    // Also check global heartbeat (for when ALL tabs are closed)
    checkGlobalHeartbeat();
  });

  // ── Cleanup on tab close ────────────────────────────────────────────────────
  chrome.tabs.onRemoved.addListener((tabId) => {
    activeTabs.delete(tabId);
    LOG(`Tab ${tabId} removed from active tabs`);
  });

  LOG('Z2U Assistant background started');
  LOG(`Target URL: ${TARGET_URL}`);
  LOG(`Heartbeat timeout: ${HEARTBEAT_TIMEOUT_MS / 1000}s`);
})();