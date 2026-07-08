import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAPPINGS_FILE    = path.resolve(__dirname, "../../mappings.json");
const CACHE_DIR        = path.resolve(__dirname, "../../order-cache");
const ANALYTICS_FILE   = path.resolve(__dirname, "../../analytics.json");
const HEAL_CONFIG_FILE = path.resolve(__dirname, "../../heal-config.json");

interface AnalyticsRecord {
  orderId:    string;
  title:      string;
  quantity:   number;
  amount:     number | null;
  date:       string;
  recordedAt: string;
}

interface HealConfig {
  openrouterApiKey?: string;
  healModel?: string;
}

type DeliveryMethod = "file" | "direct" | "chat";

interface MappingEntry {
  serviceId: string;
  columnMap?: Record<string, string>;
  deliveryMethod?: DeliveryMethod;
  separator?: string;
}

function loadAnalytics(): AnalyticsRecord[] {
  if (!fs.existsSync(ANALYTICS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(ANALYTICS_FILE, "utf-8")); }
  catch { return []; }
}

function saveAnalytics(records: AnalyticsRecord[]): void {
  fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(records, null, 2));
}

function loadHealConfig(): HealConfig {
  if (!fs.existsSync(HEAL_CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(HEAL_CONFIG_FILE, "utf-8")); }
  catch { return {}; }
}

