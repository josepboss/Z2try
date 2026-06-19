// chrome-extension-assistant/sandbox.js
// Minimal sandbox: UI only, all processing happens on backend via XML surgery

(() => {
  'use strict';

  const LOG = (...a) => console.log('[Z2U-Assistant][SB]', ...a);
  const statusEl = document.getElementById('status');
  const configStatusEl = document.getElementById('configStatus');
  const serverUrlInput = document.getElementById('serverUrl');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  const mappingList = document.getElementById('mappingList');
  const addMappingBtn = document.getElementById('addMappingBtn');
  const customSepContainer = document.getElementById('customSepContainer');
  const customSeparatorInput = document.getElementById('customSeparator');

  // ── State ───────────────────────────────────────────────────────────────────
  let templateBytes = null;
  let templateFilename = 'template.xlsx';

  // ── Load saved config ───────────────────────────────────────────────────────
  async function loadConfig() {
    const { serverUrl } = await chrome.storage.local.get('serverUrl');
    if (serverUrl) {
      serverUrlInput.value = serverUrl;
      configStatusEl.textContent = `✅ Backend: ${serverUrl}`;
      configStatusEl.className = 'status ok';
    } else {
      configStatusEl.textContent = '❌ Backend URL not set — enter your VPS URL above';
      configStatusEl.className = 'status err';
    }
  }

  // ── Save config ─────────────────────────────────────────────────────────────
  saveConfigBtn.addEventListener('click', async () => {
    const url = serverUrlInput.value.trim();
    if (!url) {
      configStatusEl.textContent = '❌ Please enter a valid URL';
      configStatusEl.className = 'status err';
      return;
    }

    try {
      new URL(url); // Validate format
    } catch (e) {
      configStatusEl.textContent = '❌ Invalid URL format (use http://IP:PORT or https://domain.com)';
      configStatusEl.className = 'status err';
      return;
    }

    await chrome.storage.local.set({ serverUrl: url });
    configStatusEl.textContent = `✅ Saved: ${url}`;
    configStatusEl.className = 'status ok';
    
    // Test connection
    setStatus('⏳ Testing connection...', 'info');
    try {
      const resp = await fetch(`${url}/api/healthz`, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        setStatus('✅ Backend connected successfully!', 'ok');
      } else {
        setStatus(`❌ Backend returned HTTP ${resp.status}`, 'err');
      }
    } catch (e) {
      setStatus(`❌ Cannot reach backend: ${e.message}`, 'err');
    }
  });

  // ── Separator handling ──────────────────────────────────────────────────────
  document.querySelectorAll('input[name="separator"]').forEach(radio => {
    radio.addEventListener('change', () => {
      customSepContainer.classList.toggle('show', radio.value === 'custom');
    });
  });

  function getSeparator() {
    const selected = document.querySelector('input[name="separator"]:checked')?.value;
    if (selected === 'custom') {
      return customSeparatorInput.value || '|';
    }
    return selected;
  }

  // ── Template upload ─────────────────────────────────────────────────────────
  document.getElementById('templateInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus('⏳ Reading template...', 'info');
    try {
      const arrayBuffer = await file.arrayBuffer();
      templateBytes = Array.from(new Uint8Array(arrayBuffer));
      templateFilename = file.name;
      
      document.getElementById('templateInfo').textContent = 
        `✅ Loaded: ${file.name} (${templateBytes.length.toLocaleString()} bytes)`;
      setStatus('✅ Template loaded — configure column mapping below', 'ok');
    } catch (err) {
      setStatus(`❌ Template read failed: ${err.message}`, 'err');
      templateBytes = null;
    }
  });

  // ── Dynamic mapping UI ───────────────────────────────────────────────────────
  let mappingEntries = [
    { id: 1, field: 'username', column: 'A' },
    { id: 2, field: 'password', column: 'B' },
    { id: 3, field: 'email', column: 'C' },
    { id: 4, field: 'email_password', column: 'D' }
  ];

  function renderMappingList() {
    mappingList.innerHTML = '';
    
    mappingEntries.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'field-row';
      row.innerHTML = `
        <label>Field name</label>
        <input type="text" class="field-name-input" value="${entry.field}" placeholder="e.g., username" />
        <label>Column</label>
        <input type="text" class="column-input" value="${entry.column}" placeholder="A" maxlength="3" style="width:60px;text-transform:uppercase" />
        <button type="button" class="remove-btn" data-id="${entry.id}">×</button>
      `;
      mappingList.appendChild(row);
    });

    // Event listeners
    mappingList.querySelectorAll('.field-name-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const id = parseInt(e.target.nextElementSibling.nextElementSibling.dataset.id);
        const entry = mappingEntries.find(e => e.id === id);
        if (entry) entry.field = e.target.value.trim() || `field_${id}`;
      });
    });

    mappingList.querySelectorAll('.column-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const id = parseInt(e.target.nextElementSibling.dataset.id);
        const entry = mappingEntries.find(e => e.id === id);
        if (entry) entry.column = e.target.value.toUpperCase();
      });
    });

    mappingList.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        mappingEntries = mappingEntries.filter(e => e.id !== id);
        renderMappingList();
      });
    });
  }

  addMappingBtn.addEventListener('click', () => {
    const newId = Math.max(0, ...mappingEntries.map(e => e.id)) + 1;
    mappingEntries.push({
      id: newId,
      field: `field_${newId}`,
      column: 'A'
    });
    renderMappingList();
  });

  // ── Check backend connectivity ──────────────────────────────────────────────
  async function checkBackend() {
    const { serverUrl } = await chrome.storage.local.get('serverUrl');
    if (!serverUrl) {
      setStatus('❌ Backend URL not set. Enter it in the configuration box above.', 'err');
      return false;
    }
    try {
      const resp = await fetch(`${serverUrl}/api/healthz`, { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) {
        setStatus(`❌ Backend unreachable: HTTP ${resp.status}`, 'err');
        return false;
      }
      return true;
    } catch (e) {
      setStatus(`❌ Cannot reach backend at ${serverUrl}: ${e.message}`, 'err');
      return false;
    }
  }

  // ── Process button ───────────────────────────────────────────────────────────
  document.getElementById('processBtn').addEventListener('click', async () => {
    if (!templateBytes) {
      setStatus('❌ Please upload a template file first', 'err');
      return;
    }

    const dataText = document.getElementById('dataInput').value.trim();
    if (!dataText) {
      setStatus('❌ Please paste data to process', 'err');
      return;
    }

    // Validate mappings
    const validMappings = mappingEntries.filter(e => e.field && e.column);
    if (validMappings.length === 0) {
      setStatus('❌ Please add at least one field mapping', 'err');
      return;
    }

    // Check backend first
    const backendOk = await checkBackend();
    if (!backendOk) return;

    // Parse data rows
    const separator = getSeparator();
    const rows = dataText.split('\n').filter(Boolean);
    const dataRows = rows.map(line => {
      const parts = line.split(separator).map(p => p.trim());
      const row = {};
      validMappings.forEach((entry, idx) => {
        row[entry.field] = parts[idx] || '';
      });
      return row;
    });

    // Build columnMap for backend
    const columnMap = {};
    validMappings.forEach(entry => {
      columnMap[entry.field] = entry.column;
    });

    setStatus('⏳ Sending to backend for XML surgery...', 'info');

    // Send to background for processing
    chrome.runtime.sendMessage({
      type: 'PROCESS_SANDBOX_DATA',
      payload: {
        templateBytes: templateBytes,
        templateFilename: templateFilename,
        dataRows: dataRows,
        columnMap: columnMap,
      },
    }, (resp) => {
      console.log('Sandbox response:', resp);
      if (!resp?.ok) {
        setStatus(`❌ Backend error: ${resp?.error || 'unknown (no error message)'}`, 'err');
        return;
      }
      if (!resp.filledBytes?.length) {
        setStatus('❌ No data returned from backend', 'err');
        return;
      }

      // Download the filled file
      const blob = new Blob([new Uint8Array(resp.filledBytes)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Z2U_sandbox_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus('✅ File generated and downloaded', 'ok');
    });
  });

  // ── Status helper ───────────────────────────────────────────────────────────
  function setStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = `status ${type}`;
  }

  // ── Initialize ──────────────────────────────────────────────────────────────
  loadConfig();
  renderMappingList();
  setStatus('Ready to process — configure backend URL above', 'info');
})();