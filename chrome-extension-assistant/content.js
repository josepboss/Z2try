// chrome-extension-assistant/content.js
// Minimal watchdog: detect modal and auto-refresh immediately

console.log('[Z2U-Assistant] 🚀 Script loaded - checking for modal on page');

// ── Check if chrome.runtime is available ─────────────────────────────────────
if (typeof chrome === 'undefined' || !chrome.runtime) {
  console.log('[Z2U-Assistant] ⚠️ chrome.runtime not available (injected in isolated world?)');
}

function safeRuntime() {
  try {
    return chrome?.runtime?.id ? chrome.runtime : null;
  } catch(e) {
    console.log('[Z2U-Assistant] chrome.runtime error:', e.message);
    return null;
  }
}

// ── Check if modal is visible ─────────────────────────────────────────────────
function isModalVisible() {
  // Check ALL .modalbox elements
  const modals = document.querySelectorAll('.modalbox');
  console.log('[Z2U-Assistant] Found', modals.length, 'modalbox elements');
  
  for (const modal of modals) {
    // Skip if display is none
    const style = window.getComputedStyle(modal);
    if (style.display === 'none') continue;
    
    // Check if it has a loading indicator (img or text)
    const hasLoadingImg = modal.querySelector('img') !== null;
    const hasLoadingText = /loading|please wait|processing/i.test(modal.textContent || '');
    
    if (hasLoadingImg || hasLoadingText) {
      console.log('[Z2U-Assistant] ✅ Modal detected! Has loading:', hasLoadingImg, 'text:', hasLoadingText);
      return true;
    }
  }
  
  // Also check for found_not div (404 modal)
  const notFound = document.querySelector('.found_not');
  if (notFound) {
    const style = window.getComputedStyle(notFound);
    if (style.display !== 'none') {
      console.log('[Z2U-Assistant] ✅ 404 modal detected!');
      return true;
    }
  }
  
  return false;
}

// ── Send detection to background ─────────────────────────────────────────────
function sendDetection(type) {
  console.log('[Z2U-Assistant] 🚨 Sending', type, 'to background');
  const runtime = safeRuntime();
  if (runtime) {
    chrome.runtime.sendMessage({ type })
      .then(() => console.log('[Z2U-Assistant] Message sent successfully'))
      .catch(e => console.log('[Z2U-Assistant] Message send failed:', e.message));
  } else {
    console.log('[Z2U-Assistant] Cannot send - runtime not available');
  }
}

// ── Main detection loop (runs every 300ms) ───────────────────────────────────
let lastDetected = false;
let detectionCount = 0;
let refreshTriggered = false;

function checkModal() {
  detectionCount++;
  
  // Check every 300ms
  if (detectionCount % 3 === 0) { // Log every ~1 second
    console.log('[Z2U-Assistant] Check #' + detectionCount + ' running...');
  }
  
  const hasModal = isModalVisible();
  
  // Only trigger when modal FIRST appears (not repeatedly)
  if (hasModal && !lastDetected && !refreshTriggered) {
    console.log('[Z2U-Assistant] 🎯 Modal appeared! Triggering refresh...');
    lastDetected = true;
    refreshTriggered = true;
    
    // Try background first
    sendDetection('MODAL_DETECTED');
    
    // Also trigger refresh directly
    console.log('[Z2U-Assistant] 🔄 Refreshing page now...');
    window.location.reload();
  } else if (!hasModal && lastDetected) {
    lastDetected = false;
    refreshTriggered = false;
    console.log('[Z2U-Assistant] Modal cleared');
  }
}

// ── Start polling immediately ─────────────────────────────────────────────────
console.log('[Z2U-Assistant] 🕵️ Starting modal detection polling (300ms)');

// Poll every 300ms
const pollInterval = setInterval(checkModal, 300);

// ── Also use MutationObserver for dynamic changes ───────────────────────────
const observer = new MutationObserver(() => {
  if (!refreshTriggered && isModalVisible()) {
    console.log('[Z2U-Assistant] MutationObserver detected modal change');
    checkModal();
  }
});

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  console.log('[Z2U-Assistant] 👁 MutationObserver active');
} else {
  // If body not ready, wait for it
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    console.log('[Z2U-Assistant] 👁 MutationObserver active (delayed init)');
  });
}

// ── Cleanup on page unload ───────────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  clearInterval(pollInterval);
  observer.disconnect();
  console.log('[Z2U-Assistant] 🧹 Cleanup done');
});

// Initial check
console.log('[Z2U-Assistant] 🔍 Initial check running...');
checkModal();