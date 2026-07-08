` tag was removed and replaced with the proper TypeScript property:

```typescript
healModel: body.healModel?.trim() || prev.healModel || "google/gemini-1.5-flash",
```

<dyad-command type="rebuild"></dyad-command>The previous write was cut off during the HTML template string. I need to complete the file from where it was interrupted — the TypeScript route handlers after the `const html = \`...\`;` declaration. Let me provide the missing section.

<dyad-write path="artifacts/api-server/src/routes/admin.ts" description="Complete admin.ts — fixing the broken ＜dyad-write＞ literal at line 703 and finishing the file that was previously truncated">
import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAPPINGS_FILE   = path.resolve(__dirname, "../../mappings.json");
const CACHE_DIR       = path.resolve(__dirname, "../../order-cache");
const ANALYTICS_FILE  = path.resolve(__dirname, "../../analytics.json");
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

type DeliveryMethod = "file" | "direct" | "chat";
interface MappingEntry {
  serviceId: string;
  columnMap?: Record<string, string>;
  deliveryMethod?: DeliveryMethod;
  separator?: string;
}

function loadMappings(): Record<string, string | MappingEntry> {
  if (!fs.existsSync(MAPPINGS_FILE)) return {};
  return JSON.parse(fs.readFileSync(MAPPINGS_FILE, "utf-8"));
}