function saveHealConfig(config: HealConfig): void {
  fs.writeFileSync(HEAL_CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadMappings(): Record<string, string | MappingEntry> {
  if (!fs.existsSync(MAPPINGS_FILE)) return {};
  return JSON.parse(fs.readFileSync(MAPPINGS_FILE, "utf-8"));
}

function saveMappings(data: Record<string, string | MappingEntry>): void {
  fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(data, null, 2));
}

function listCachedOrders(): { orderId: string; bytes: number; mtime: string }[] {
  if (!fs.existsSync(CACHE_DIR)) return [];
  return fs
    .readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith(".xlsx"))
    .map((f) => {
      const stat = fs.statSync(path.join(CACHE_DIR, f));
      return { orderId: f.replace(".xlsx", ""), bytes: stat.size, mtime: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

const router = Router();

const DEFAULT_COLUMN_MAP: Record<string, string> = { email: "A", password: "B" };

router.get("/admin", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(
    "<!DOCTYPE html>\n" +
    "<html lang=\"en\">\n" +
    "<head>\n" +
    "<meta charset=\"UTF-8\"/>\n" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>\n" +
    "<title>Z2U Admin</title>\n" +
    "<style>\n" +
    "*{box-sizing:border-box;margin:0;padding:0}\n" +
    "body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;padding:2rem}\n" +
    "h1{font-size:1.6rem;font-weight:700;margin-bottom:.25rem;color:#f8fafc}\n" +
    ".sub{color:#94a3b8;font-size:.875rem;margin-bottom:2rem}\n" +
    ".card{background:#1e293b;border:1px solid #334155;border-radius:.75rem;padding:1.5rem;margin-bottom:1.5rem}\n" +
    "h2{font-size:1rem;font-weight:600;margin-bottom:1rem;color:#cbd5e1}\n" +
    "label{display:block;font-size:.8rem;color:#94a3b8;margin-bottom:.3rem;margin-top:.75rem}\n" +
    "input,select{width:100%;padding:.5rem .75rem;background:#0f172a;border:1px solid #334155;border-radius:.375rem;color:#e2e8f0;font-size:.875rem}\n" +
    "input:focus,select:focus{outline:2px solid #6366f1;border-color:#6366f1}\n" +
    "button{margin-top:1rem;padding:.5rem 1.25rem;background:#6366f1;color:#fff;border:none;border-radius:.375rem;cursor:pointer;font-size:.875rem;font-weight:500}\n" +
    "button:hover{background:#4f46e5}\n" +
    "button.danger{background:#ef4444}\n" +
    "button.danger:hover{background:#dc2626}\n" +
    "button.dl{background:#0369a1;margin-top:0}\n" +
    "button.dl:hover{background:#0284c7}\n" +
    "button.pg{margin-top:0;padding:.3rem .75rem;background:#1e293b;border:1px solid #334155;font-size:.8rem;color:#cbd5e1}\n" +
    "button.pg:hover:not(:disabled){background:#334155}\n" +
    "button.pg:disabled{opacity:.35;cursor:default}\n" +
    "button.add-row{background:#059669;padding:.3rem .75rem;font-size:.75rem;margin-top:0}\n" +
    "button.add-row:hover{background:#047857}\n" +
    "button.remove-row{background:#dc2626;padding:.15rem .4rem;font-size:.7rem;margin-top:0;color:#fff;border:none;border-radius:.25rem;cursor:pointer}\n" +
    "button.remove-row:hover{background:#b91c1c}\n" +
    ".badge{background:#6366f1;color:#fff;font-size:.65rem;font-weight:700;border-radius:.25rem;padding:.1rem .35rem;vertical-align:middle;margin-left:.35rem}\n" +
    "table{width:100%;border-collapse:collapse;font-size:.85rem}\n" +
    "th{text-align:left;padding:.5rem .75rem;background:#0f172a;color:#94a3b8;font-weight:500;border-bottom:1px solid #334155}\n" +
    "td{padding:.5rem .75rem;border-bottom:1px solid #1e293b;vertical-align:middle}\n" +
    "tr:hover td{background:#0f172a}\n" +
    ".tag{display:inline-block;padding:.15rem .5rem;border-radius:.25rem;font-size:.75rem;background:#312e81;color:#a5b4fc}\n" +
    ".badge-tag{display:inline-block;padding:.15rem .5rem;border-radius:.25rem;font-size:.75rem;background:#064e3b;color:#6ee7b7}\n" +
    ".chat-tag{display:inline-block;padding:.15rem .5rem;border-radius:.25rem;font-size:.75rem;background:#7c3aed;color:#c4b5fd}\n" +
    "#msg{padding:.5rem 1rem;border-radius:.375rem;margin-bottom:1rem;font-size:.875rem;display:none}\n" +
    ".ok{background:#064e3b;color:#6ee7b7}\n" +
    ".err{background:#7f1d1d;color:#fca5a5}\n" +
    ".info{background:#1e3a8a;color:#93c5fd}\n" +
    ".col-map-section{margin-top:.75rem;padding:1rem;background:#0f172a;border-radius:.5rem}\n" +
    ".col-map-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem}\n" +
    ".col-map-header span{font-size:.9rem;font-weight:600;color:#cbd5e1}\n" +
    ".col-map-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem}\n" +
    ".col-map-row label.field-lbl{margin:0;font-size:.8rem;color:#94a3b8;flex:0 0 auto;width:130px}\n" +
    ".col-map-row input.field-name{flex:1;padding:.35rem .5rem;font-size:.8rem;background:#1e293b;border:1px solid #334155;border-radius:.25rem;color:#e2e8f0}\n" +
    ".col-map-row label.col-lbl{margin:0;font-size:.8rem;color:#94a3b8;flex:0 0 auto;width:60px;text-align:center}\n" +
    ".col-map-row input.col-letter{flex:0 0 auto;width:60px;padding:.35rem .5rem;font-size:.8rem;background:#1e293b;border:1px solid #334155;border-radius:.25rem;color:#e2e8f0;text-align:center;text-transform:uppercase}\n" +
    ".col-map-row .remove-btn{flex:0 0 auto;padding:.2rem .4rem;font-size:.7rem;background:#dc2626;color:#fff;border:none;border-radius:.25rem;cursor:pointer}\n" +
    ".col-map-row .remove-btn:hover{background:#b91c1c}\n" +
    ".col-map-preview{margin-top:.75rem;font-size:.75rem;color:#64748b}\n" +
    ".preset-btns{display:flex;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap}\n" +
    ".preset-btns button{background:#1e293b;border:1px solid #334155;color:#cbd5e1;padding:.25rem .6rem;font-size:.7rem;border-radius:.25rem;cursor:pointer;margin-top:.3rem}\n" +
    ".preset-btns button:hover{background:#334155}\n" +
    ".hint{font-size:.75rem;color:#64748b;margin-top:.3rem}\n" +
    ".separator-row{display:flex;align-items:center;gap:.5rem;margin-top:.5rem}\n" +
    ".separator-row label{margin:0;font-size:.8rem;color:#94a3b8;flex:0 0 auto;width:150px}\n" +
    ".separator-row input{flex:1;padding:.35rem .5rem;font-size:.8rem;background:#1e293b;border:1px solid #334155;border-radius:.25rem;color:#e2e8f0}\n" +
    ".delivery-hint{padding:.5rem .75rem;background:#1e1b4b;border:1px solid #4c1d95;border-radius:.375rem;font-size:.8rem;color:#c4b5fd;margin-top:.5rem}\n" +
    ".delivery-hint strong{color:#a78bfa}\n" +
    "</style>\n" +
    "</head>\n" +
    "<body>\n" +
    "<h1>Z2U &harr; Lfollowers Admin</h1>\n" +
    "<p class=\"sub\">Map Z2U Offer Titles to Lfollowers Product IDs for automated order processing.</p>\n" +
    "<div id=\"msg\"></div>\n" +
    "\n" +
    "<div class=\"card\">\n" +
    "  <h2>Daily Revenue</h2>\n" +
    "  <div id=\"analyticsToday\" style=\"display:flex;gap:2.5rem;margin-bottom:1.25rem\"></div>\n" +
    "  <table id=\"analyticsTable\">\n" +
    "    <thead><tr><th>Date</th><th>Orders</th><th>Revenue (USD)</th><th>Avg / Order</th></tr></thead>\n" +
    "    <tbody id=\"analyticsBody\"><tr><td colspan=\"4\" style=\"color:#64748b\">Loading...</td></tr></tbody>\n" +
    "  </table>\n" +
    "  <div style=\"display:flex;align-items:center;justify-content:flex-end;gap:.75rem;margin-top:.75rem\">\n" +
    "    <button id=\"analyticsPrev\" class=\"pg\" onclick=\"_analyticsPage--;renderAnalyticsPage()\" disabled>&larr; Prev</button>\n" +
    "    <span id=\"analyticsPageInfo\" style=\"font-size:.8rem;color:#94a3b8\"></span>\n" +
    "    <button id=\"analyticsNext\" class=\"pg\" onclick=\"_analyticsPage++;renderAnalyticsPage()\" disabled>Next &rarr;</button>\n" +
    "  </div>\n" +
    "</div>\n" +
    "\n" +
    "<div class=\"card\">\n" +
    "  <h2>Order Records <span style=\"font-size:.75rem;color:#64748b;font-weight:400\">(individual)</span></h2>\n" +
    "  <table>\n" +
    "    <thead><tr><th>Order ID</th><th>Title</th><th>Date</th><th>Amount</th><th></th></tr></thead>\n" +
    "    <tbody id=\"recordsBody\"><tr><td colspan=\"5\" style=\"color:#64748b\">Loading...</td></tr></tbody>\n" +
    "  </table>\n" +
    "  <div style=\"display:flex;align-items:center;justify-content:flex-end;gap:.75rem;margin-top:.75rem\">\n" +
    "    <button id=\"recordsPrev\" class=\"pg\" onclick=\"_recordsPage--;renderRecordsPage()\" disabled>&larr; Prev</button>\n" +
    "    <span id=\"recordsPageInfo\" style=\"font-size:.8rem;color:#94a3b8\"></span>\n" +
    "    <button id=\"recordsNext\" class=\"pg\" onclick=\"_recordsPage++;renderRecordsPage()\" disabled>Next &rarr;</button>\n" +
    "  </div>\n" +
    "</div>\n" +
    "\n" +
    "<div class=\"card\">\n" +
    "  <h2>Add / Update Mapping</h2>\n" +
    "  <label>Z2U Offer Title (exact match)</label>\n" +
    "  <input id=\"title\" placeholder=\"e.g. FIFA 25 PS4 Coins 1M\" />\n" +
    "  <label>Lfollowers Product</label>\n" +
    "  <select id=\"serviceSelect\"><option value=\"\">-- loading products... --</option></select>\n" +
    "  <label>Or enter Product ID manually</label>\n" +
    "  <input id=\"serviceId\" placeholder=\"e.g. 1234\" />\n" +
    "  <label>Delivery Method</label>\n" +
    "  <select id=\"deliveryMethod\">\n" +
    "    <option value=\"file\">File (XLSX upload)</option>\n" +
    "    <option value=\"direct\">Direct (paste credentials)</option>\n" +
    "    <option value=\"chat\">Chat (M3U link &rarr; form fill &rarr; chat message)</option>\n" +
    "  </select>\n" +
    "  <div id=\"chatDeliveryHint\" class=\"delivery-hint\" style=\"display:none\">\n" +
    "    <strong>Chat Delivery:</strong> For IPTV/M3U subscription orders. The extension parses the M3U URL from Lfollowers, auto-fills the Z2U delivery form fields (Login Account, Password, Domain), and sends formatted credentials via Z2U chat.\n" +
    "  </div>\n" +
    "  <label>Column Map <span style=\"color:#64748b;font-size:.7rem\">(for File delivery only)</span></label>\n" +
    "  <div class=\"preset-btns\">\n" +
    "    <button onclick=\"applyPreset('email')\">Preset: Email/Password</button>\n" +
    "    <button onclick=\"applyPreset('username')\">Preset: Username/Password</button>\n" +
    "    <button onclick=\"applyPreset('full')\">Preset: Full (user|pass|email|email_pass)</button>\n" +
    "    <button onclick=\"clearPreset()\">Clear All</button>\n" +
    "  </div>\n" +
    "  <div class=\"col-map-section\">\n" +
    "    <div class=\"col-map-header\"><span>Field Name</span><span>Column</span><span></span></div>\n" +
    "    <div id=\"colMapRows\"></div>\n" +
    "    <button type=\"button\" class=\"add-row\" onclick=\"addColMapRow()\">+ Add Field</button>\n" +
    "  </div>\n" +
    "  <div class=\"col-map-preview\" id=\"colMapPreview\">Preview: {}</div>\n" +
    "  <label style=\"margin-top:1rem\">Custom Separator <span style=\"color:#64748b;font-size:.7rem\">(optional)</span></label>\n" +
    "  <div class=\"separator-row\">\n" +
    "    <input type=\"text\" id=\"separatorInput\" placeholder=\"e.g. | or : or :: \" style=\"max-width:200px\" />\n" +
    "    <span style=\"font-size:.7rem;color:#64748b\">Leave empty to use default (:)</span>\n" +
    "  </div>\n" +
    "  <button onclick=\"addMapping()\" id=\"saveMappingBtn\">Save Mapping</button>\n" +
    "</div>\n" +
    "\n" +
    "<div class=\"card\">\n" +
    "  <h2>Healer Settings</h2>\n" +
    "  <p class=\"hint\">Configure OpenRouter credentials used by <code>/api/heal</code> for selector healing.</p>\n" +
    "  <label>OpenRouter API Key</label>\n" +
    "  <input id=\"healApiKey\" placeholder=\"sk-or-v1-...\" autocomplete=\"off\" />\n" +
    "  <label>Model</label>\n" +
    "  <input id=\"healModel\" placeholder=\"google/gemini-1.5-flash\" />\n" +
    "  <button onclick=\"saveHealConfig()\">Save Healer Config</button>\n" +
    "</div>\n" +
    "\n" +
    "<div class=\"card\">\n" +
    "  <h2>Current Mappings</h2>\n" +
    "  <table id=\"mappingsTable\">\n" +
    "    <thead><tr><th>Z2U Title</th><th>Product ID</th><th>Delivery</th><th>Separator</th><th>Column Map</th><th>Action</th></tr></thead>\n" +
    "    <tbody id=\"mappingsBody\"><tr><td colspan=\"6\" style=\"color:#64748b\">Loading...</td></tr></tbody>\n" +
    "  </table>\n" +
    "</div>\n" +
    "\n" +
    "<div class=\"card\">\n" +
    "  <h2>Processed Orders <span id=\"orderCount\" style=\"color:#64748b;font-weight:400;font-size:.8rem\"></span></h2>\n" +
    "  <p class=\"hint\">Each order is processed only once; retries serve the cached file.</p>\n" +
    "  <table>\n" +
    "    <thead><tr><th>Order ID</th><th>Size</th><th>Processed At</th><th>Download</th></tr></thead>\n" +
    "    <tbody id=\"ordersBody\"><tr><td colspan=\"4\" style=\"color:#64748b\">Loading...</td></tr></tbody>\n" +
    "  </table>\n" +
    "  <button class=\"danger\" style=\"margin-top:1rem\" onclick=\"clearAllOrders()\">Clear All Cached Orders</button>\n" +
    "</div>\n" +
    "\n" +
    "<script>\n" +
    "document.getElementById('deliveryMethod').addEventListener('change', function() {\n" +
    "  document.getElementById('chatDeliveryHint').style.display = this.value === 'chat' ? 'block' : 'none';\n" +
    "});\n" +
    "\n" +
    "var PRESETS = {\n" +
    "  email: [{field:'email',column:'A'},{field:'password',column:'B'}],\n" +
    "  username: [{field:'username',column:'A'},{field:'password',column:'B'}],\n" +
    "  full: [{field:'username',column:'A'},{field:'password',column:'B'},{field:'email',column:'C'},{field:'email_password',column:'D'}]\n" +
    "};\n" +
    "\n" +
    "function applyPreset(name) {\n" +
    "  var preset = PRESETS[name];\n" +
    "  if (!preset) return;\n" +
    "  colMapEntries = preset.map(function(p,i){ return {id:Date.now()+i,field:p.field,column:p.column}; });\n" +
    "  renderColMapRows();\n" +
    "  updateColMapPreview();\n" +
    "}\n" +
    "\n" +
    "function clearPreset() {\n" +
    "  colMapEntries = [];\n" +
    "  renderColMapRows();\n" +
    "  updateColMapPreview();\n" +
    "}\n" +
    "\n" +
    "var colMapEntries = [\n" +
    "  {id:1,field:'email',column:'A'},\n" +
    "  {id:2,field:'password',column:'B'}\n" +
    "];\n" +
    "var colMapCounter = 3;\n" +
    "\n" +
    "function addColMapRow(fld, col) {\n" +
    "  colMapEntries.push({id:colMapCounter++,field:fld||'',column:col||'A'});\n" +
    "  renderColMapRows();\n" +
    "  updateColMapPreview();\n" +
    "}\n" +
    "\n" +
    "function removeColMapRow(id) {\n" +
    "  colMapEntries = colMapEntries.filter(function(e){ return e.id !== id; });\n" +
    "  renderColMapRows();\n" +
    "  updateColMapPreview();\n" +
    "}\n" +
    "\n" +
    "function onColMapFieldChange(id, val) {\n" +
    "  var e = colMapEntries.find(function(x){ return x.id === id; });\n" +
    "  if (e) e.field = val.trim();\n" +
    "  updateColMapPreview();\n" +
    "}\n" +
    "\n" +
    "function onColMapColChange(id, val) {\n" +
    "  var e = colMapEntries.find(function(x){ return x.id === id; });\n" +
    "  if (e) e.column = val.trim().toUpperCase().replace(/[^A-Z]/g,'').slice(0,3);\n" +
    "  updateColMapPreview();\n" +
    "}\n" +
    "\n" +
    "function renderColMapRows() {\n" +
    "  var html = colMapEntries.map(function(e){\n" +
    "    return '<div class=\"col-map-row\">' +\n" +
    "      '<label class=\"field-lbl\">Field name</label>' +\n" +
    "      '<input type=\"text\" class=\"field-name\" value=\"' + e.field + '\" placeholder=\"e.g. username\" maxlength=\"50\" ' +\n" +
    "        'oninput=\"onColMapFieldChange(' + e.id + ',this.value)\" />' +\n" +
    "      '<label class=\"col-lbl\">Column</label>' +\n" +
    "      '<input type=\"text\" class=\"col-letter\" value=\"' + e.column + '\" placeholder=\"A\" maxlength=\"3\" ' +\n" +
    "        'oninput=\"onColMapColChange(' + e.id + ',this.value)\" />' +\n" +
    "      '<button type=\"button\" class=\"remove-btn\" onclick=\"removeColMapRow(' + e.id + ')\">x</button>' +\n" +
    "    '</div>';\n" +
    "  }).join('');\n" +
    "  document.getElementById('colMapRows').innerHTML = html;\n" +
    "}\n" +
    "\n" +
    "function buildColMap() {\n" +
    "  var m = {};\n" +
    "  colMapEntries.forEach(function(e){\n" +
    "    var f = e.field.trim(), c = e.column.trim().toUpperCase().replace(/[^A-Z]/g,'').slice(0,3);\n" +
    "    if (f && c) m[f] = c;\n" +
    "  });\n" +
    "  return Object.keys(m).length ? m : null;\n" +
    "}\n" +
    "\n" +
    "function updateColMapPreview() {\n" +
    "  document.getElementById('colMapPreview').textContent = 'Preview: ' + JSON.stringify(buildColMap()||{});\n" +
    "}\n" +
    "\n" +
    "function showMsg(text, ok) {\n" +
    "  var el = document.getElementById('msg');\n" +
    "  el.textContent = text;\n" +
    "  el.className = ok ? 'ok' : 'err';\n" +
    "  el.style.display = 'block';\n" +
    "  setTimeout(function(){ el.style.display='none'; }, 3500);\n" +
    "}\n" +
    "\n" +
    "async function loadServices() {\n" +
    "  try {\n" +
    "    var res = await fetch('/api/admin/services');\n" +
    "    var data = await res.json();\n" +
    "    var sel = document.getElementById('serviceSelect');\n" +
    "    sel.innerHTML = '<option value=\"\">-- select product --</option>';\n" +
    "    if (data.data && Array.isArray(data.data)) {\n" +
    "      data.data.forEach(function(s){\n" +
    "        var o = document.createElement('option');\n" +
    "        o.value = s.product_id;\n" +
    "        o.textContent = '[' + s.product_id + '] ' + s.name + ' | Stock: ' + s.quantity + ' | $' + s.price;\n" +
    "        sel.appendChild(o);\n" +
    "      });\n" +
    "    }\n" +
    "  } catch(e) { console.error(e); }\n" +
    "}\n" +
    "\n" +
    "async function loadMappings() {\n" +
    "  var res = await fetch('/api/admin/mappings');\n" +
    "  var data = await res.json();\n" +
    "  var tbody = document.getElementById('mappingsBody');\n" +
    "  var entries = Object.entries(data);\n" +
    "  if (!entries.length) {\n" +
    "    tbody.innerHTML = '<tr><td colspan=\"6\" style=\"color:#64748b\">No mappings yet.</td></tr>';\n" +
    "    return;\n" +
    "  }\n" +
    "  tbody.innerHTML = entries.map(function(entry){\n" +
    "    var title = entry[0], conf = entry[1];\n" +
    "    var serviceId = typeof conf === 'string' ? conf : (conf.serviceId||'');\n" +
    "    var deliveryMethod = typeof conf === 'string' ? 'file' : (conf.deliveryMethod||'file');\n" +
    "    var separator = typeof conf === 'string' ? null : (conf.separator||null);\n" +
    "    var columnMap = typeof conf === 'string' ? {email:'A',password:'B'} : (conf.columnMap||{email:'A',password:'B'});\n" +
    "    var tagClass = deliveryMethod === 'chat' ? 'chat-tag' : 'tag';\n" +
    "    return '<tr><td>' + title + '</td><td><span class=\"tag\">' + serviceId + '</span></td>' +\n" +
    "      '<td><span class=\"' + tagClass + '\">' + deliveryMethod + '</span></td>' +\n" +
    "      '<td><span class=\"tag\">' + (separator||'default (:)') + '</span></td>' +\n" +
    "      '<td style=\"max-width:220px;white-space:pre-wrap;word-break:break-word;color:#94a3b8\">' + JSON.stringify(columnMap) + '</td>' +\n" +
    "      '<td><button class=\"danger\" onclick=\"deleteMapping(\\'\" + encodeURIComponent(title) + \"'\\')\">Delete</button></td></tr>';\n" +
    "  }).join('');\n" +
    "}\n" +
    "\n" +
    "async function loadOrders() {\n" +
    "  try {\n" +
    "    var res = await fetch('/api/admin/cached-orders');\n" +
    "    var data = await res.json();\n" +
    "    var tbody = document.getElementById('ordersBody');\n" +
    "    var count = document.getElementById('orderCount');\n" +
    "    count.textContent = '(' + data.length + ' orders)';\n" +
    "    if (!data.length) {\n" +
    "      tbody.innerHTML = '<tr><td colspan=\"4\" style=\"color:#64748b\">No processed orders yet.</td></tr>';\n" +
    "      return;\n" +
    "    }\n" +
    "    tbody.innerHTML = data.map(function(o){\n" +
    "      var kb = (o.bytes/1024).toFixed(1), dt = new Date(o.mtime).toLocaleString();\n" +
    "      return '<tr><td><span class=\"badge-tag\">' + o.orderId + '</span></td><td>' + kb + ' KB</td><td>' + dt + '</td>' +\n" +
    "        '<td><button class=\"dl\" onclick=\"downloadOrder(\\'\" + o.orderId + \"'\\')\">Download</button></td></tr>';\n" +
    "    }).join('');\n" +
    "  } catch(e) { console.error(e); }\n" +
    "}\n" +
    "\n" +
    "async function addMapping() {\n" +
    "  var title = document.getElementById('title').value.trim();\n" +
    "  var selVal = document.getElementById('serviceSelect').value;\n" +
    "  var manualId = document.getElementById('serviceId').value.trim();\n" +
    "  var deliveryMethod = document.getElementById('deliveryMethod').value;\n" +
    "  var separator = document.getElementById('separatorInput').value.trim() || null;\n" +
    "  var serviceId = manualId || selVal;\n" +
    "  var columnMap = buildColMap();\n" +
    "  if (!title || !serviceId) { showMsg('Title and Service ID are required.', false); return; }\n" +
    "  var res = await fetch('/api/admin/mappings', {\n" +
    "    method: 'POST',\n" +
    "    headers: {'Content-Type':'application/json'},\n" +
    "    body: JSON.stringify({title:title,serviceId:serviceId,deliveryMethod:deliveryMethod,columnMap:columnMap,separator:separator})\n" +
    "  });\n" +
    "  if (res.ok) {\n" +
    "    showMsg('Mapping saved!', true);\n" +
    "    colMapEntries = [{id:Date.now(),field:'email',column:'A'},{id:Date.now()+1,field:'password',column:'B'}];\n" +
    "    document.getElementById('separatorInput').value = '';\n" +
    "    document.getElementById('deliveryMethod').value = 'file';\n" +
    "    document.getElementById('chatDeliveryHint').style.display = 'none';\n" +
    "    renderColMapRows();\n" +
    "    updateColMapPreview();\n" +
    "    loadMappings();\n" +
    "  } else { showMsg('Failed to save mapping.', false); }\n" +
    "}\n" +
    "\n" +
    "async function loadHealConfig() {\n" +
    "  try {\n" +
    "    var res = await fetch('/api/admin/heal-config');\n" +
    "    var data = await res.json();\n" +
    "    document.getElementById('healModel').value = data.healModel || 'google/gemini-1.5-flash';\n" +
    "    document.getElementById('healApiKey').placeholder = data.hasApiKey ? 'API key saved -- enter new key to replace' : 'sk-or-v1-...';\n" +
    "  } catch(e) { console.error(e); }\n" +
    "}\n" +
    "\n" +
    "async function saveHealConfig() {\n" +
    "  var healModel = document.getElementById('healModel').value.trim();\n" +
    "  var openrouterApiKey = document.getElementById('healApiKey').value.trim();\n" +
    "  var payload = {healModel:healModel};\n" +
    "  if (openrouterApiKey) payload.openrouterApiKey = openrouterApiKey;\n" +
    "  var res = await fetch('/api/admin/heal-config', {\n" +
    "    method: 'POST',\n" +
    "    headers: {'Content-Type':'application/json'},\n" +
    "    body: JSON.stringify(payload)\n" +
    "  });\n" +
    "  if (res.ok) {\n" +
    "    showMsg('Healer config saved!', true);\n" +
    "    document.getElementById('healApiKey').value = '';\n" +
    "    loadHealConfig();\n" +
    "  } else { showMsg('Failed to save healer config.', false); }\n" +
    "}\n" +
    "\n" +
    "async function deleteMapping(encodedTitle) {\n" +
    "  var title = decodeURIComponent(encodedTitle);\n" +
    "  var res = await fetch('/api/admin/mappings/' + encodeURIComponent(title), {method:'DELETE'});\n" +
    "  if (res.ok) { showMsg('Deleted.', true); loadMappings(); }\n" +
    "  else { showMsg('Failed to delete.', false); }\n" +
    "}\n" +
    "\n" +
    "function downloadOrder(orderId) {\n" +
    "  window.location.href = '/api/admin/cached-orders/' + orderId + '/download';\n" +
    "}\n" +
    "\n" +
    "async function clearAllOrders() {\n" +
    "  if (!confirm('Clear all cached orders?')) return;\n" +
    "  var res = await fetch('/api/order-cache', {method:'DELETE'});\n" +
    "  if (res.ok) { showMsg('All cached orders cleared.', true); loadOrders(); }\n" +
    "  else { showMsg('Failed to clear orders.', false); }\n" +
    "}\n" +
    "\n" +
    "document.getElementById('serviceSelect').addEventListener('change', function() {\n" +
    "  if (this.value) document.getElementById('serviceId').value = this.value;\n" +
    "});\n" +
    "\n" +
    "var _analyticsData = [];\n" +
    "var _analyticsPage = 0;\n" +
    "var ANALYTICS_PAGE_SIZE = 10;\n" +
    "\n" +
    "function renderAnalyticsPage() {\n" +
    "  var tbody = document.getElementById('analyticsBody');\n" +
    "  var pageInfo = document.getElementById('analyticsPageInfo');\n" +
    "  var btnPrev = document.getElementById('analyticsPrev');\n" +
    "  var btnNext = document.getElementById('analyticsNext');\n" +
    "  var data = _analyticsData;\n" +
    "  if (!data.length) {\n" +
    "    tbody.innerHTML = '<tr><td colspan=\"4\" style=\"color:#64748b\">No orders recorded yet.</td></tr>';\n" +
    "    if (pageInfo) pageInfo.textContent = '';\n" +
    "    return;\n" +
    "  }\n" +
    "  var totalPages = Math.ceil(data.length / ANALYTICS_PAGE_SIZE);\n" +
    "  _analyticsPage = Math.max(0, Math.min(_analyticsPage, totalPages - 1));\n" +
    "  var start = _analyticsPage * ANALYTICS_PAGE_SIZE;\n" +
    "  var slice = data.slice(start, start + ANALYTICS_PAGE_SIZE);\n" +
    "  var todayDate = new Date().toISOString().slice(0,10);\n" +
    "  tbody.innerHTML = slice.map(function(d){\n" +
    "    var avg = d.orders > 0 ? (d.revenue/d.orders).toFixed(2) : '--';\n" +
    "    var isToday = d.date === todayDate;\n" +
    "    return '<tr' + (isToday ? ' style=\"background:#1a2744\"' : '') + '>' +\n" +
    "      '<td>' + d.date + (isToday ? ' <span class=\"badge\">today</span>' : '') + '</td>' +\n" +
    "      '<td>' + d.orders + '</td>' +\n" +
    "      '<td style=\"color:#22c55e;font-weight:600\">$' + d.revenue.toFixed(2) + '</td>' +\n" +
    "      '<td style=\"color:#f59e0b\">$' + avg + '</td></tr>';\n" +
    "  }).join('');\n" +
    "  if (pageInfo) pageInfo.textContent = 'Page ' + (_analyticsPage+1) + ' of ' + totalPages;\n" +
    "  if (btnPrev) btnPrev.disabled = _analyticsPage === 0;\n" +
    "  if (btnNext) btnNext.disabled = _analyticsPage >= totalPages - 1;\n" +
    "}\n" +
    "\n" +
    "async function loadAnalytics() {\n" +
    "  try {\n" +
    "    var res = await fetch('/api/admin/analytics');\n" +
    "    var data = await res.json();\n" +
    "    _analyticsData = data;\n" +
    "    _analyticsPage = 0;\n" +
    "    var todayEl = document.getElementById('analyticsToday');\n" +
    "    var todayDate = new Date().toISOString().slice(0,10);\n" +
    "    var todayData = data.find(function(d){ return d.date === todayDate; });\n" +
    "    if (todayData) {\n" +
    "      todayEl.innerHTML = [\n" +
    "        '<div>',\n" +
    "          '<div style=\"font-size:.7rem;color:#94a3b8\">TODAY REVENUE</div>',\n" +
    "          '<div style=\"font-size:2rem;font-weight:700;color:#22c55e\">$' + todayData.revenue.toFixed(2) + '</div>',\n" +
    "        '</div>',\n" +
    "        '<div>',\n" +
    "          '<div style=\"font-size:.7rem;color:#94a3b8\">ORDERS TODAY</div>',\n" +
    "          '<div style=\"font-size:2rem;font-weight:700;color:#6366f1\">' + todayData.orders + '</div>',\n" +
    "        '</div>',\n" +
    "        '<div>',\n" +
    "          '<div style=\"font-size:.7rem;color:#94a3b8\">AVG PER ORDER</div>',\n" +
    "          '<div style=\"font-size:2rem;font-weight:700;color:#f59e0b\">$' + (todayData.revenue/todayData.orders).toFixed(2) + '</div>',\n" +
    "        '</div>',\n" +
    "      ].join('');\n" +
    "    } else {\n" +
    "      todayEl.innerHTML = '<span style=\"color:#64748b;font-size:.875rem\">No orders today yet.</span>';\n" +
    "    }\n" +
    "    renderAnalyticsPage();\n" +
    "  } catch(e) { console.error(e); }\n" +
    "}\n" +
    "\n" +
    "var _recordsData = [];\n" +
    "var _recordsPage = 0;\n" +
    "var RECORDS_PAGE_SIZE = 15;\n" +
    "\n" +
    "function renderRecordsPage() {\n" +
    "  var tbody = document.getElementById('recordsBody');\n" +
    "  var pageInfo = document.getElementById('recordsPageInfo');\n" +
    "  var btnPrev = document.getElementById('recordsPrev');\n" +
    "  var btnNext = document.getElementById('recordsNext');\n" +
    "  var data = _recordsData;\n" +
    "  if (!data.length) {\n" +
    "    tbody.innerHTML = '<tr><td colspan=\"5\" style=\"color:#64748b\">No records yet.</td></tr>';\n" +
    "    if (pageInfo) pageInfo.textContent = '';\n" +
    "    return;\n" +
    "  }\n" +
    "  var totalPages = Math.ceil(data.length / RECORDS_PAGE_SIZE);\n" +
    "  _recordsPage = Math.max(0, Math.min(_recordsPage, totalPages - 1));\n" +
    "  var start = _recordsPage * RECORDS_PAGE_SIZE;\n" +
    "  var slice = data.slice(start, start + RECORDS_PAGE_SIZE);\n" +
    "  tbody.innerHTML = slice.map(function(r){\n" +
    "    var amt = typeof r.amount === 'number' ? '$' + r.amount.toFixed(2) : '--';\n" +
    "    var title = (r.title||'').slice(0,48) || '<em style=\"color:#64748b\">unmapped</em>';\n" +
    "    return '<tr><td style=\"font-family:monospace;font-size:.8rem\">' + r.orderId + '</td>' +\n" +
    "      '<td style=\"font-size:.8rem\">' + title + '</td><td style=\"font-size:.8rem\">' + r.date + '</td>' +\n" +
    "      '<td style=\"color:#22c55e;font-size:.8rem\">' + amt + '</td>' +\n" +
    "      '<td><button class=\"danger\" style=\"padding:.25rem .6rem;font-size:.75rem\" onclick=\"removeRecord(\\'\" + r.orderId + \"'\\')\">Remove</button></td></tr>';\n" +
    "  }).join('');\n" +
    "  if (pageInfo) pageInfo.textContent = 'Page ' + (_recordsPage+1) + ' of ' + totalPages;\n" +
    "  if (btnPrev) btnPrev.disabled = _recordsPage === 0;\n" +
    "  if (btnNext) btnNext.disabled = _recordsPage >= totalPages - 1;\n" +
    "}\n" +
    "\n" +
    "async function loadRecords() {\n" +
    "  try {\n" +
    "    var res = await fetch('/api/admin/analytics/records');\n" +
    "    _recordsData = await res.json();\n" +
    "    _recordsPage = 0;\n" +
    "    renderRecordsPage();\n" +
    "  } catch(e) { console.error(e); }\n" +
    "}\n" +
    "\n" +
    "async function removeRecord(orderId) {\n" +
    "  if (!confirm('Remove this order record from analytics?')) return;\n" +
    "  var res = await fetch('/api/admin/analytics/' + encodeURIComponent(orderId), {method:'DELETE'});\n" +
    "  if (res.ok) { showMsg('Record removed.', true); loadAnalytics(); loadRecords(); }\n" +
    "  else { showMsg('Failed to remove record.', false); }\n" +
    "}\n" +
    "\n" +
    "loadServices();\n" +
    "loadMappings();\n" +
    "loadOrders();\n" +
    "loadAnalytics();\n" +
    "loadRecords();\n" +
    "loadHealConfig();\n" +
    "renderColMapRows();\n" +
    "updateColMapPreview();\n" +
    "setInterval(loadAnalytics, 60000);\n" +
    "setInterval(loadRecords, 60000);\n" +
    "</script>\n" +
    "</body>\n" +
    "</html>"
  );
});

router.get("/admin/mappings", (_req, res) => {
  res.json(loadMappings());
});

router.get("/admin/heal-config", (_req, res) => {
  const conf = loadHealConfig();
  res.json({
    hasApiKey: Boolean(conf.openrouterApiKey),
    healModel: conf.healModel || "google/gemini-1.5-flash",
  });
});

router.post("/admin/heal-config", (req, res) => {
  const body = req.body as HealConfig;
  const prev = loadHealConfig();
  const next: HealConfig = {
    openrouterApiKey: body.openrouterApiKey?.trim() || prev.openrouterApiKey || "",
    healModel: body.healModel?.trim() || prev.healModel || "google/gemini-1.5-flash",
  };
  saveHealConfig(next);
  res.json({ ok: true, hasApiKey: Boolean(next.openrouterApiKey), healModel: next.healModel });
});

router.post("/admin/mappings", (req, res) => {
  const { title, serviceId, columnMap, deliveryMethod, separator } = req.body as {
    title: string;
    serviceId: string;
    columnMap?: Record<string, string> | null;
    deliveryMethod?: DeliveryMethod;
    separator?: string | null;
  };
  if (!title || !serviceId) {
    res.status(400).json({ error: "title and serviceId are required" });
    return;
  }
  const mappings = loadMappings();
  mappings[title] = {
    serviceId: String(serviceId),
    columnMap: (columnMap && Object.keys(columnMap).length > 0) ? columnMap : DEFAULT_COLUMN_MAP,
    deliveryMethod: deliveryMethod || "file",
    separator: separator?.trim() || undefined,
  };
  saveMappings(mappings);
  res.json({ ok: true });
});

router.delete("/admin/mappings/:title", (req, res) => {
  const title = decodeURIComponent(req.params.title);
  const mappings = loadMappings();
  delete mappings[title];
  saveMappings(mappings);
  res.json({ ok: true });
});

router.get("/admin/cached-orders", (_req, res) => {
  res.json(listCachedOrders());
});

router.get("/admin/cached-orders/:orderId/download", (req, res) => {
  const safe = req.params.orderId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(CACHE_DIR, `${safe}.xlsx`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Order not in cache" });
    return;
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Z2U_delivery_temp_${safe}.xlsx"`);
  res.send(fs.readFileSync(filePath));
});

// ── Analytics ──────────────────────────────────────────────────────────────────

router.post("/admin/analytics/record", (req, res) => {
  const { orderId, title, quantity, amount } = req.body as {
    orderId: string; title?: string; quantity?: number; amount?: number | null;
  };
  if (!orderId) { res.status(400).json({ error: "orderId required" }); return; }

  const records = loadAnalytics();
  const exists = records.some((r) => r.orderId === orderId);
  if (!exists) {
    const now = new Date();
    records.push({
      orderId,
      title:      title      ?? "",
      quantity:   quantity   ?? 0,
      amount:     typeof amount === "number" && amount > 0 ? amount : null,
      date:       now.toISOString().slice(0, 10),
      recordedAt: now.toISOString(),
    });
    saveAnalytics(records);
    logger.info({ orderId, amount }, "[analytics] recorded orderId");
  }
  res.json({ ok: true, duplicate: exists });
});

router.get("/admin/analytics", (_req, res) => {
  const records = loadAnalytics();
  const byDate: Record<string, { orders: number; revenue: number }> = {};
  for (const r of records) {
    if (!byDate[r.date]) byDate[r.date] = { orders: 0, revenue: 0 };
    byDate[r.date].orders++;
    if (typeof r.amount === "number" && r.amount > 0) byDate[r.date].revenue += r.amount;
  }
  const sorted = Object.entries(byDate)
    .map(([date, d]) => ({ date, ...d, revenue: Math.round(d.revenue * 100) / 100 }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);
  res.json(sorted);
});

router.get("/admin/analytics/records", (_req, res) => {
  const records = loadAnalytics()
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  res.json(records);
});

router.delete("/admin/analytics/:orderId", (req, res) => {
  const { orderId } = req.params;
  const records = loadAnalytics();
  const before  = records.length;
  const updated = records.filter((r) => r.orderId !== orderId);
  if (updated.length === before) {
    res.status(404).json({ error: "Record not found" });
    return;
  }
  saveAnalytics(updated);
  res.json({ ok: true, removed: before - updated.length });
});

// ── Pending chat-reply queue ──────────────────────────────────────────────────
interface PendingReply {
  username: string;
  message:  string;
  orderId:  string;
  queuedAt: string;
}
const pendingChatReplies: PendingReply[] = [];

router.post("/admin/queue-chat-reply", (req, res) => {
  const { username, message, orderId = "" } = req.body as {
    username: string; message: string; orderId?: string;
  };
  if (!username || !message) {
    res.status(400).json({ error: "username and message are required" });
    return;
  }
  pendingChatReplies.push({ username, message, orderId, queuedAt: new Date().toISOString() });
  logger.info({ username, messageLength: message.length }, "[chat-queue] Queued reply");
  res.json({ ok: true, queued: pendingChatReplies.length });
});

router.get("/admin/pending-chat-replies", (_req, res) => {
  const replies = pendingChatReplies.splice(0);
  res.json(replies);
});

// ── VPS proxy upload ───────────────────────────────────────────────────────────
router.post("/admin/proxy-upload", async (req, res) => {
  const { fileBytes, orderId, cookies, note, pageUrl } = req.body as {
    fileBytes: number[];
    orderId: string;
    cookies: { name: string; value: string; domain?: string }[];
    note?: string;
    pageUrl?: string;
  };

  if (!fileBytes?.length || !orderId || !cookies?.length) {
    res.status(400).json({ ok: false, error: "Missing fileBytes, orderId, or cookies" });
    return;
  }

  const buf          = Buffer.from(fileBytes);
  const noteValue    = note || "Delivered";
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const xsrfCookie  = cookies.find((c) => /^XSRF-TOKEN$/i.test(c.name));
  const xsrfToken   = xsrfCookie ? decodeURIComponent(xsrfCookie.value) : "";
  const referer     = pageUrl || `https://www.z2u.com/sellOrder?order_id=${orderId}`;

  const Z2U_ENDPOINTS = [
    "https://www.z2u.com/sellOrder/uploadSellForm",
    "https://www.z2u.com/sellOrder/uploadDelivery",
    "https://www.z2u.com/sellOrder/uploadFile",
    "https://www.z2u.com/api/sellOrder/uploadSellForm",
  ];
  const FILE_FIELDS = ["upfile", "file", "upload", "excel", "formFile"];

  const results: { url: string; field: string; status: number; body: string }[] = [];

  for (const url of Z2U_ENDPOINTS) {
    for (const fieldName of FILE_FIELDS) {
      try {
        const formData = new FormData();
        formData.append("order_id", orderId);
        formData.append("note", noteValue);
        formData.append(fieldName, new Blob([buf], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }), `Z2U_delivery_${orderId}.xlsx`);

        const headers: Record<string, string> = {
          "Cookie": cookieHeader,
          "Referer": referer,
          "Origin": "https://www.z2u.com",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        };
        if (xsrfToken) {
          headers["X-XSRF-TOKEN"] = xsrfToken;
          headers["X-CSRF-TOKEN"]  = xsrfToken;
        }

        const resp = await fetch(url, {
          method: "POST",
          headers,
          body: formData,
        });

        const text = await resp.text();
        results.push({ url, field: fieldName, status: resp.status, body: text.slice(0, 400) });
        logger.info({ url, field: fieldName, status: resp.status }, "[proxy-upload] response");

        let json: any = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        if (json) {
          const code = json.code ?? json.status ?? json.errCode;
          const isOk = code === 0 || code === 200 || code === "0" || code === "200" || code === true || code === 1;
          if (isOk && json.data != null && json.data !== "" && json.data !== false) {
            res.json({ ok: true, url, field: fieldName, response: text.slice(0, 400), results });
            return;
          }
          const msg = (json.msg || json.message || "").toLowerCase();
          if (/unauthori|forbidden|login|session/i.test(msg)) break;
        } else if (resp.ok && !text.toLowerCase().includes("<html") && !text.toLowerCase().includes("error")) {
          res.json({ ok: true, url, field: fieldName, response: text.slice(0, 400), results });
          return;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ url, field: fieldName, status: 0, body: msg });
        logger.error({ url, field: fieldName, err: msg }, "[proxy-upload] error");
      }
    }
  }

  res.json({ ok: false, error: "All endpoints failed", results });
});

export default router;