function saveMappings(data: Record<string, string | MappingEntry>) {
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

const DEFAULT_COLUMN_MAP = { email: "A", password: "B" };

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Z2U ↔ Lfollowers Admin</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;padding:2rem}
  h1{font-size:1.6rem;font-weight:700;margin-bottom:.25rem;color:#f8fafc}
  .sub{color:#94a3b8;font-size:.875rem;margin-bottom:2rem}
  .card{background:#1e293b;border:1px solid #334155;border-radius:.75rem;padding:1.5rem;margin-bottom:1.5rem}
  h2{font-size:1rem;font-weight:600;margin-bottom:1rem;color:#cbd5e1}
  label{display:block;font-size:.8rem;color:#94a3b8;margin-bottom:.3rem;margin-top:.75rem}
  input,select{width:100%;padding:.5rem .75rem;background:#0f172a;border:1px solid #334155;border-radius:.375rem;color:#e2e8f0;font-size:.875rem}
  input:focus,select:focus{outline:2px solid #6366f1;border-color:#6366f1}
  button{margin-top:1rem;padding:.5rem 1.25rem;background:#6366f1;color:#fff;border:none;border-radius:.375rem;cursor:pointer;font-size:.875rem;font-weight:500}
  button:hover{background:#4f46e5}
  button.danger{background:#ef4444}
  button.danger:hover{background:#dc2626}
  button.dl{background:#0369a1;margin-top:0}
  button.dl:hover{background:#0284c7}
  button.pg{margin-top:0;padding:.3rem .75rem;background:#1e293b;border:1px solid #334155;font-size:.8rem;color:#cbd5e1}
  button.pg:hover:not(:disabled){background:#334155}
  button.pg:disabled{opacity:.35;cursor:default}
  button.add-row{background:#059669;padding:.3rem .75rem;font-size:.75rem;margin-top:0}
  button.add-row:hover{background:#047857}
  button.remove-row{background:#dc2626;padding:.15rem .4rem;font-size:.7rem;margin-top:0;color:#fff;border:none;border-radius:.25rem;cursor:pointer}
  button.remove-row:hover{background:#b91c1c}
  .badge{background:#6366f1;color:#fff;font-size:.65rem;font-weight:700;border-radius:.25rem;padding:.1rem .35rem;vertical-align:middle;margin-left:.35rem}
  table{width:100%;border-collapse:collapse;font-size:.85rem}
  th{text-align:left;padding:.5rem .75rem;background:#0f172a;color:#94a3b8;font-weight:500;border-bottom:1px solid #334155}
  td{padding:.5rem .75rem;border-bottom:1px solid #1e293b;vertical-align:middle}
  tr:hover td{background:#0f172a}
  .tag{display:inline-block;padding:.15rem .5rem;border-radius:.25rem;font-size:.75rem;background:#312e81;color:#a5b4fc}
  .badge-tag{display:inline-block;padding:.15rem .5rem;border-radius:.25rem;font-size:.75rem;background:#064e3b;color:#6ee7b7}
  .chat-tag{display:inline-block;padding:.15rem .5rem;border-radius:.25rem;font-size:.75rem;background:#7c3aed;color:#c4b5fd}
  #msg{padding:.5rem 1rem;border-radius:.375rem;margin-bottom:1rem;font-size:.875rem;display:none}
  .ok{background:#064e3b;color:#6ee7b7}
  .err{background:#7f1d1d;color:#fca5a5}
  .info{background:#1e3a8a;color:#93c5fd}
  .col-map-section{margin-top:.75rem;padding:1rem;background:#0f172a;border-radius:.5rem}
  .col-map-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem}
  .col-map-header span{font-size:.9rem;font-weight:600;color:#cbd5e1}
  .col-map-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem}
  .col-map-row label.field-lbl{margin:0;font-size:.8rem;color:#94a3b8;flex:0 0 auto;width:130px}
  .col-map-row input.field-name{flex:1;padding:.35rem .5rem;font-size:.8rem;background:#1e293b;border:1px solid #334155;border-radius:.25rem;color:#e2e8f0}
  .col-map-row label.col-lbl{margin:0;font-size:.8rem;color:#94a3b8;flex:0 0 auto;width:60px;text-align:center}
  .col-map-row input.col-letter{flex:0 0 auto;width:60px;padding:.35rem .5rem;font-size:.8rem;background:#1e293b;border:1px solid #334155;border-radius:.25rem;color:#e2e8f0;text-align:center;text-transform:uppercase}
  .col-map-row .remove-btn{flex:0 0 auto;padding:.2rem .4rem;font-size:.7rem;background:#dc2626;color:#fff;border:none;border-radius:.25rem;cursor:pointer}
  .col-map-row .remove-btn:hover{background:#b91c1c}
  .col-map-preview{margin-top:.75rem;font-size:.75rem;color:#64748b}
  .preset-btns{display:flex;gap:.5rem;margin-bottom:.75rem;flex-wrap:wrap}
  .preset-btns button{background:#1e293b;border:1px solid #334155;color:#cbd5e1;padding:.25rem .6rem;font-size:.7rem;border-radius:.25rem;cursor:pointer;margin-top:.3rem}
  .preset-btns button:hover{background:#334155}
  .hint{font-size:.75rem;color:#64748b;margin-top:.3rem}
  .separator-row{display:flex;align-items:center;gap:.5rem;margin-top:.5rem}
  .separator-row label{margin:0;font-size:.8rem;color:#94a3b8;flex:0 0 auto;width:150px}
  .separator-row input{flex:1;padding:.35rem .5rem;font-size:.8rem;background:#1e293b;border:1px solid #334155;border-radius:.25rem;color:#e2e8f0}
  .delivery-hint{padding:.5rem .75rem;background:#1e1b4b;border:1px solid #4c1d95;border-radius:.375rem;font-size:.8rem;color:#c4b5fd;margin-top:.5rem}
  .delivery-hint strong{color:#a78bfa}
</style>
</head>
<body>
<h1>Z2U &harr; Lfollowers Admin</h1>
<p class="sub">Map Z2U Offer Titles to Lfollowers Product IDs for automated order processing.</p>
<div id="msg"></div>

<div class="card">
  <h2>📊 Daily Revenue</h2>
  <div id="analyticsToday" style="display:flex;gap:2.5rem;margin-bottom:1.25rem"></div>
  <table id="analyticsTable">
    <thead><tr><th>Date</th><th>Orders</th><th>Revenue (USD)</th><th>Avg / Order</th></tr></thead>
    <tbody id="analyticsBody"><tr><td colspan="4" style="color:#64748b">Loading...</td></tr></tbody>
  </table>
  <div style="display:flex;align-items:center;justify-content:flex-end;gap:.75rem;margin-top:.75rem">
    <button id="analyticsPrev" class="pg" onclick="_analyticsPage--;renderAnalyticsPage()" disabled>&#8592; Prev</button>
    <span id="analyticsPageInfo" style="font-size:.8rem;color:#94a3b8"></span>
    <button id="analyticsNext" class="pg" onclick="_analyticsPage++;renderAnalyticsPage()" disabled>Next &#8594;</button>
  </div>
</div>

<div class="card">
  <h2>🗂 Order Records</h2>
  <table id="recordsTable">
    <thead><tr><th>Order ID</th><th>Title</th><th>Date</th><th>Amount</th><th></th></tr></thead>
    <tbody id="recordsBody"><tr><td colspan="5" style="color:#64748b">Loading...</td></tr></tbody>
  </table>
</div>

<div class="card">
  <h2>Add / Update Mapping</h2>
  <label>Z2U Offer Title</label>
  <input id="title" placeholder="e.g. FIFA 25 PS4 Coins 1M" />
  <label>Lfollowers Product</label>
  <select id="serviceSelect"><option value="">-- loading products... --</option></select>
  <label>Or enter Product ID manually</label>
  <input id="serviceId" placeholder="e.g. 1234" />
  <label>Delivery Method</label>
  <select id="deliveryMethod">
    <option value="file">File (XLSX upload)</option>
    <option value="direct">Direct (paste credentials)</option>
    <option value="chat">Chat (M3U link &rarr; form fill &rarr; chat message)</option>
  </select>
  <div id="chatDeliveryHint" class="delivery-hint" style="display:none">
    <strong>💬 Chat Delivery:</strong> For IPTV / M3U subscription orders. The extension will parse the M3U URL from Lfollowers, auto-fill the Z2U delivery form fields (Login Account, Password, Domain), and send formatted credentials via Z2U chat.
  </div>
  <label>Column Map</label>
  <div class="preset-btns">
    <button onclick="applyPreset('email')">Preset: Email/Password</button>
    <button onclick="applyPreset('username')">Preset: Username/Password</button>
    <button onclick="applyPreset('full')">Preset: Full (user|pass|email|email_pass)</button>
    <button onclick="clearPreset()">Clear All</button>
  </div>
  <div class="col-map-section">
    <div class="col-map-header"><span>Field Name</span><span>Column</span><span></span></div>
    <div id="colMapRows"></div>
    <button type="button" class="add-row" onclick="addColMapRow()">+ Add Field</button>
  </div>
  <div class="col-map-preview" id="colMapPreview">Preview: {}</div>
  <label style="margin-top:1rem">Custom Separator</label>
  <div class="separator-row">
    <input type="text" id="separatorInput" placeholder="e.g. | or : or ::" style="max-width:200px" />
    <span style="font-size:.7rem;color:#64748b">Leave empty to use default (:)</span>
  </div>
  <button onclick="addMapping()" id="saveMappingBtn">Save Mapping</button>
</div>

<div class="card">
  <h2>🩹 Healer Settings</h2>
  <label>OpenRouter API Key</label>
  <input id="healApiKey" placeholder="sk-or-v1-..." autocomplete="off" />
  <label>Model</label>
  <input id="healModel" placeholder="google/gemini-1.5-flash" />
  <button onclick="saveHealConfig()">Save Healer Config</button>
</div>

<div class="card">
  <h2>Current Mappings</h2>
  <table id="mappingsTable">
    <thead><tr><th>Z2U Title</th><th>Product ID</th><th>Delivery</th><th>Separator</th><th>Column Map</th><th>Action</th></tr></thead>
    <tbody id="mappingsBody"><tr><td colspan="6" style="color:#64748b">Loading...</td></tr></tbody>
  </table>
</div>

<div class="card">
  <h2>Processed Orders <span id="orderCount"></span></h2>
  <table>
    <thead><tr><th>Order ID</th><th>Size</th><th>Processed At</th><th>Download</th></tr></thead>
    <tbody id="ordersBody"><tr><td colspan="4" style="color:#64748b">Loading...</td></tr></tbody>
  </table>
  <button class="danger" style="margin-top:1rem" onclick="clearAllOrders()">Clear All Cached Orders</button>
</div>

<script>
document.getElementById("deliveryMethod").addEventListener("change",function(){
  document.getElementById("chatDeliveryHint").style.display = this.value === "chat" ? "block" : "none";
});
const PRESETS={email:[{field:"email",column:"A"},{field:"password",column:"B"}],username:[{field:"username",column:"A"},{field:"password",column:"B"}],full:[{field:"username",column:"A"},{field:"password",column:"B"},{field:"email",column:"C"},{field:"email_password",column:"D"}]};
let colMapEntries=[{id:1,field:"email",column:"A"},{id:2,field:"password",column:"B"}];
let colMapCounter=3;
function applyPreset(n){const p=PRESETS[n];if(!p)return;colMapEntries=p.map((e,i)=>({id:Date.now()+i,field:e.field,column:e.column}));renderColMapRows();updateColMapPreview()}
function clearPreset(){colMapEntries=[];renderColMapRows();updateColMapPreview()}
function addColMapRow(f,c){colMapEntries.push({id:colMapCounter++,field:f||"",column:c||"A"});renderColMapRows();updateColMapPreview()}
function removeColMapRow(id){colMapEntries=colMapEntries.filter(e=>e.id!==id);renderColMapRows();updateColMapPreview()}
function onColMapFieldChange(id,v){const e=colMapEntries.find(e=>e.id===id);if(e)e.field=v.trim();updateColMapPreview()}
function onColMapColChange(id,v){const e=colMapEntries.find(e=>e.id===id);if(e)e.column=v.trim().toUpperCase().replace(/[^A-Z]/g,"").slice(0,3);updateColMapPreview()}
function renderColMapRows(){const c=document.getElementById("colMapRows");c.innerHTML=colMapEntries.map(e=>'<div class="col-map-row" data-id="'+e.id+'"><label class="field-lbl">Field name</label><input type="text" class="field-name" value="'+e.field+'" placeholder="e.g. username" maxlength="50" oninput="onColMapFieldChange('+e.id+',this.value)"/><label class="col-lbl">Column</label><input type="text" class="col-letter" value="'+e.column+'" placeholder="A" maxlength="3" oninput="onColMapColChange('+e.id+',this.value)"/><button type="button" class="remove-btn" onclick="removeColMapRow('+e.id+')">×</button></div>').join("")}
function buildColMap(){const m={};for(const e of colMapEntries){const f=e.field.trim();const c=e.column.trim().toUpperCase().replace(/[^A-Z]/g,"").slice(0,3);if(f&&c)m[f]=c}return Object.keys(m).length?m:null}
function updateColMapPreview(){document.getElementById("colMapPreview").textContent="Preview: "+JSON.stringify(buildColMap()||{})}
function showMsg(t,ok){const e=document.getElementById("msg");e.textContent=t;e.className=ok?"ok":"err";e.style.display="block";setTimeout(()=>e.style.display="none",3500)}
async function loadServices(){try{const r=await fetch("/api/admin/services");const d=await r.json();const s=document.getElementById("serviceSelect");s.innerHTML='<option value="">-- select product --</option>';if(d.data&&Array.isArray(d.data))d.data.forEach(p=>{const o=document.createElement("option");o.value=p.product_id;o.textContent="["+p.product_id+"] "+p.name+" | Stock: "+p.quantity+" | $"+p.price;s.appendChild(o)})}catch(e){console.error(e)}}
async function loadMappings(){const r=await fetch("/api/admin/mappings");const d=await r.json();const t=document.getElementById("mappingsBody");const e=Object.entries(d);if(!e.length){t.innerHTML='<tr><td colspan="6" style="color:#64748b">No mappings yet.</td></tr>';return}t.innerHTML=e.map(([title,conf])=>{const sid=typeof conf==="string"?conf:conf.serviceId||"";const dm=typeof conf==="string"?"file":conf.deliveryMethod||"file";const sep=typeof conf==="string"?null:conf.separator||null;const cm=typeof conf==="string"?{email:"A",password:"B"}:conf.columnMap||{email:"A",password:"B"};return '<tr><td>'+title+'</td><td><span class="tag">'+sid+'</span></td><td><span class="'+(dm==="chat"?"chat-tag":"tag")+'">'+dm+'</span></td><td><span class="tag">'+(sep||"default (:)")+'</span></td><td style="max-width:220px;white-space:pre-wrap;word-break:break-word;color:#94a3b8">'+JSON.stringify(cm)+'</td><td><button class="danger" onclick="deleteMapping(\''+encodeURIComponent(title)+'\')">Delete</button></td></tr>'}).join("")}
async function loadOrders(){try{const r=await fetch("/api/admin/cached-orders");const d=await r.json();document.getElementById("orderCount").textContent="("+d.length+" orders)";const t=document.getElementById("ordersBody");if(!d.length){t.innerHTML='<tr><td colspan="4" style="color:#64748b">No processed orders yet.</td></tr>';return}t.innerHTML=d.map(o=>{const kb=(o.bytes/1024).toFixed(1);const dt=new Date(o.mtime).toLocaleString();return '<tr><td><span class="badge-tag">'+o.orderId+'</span></td><td>'+kb+' KB</td><td>'+dt+'</td><td><button class="dl" onclick="downloadOrder(\''+o.orderId+'\')">⬇ Download</button></td></tr>'}).join("")}catch(e){console.error(e)}}
async function addMapping(){const t=document.getElementById("title").value.trim();const sv=document.getElementById("serviceSelect").value;const mi=document.getElementById("serviceId").value.trim();const dm=document.getElementById("deliveryMethod").value;const sep=document.getElementById("separatorInput").value.trim()||null;const sid=mi||sv;const cm=buildColMap();if(!t||!sid){showMsg("Title and Service ID are required.",false);return}const r=await fetch("/api/admin/mappings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:t,serviceId:sid,deliveryMethod:dm,columnMap:cm,separator:sep})});if(r.ok){showMsg("Mapping saved!",true);colMapEntries=[{id:Date.now(),field:"email",column:"A"},{id:Date.now()+1,field:"password",column:"B"}];document.getElementById("separatorInput").value="";document.getElementById("deliveryMethod").value="file";document.getElementById("chatDeliveryHint").style.display="none";renderColMapRows();updateColMapPreview();loadMappings()}else showMsg("Failed to save mapping.",false)}
async function loadHealConfig(){try{const r=await fetch("/api/admin/heal-config");const d=await r.json();document.getElementById("healModel").value=d.healModel||"google/gemini-1.5-flash";document.getElementById("healApiKey").placeholder=d.hasApiKey?"API key already saved — enter new key to replace":"sk-or-v1-..."}catch(e){console.error(e)}}
async function saveHealConfig(){const healModel=document.getElementById("healModel").value.trim();const openrouterApiKey=document.getElementById("healApiKey").value.trim();const payload={healModel};if(openrouterApiKey)payload.openrouterApiKey=openrouterApiKey;const r=await fetch("/api/admin/heal-config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});if(r.ok){showMsg("Healer config saved!",true);document.getElementById("healApiKey").value="";loadHealConfig()}else showMsg("Failed to save healer config.",false)}
async function deleteMapping(et){const title=decodeURIComponent(et);const r=await fetch("/api/admin/mappings/"+encodeURIComponent(title),{method:"DELETE"});if(r.ok){showMsg("Deleted.",true);loadMappings()}else showMsg("Failed to delete.",false)}
function downloadOrder(orderId){window.location.href="/api/admin/cached-orders/"+orderId+"/download"}
async function clearAllOrders(){if(!confirm("Clear all cached orders?"))return;const r=await fetch("/api/order-cache",{method:"DELETE"});if(r.ok){showMsg("Cleared.",true);loadOrders()}else showMsg("Failed to clear.",false)}
document.getElementById("serviceSelect").addEventListener("change",function(){if(this.value)document.getElementById("serviceId").value=this.value});
loadServices();loadMappings();loadOrders();loadHealConfig();renderColMapRows();updateColMapPreview();
</script>
</body></html>`;

router.get("/admin", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

router.get("/admin/mappings", (_req, res) => {
  res.json(loadMappings());
});

router.get("/admin/heal-config", (_req, res) => {
  const conf = loadHealConfig();
  res.json({ hasApiKey: Boolean(conf.openrouterApiKey), healModel: conf.healModel || "google/gemini-1.5-flash" });
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
    title: string; serviceId: string; columnMap?: Record<string, string> | null;
    deliveryMethod?: DeliveryMethod; separator?: string | null;
  };
  if (!title || !serviceId) { res.status(400).json({ error: "title and serviceId are required" }); return; }
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
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Not in cache" }); return; }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="Z2U_delivery_temp_${safe}.xlsx"`);
  res.send(fs.readFileSync(filePath));
});

router.post("/admin/analytics/record", (req, res) => {
  const { orderId, title, quantity, amount } = req.body as {
    orderId: string; title?: string; quantity?: number; amount?: number | null;
  };
  if (!orderId) { res.status(400).json({ error: "orderId required" }); return; }
  const records = loadAnalytics();
  const exists = records.some((r) => r.orderId === orderId);
  if (!exists) {
    records.push({
      orderId, title: title ?? "", quantity: quantity ?? 0,
      amount: typeof amount === "number" && amount > 0 ? amount : null,
      date: new Date().toISOString().slice(0, 10),
      recordedAt: new Date().toISOString(),
    });
    saveAnalytics(records);
    logger.info({ orderId, amount }, "[analytics] recorded");
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
  res.json(Object.entries(byDate)
    .map(([date, d]) => ({ date, ...d, revenue: Math.round(d.revenue * 100) / 100 }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30));
});

router.get("/admin/analytics/records", (_req, res) => {
  res.json(loadAnalytics().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)));
});

router.delete("/admin/analytics/:orderId", (req, res) => {
  const { orderId } = req.params;
  const records = loadAnalytics();
  const before = records.length;
  const updated = records.filter((r) => r.orderId !== orderId);
  if (updated.length === before) { res.status(404).json({ error: "Not found" }); return; }
  saveAnalytics(updated);
  res.json({ ok: true, removed: before - updated.length });
});

interface PendingReply { username: string; message: string; orderId: string; queuedAt: string; }
const pendingChatReplies: PendingReply[] = [];

router.post("/admin/queue-chat-reply", (req, res) => {
  const { username, message, orderId = "" } = req.body as { username: string; message: string; orderId?: string };
  if (!username || !message) { res.status(400).json({ error: "username and message are required" }); return; }
  pendingChatReplies.push({ username, message, orderId, queuedAt: new Date().toISOString() });
  logger.info({ username, messageLength: message.length }, "[chat-queue] Queued");
  res.json({ ok: true, queued: pendingChatReplies.length });
});

router.get("/admin/pending-chat-replies", (_req, res) => {
  res.json(pendingChatReplies.splice(0));
});

router.post("/admin/proxy-upload", async (req, res) => {
  const { fileBytes, orderId, cookies, note, pageUrl } = req.body as {
    fileBytes: number[]; orderId: string; cookies: { name: string; value: string; domain?: string }[];
    note?: string; pageUrl?: string;
  };
  if (!fileBytes?.length || !orderId || !cookies?.length) {
    res.status(400).json({ ok: false, error: "Missing fileBytes, orderId, or cookies" });
    return;
  }
  const buf = Buffer.from(fileBytes);
  const noteValue = note || "Delivered";
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const xsrfCookie = cookies.find((c) => /^XSRF-TOKEN$/i.test(c.name));
  const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.value) : "";
  const referer = pageUrl || `https://www.z2u.com/sellOrder?order_id=${orderId}`;
  const Z2U_ENDPOINTS = [
    "https://www.z2u.com/sellOrder/uploadSellForm",
    "https://www.z2u.com/SellOrder/uploadSellForm",
    "https://www.z2u.com/sellOrder/uploadDelivery",
    "https://www.z2u.com/sellOrder/uploadFile",
    "https://www.z2u.com/api/sellOrder/uploadSellForm",
    "https://www.z2u.com/api/sellOrder/uploadDelivery",
  ];
  const FILE_FIELDS = ["upfile", "file", "upload", "excel", "formFile"];
  const results: { url: string; field: string; status: number; body: string }[] = [];

  for (const url of Z2U_ENDPOINTS) {
    for (const fieldName of FILE_FIELDS) {
      try {
        const formData = new FormData();
        formData.append("order_id", orderId);
        formData.append("note", noteValue);
        formData.append(fieldName, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Z2U_delivery_${orderId}.xlsx`);
        const headers: Record<string, string> = {
          "Cookie": cookieHeader, "Referer": referer, "Origin": "https://www.z2u.com",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        };
        if (xsrfToken) { headers["X-XSRF-TOKEN"] = xsrfToken; headers["X-CSRF-TOKEN"] = xsrfToken; }
        const resp = await fetch(url, { method: "POST", headers, body: formData });
        const text = await resp.text();
        results.push({ url, field: fieldName, status: resp.status, body: text.slice(0, 400) });
        logger.info({ url, field: fieldName, status: resp.status }, "[proxy-upload]");
        let json: any = null;
        try { json = JSON.parse(text); } catch {}
        if (json) {
          const code = json.code ?? json.status ?? json.errCode;
          if ((code === 0 || code === 200 || code === "0" || code === "200" || code === true || code === 1) && json.data != null && json.data !== "" && json.data !== false) {
            res.json({ ok: true, url, field: fieldName, response: text.slice(0, 400), results }); return;
          }
          if ((json.msg || json.message || "").toLowerCase().includes("unauthori")) break;
        } else if (resp.ok && !text.toLowerCase().includes("<html")) {
          res.json({ ok: true, url, field: fieldName, response: text.slice(0, 400), results }); return;
        }
      } catch (e: any) {
        results.push({ url, field: fieldName, status: 0, body: e.message });
        logger.error({ url, field: fieldName, err: e.message }, "[proxy-upload] error");
      }
    }
  }
  res.json({ ok: false, error: "All endpoints failed", results });
});

export default router;