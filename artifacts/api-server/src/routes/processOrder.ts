import { Router } from "express";
import multer from "multer";
import { createRequire } from "module";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger.js";

// adm-zip is CommonJS
const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAPPINGS_FILE = path.resolve(__dirname, "../../mappings.json");
const LFOLLOWERS_API_URL = "https://lfollowers.com/api/v2";

type DeliveryMethod = "file" | "direct" | "chat";

interface MappingEntry {
  serviceId: string;
  columnMap?: Record<string, string>;
  deliveryMethod?: DeliveryMethod;
  separator?: string;
}

interface ParsedAccount {
  parts: string[];
  raw: string;
}

// ── Order cache ─────────────────────────────────────────────────────────────
const CACHE_DIR = path.resolve(__dirname, "../../order-cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function cacheFilePath(orderId: string): string {
  const safe = orderId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(CACHE_DIR, `${safe}.xlsx`);
}

function getCachedFile(orderId: string): Buffer | null {
  const p = cacheFilePath(orderId);
  if (fs.existsSync(p)) {
    logger.info({ orderId }, "Order cache HIT — returning cached file (no API call)");
    return fs.readFileSync(p);
  }
  return null;
}

function saveCachedFile(orderId: string, buf: Buffer): void {
  fs.writeFileSync(cacheFilePath(orderId), buf);
  logger.info({ orderId, bytes: buf.length }, "Order cache SAVED");
}

function loadMappings(): Record<string, string | MappingEntry> {
  if (!fs.existsSync(MAPPINGS_FILE)) return {};
  return JSON.parse(fs.readFileSync(MAPPINGS_FILE, "utf-8"));
}

function normalizeMappingEntry(v: string | MappingEntry): MappingEntry {
  if (typeof v === "string") {
    return {
      serviceId: v,
      deliveryMethod: "file",
      columnMap: { email: "A", password: "B" },
    };
  }
  return {
    serviceId: String(v.serviceId || ""),
    deliveryMethod: v.deliveryMethod || "file",
    columnMap: v.columnMap && Object.keys(v.columnMap).length ? v.columnMap : { email: "A", password: "B" },
    separator: v.separator,
  };
}

function getApiKey(): string {
  const key = process.env.LFOLLOWERS_API_KEY;
  if (!key) throw new Error("LFOLLOWERS_API_KEY is not set");
  return key;
}

function parseAccountLine(line: string, separator?: string): ParsedAccount {
  const parts = separator 
    ? line.split(separator).map((p) => p.trim()).filter(Boolean)
    : line.split(/[|:;\/\s]+/).map((p) => p.trim()).filter(Boolean);
  return { parts, raw: line.trim() };
}

async function purchaseAccounts(productId: string, qty: number, separator?: string): Promise<ParsedAccount[]> {
  const key = getApiKey();
  logger.info({ productId, quantity: qty, separator }, "Calling Lfollowers purchase API");
  const lfResponse = await axios.post(LFOLLOWERS_API_URL, {
    key,
    action: "purchase",
    product_id: productId,
    quantity: qty,
  });

  const purchaseResult = lfResponse.data as { delivered_data?: string; error?: string };
  logger.info({ productId, lfResponse: purchaseResult }, "Lfollowers response");

  if (purchaseResult.error) {
    throw new Error(`Lfollowers error: ${purchaseResult.error}`);
  }

  const delivered = purchaseResult.delivered_data ?? "";
  logger.info({ productId, deliveredLength: delivered.length, deliveredPreview: delivered.slice(0, 200) }, "Delivered data from Lfollowers");

  return delivered
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => parseAccountLine(line, separator));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function valueForField(account: ParsedAccount, field: string, fieldIndex: number): string {
  return account.parts[fieldIndex] ?? "";
}

function buildRowXml(rowNum: number, account: ParsedAccount, columnMap: Record<string, string>): string {
  const cells = Object.entries(columnMap)
    .map(([field, col]) => ({ field, col: String(col || "").toUpperCase().trim() }))
    .filter((x) => /^[A-Z]+$/.test(x.col))
    .map(({ field, col }, fieldIndex) => {
      const value = valueForField(account, field, fieldIndex);
      if (!value) return "";
      return `<c r="${col}${rowNum}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    })
    .filter(Boolean)
    .join("");

  return `<row r="${rowNum}">${cells}</row>`;
}

function fillXlsxBuffer(templateBuffer: Buffer, accounts: ParsedAccount[], qty: number, columnMap: Record<string, string>): Buffer {
  logger.info({ templateSize: templateBuffer.length, accountsCount: accounts.length, qty, columnMap }, "fillXlsxBuffer: starting");

  const zip = new AdmZip(templateBuffer);
  const entries: string[] = zip.getEntries().map((e: { entryName: string }) => e.entryName);
  logger.info({ entries }, "ZIP entries found");
  const sheetEntry = entries.find((n) => /xl\/worksheets\/sheet\d+\.xml/.test(n));
  if (!sheetEntry) {
    logger.error({ entries }, "Could not find worksheet XML in xlsx");
    throw new Error("Could not find worksheet XML in xlsx");
  }
  logger.info({ sheetEntry }, "Found worksheet entry");

  let wsXml: string = zip.readAsText(sheetEntry);
  logger.info({ wsXmlLength: wsXml.length, wsXmlPreview: wsXml.slice(0, 300) }, "Worksheet XML loaded");

  // Remove existing data rows (row 4 and beyond)
  wsXml = wsXml.replace(/<row\s[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (match, rNum) =>
    parseInt(rNum, 10) >= 4 ? "" : match,
  );
  wsXml = wsXml.replace(/<sheetData\s*\/>/, "<sheetData></sheetData>");

  const newRows = accounts
    .slice(0, qty)
    .map((a, i) => buildRowXml(4 + i, a, columnMap))
    .join("");

  logger.info({ newRowsCount: accounts.slice(0, qty).length, newRowsPreview: newRows.slice(0, 500) }, "Generated new rows");

  wsXml = wsXml.replace("</sheetData>", newRows + "</sheetData>");
  logger.info({ wsXmlFinalLength: wsXml.length }, "Updated worksheet XML");

  zip.updateFile(sheetEntry, Buffer.from(wsXml, "utf8"));
  const output = zip.toBuffer() as Buffer;
  logger.info({ outputSize: output.length }, "fillXlsxBuffer: complete");
  return output;
}

function formatCredentials(accounts: ParsedAccount[]): string {
  return accounts
    .map((a, idx) => `${idx + 1}) ${a.parts.join(" | ")}`)
    .join("\n");
}

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.post("/prepare-order", async (req, res) => {
  try {
    const { title, quantity, orderId } = req.body as { title: string; quantity: number | string; orderId?: string };
    if (!title || !quantity) {
      res.status(400).json({ error: "title and quantity are required" });
      return;
    }

    const qty = parseInt(String(quantity), 10);
    const mappings = loadMappings();
    const rawMapping = mappings[title];
    if (!rawMapping) {
      res.status(404).json({ error: `No mapping found for title: "${title}"` });
      return;
    }

    const mapping = normalizeMappingEntry(rawMapping);
    if (!mapping.serviceId) {
      res.status(400).json({ error: `Invalid mapping config for title: "${title}"` });
      return;
    }

    const accounts = await purchaseAccounts(mapping.serviceId, qty, mapping.separator);
    res.json({
      ok: true,
      orderId: orderId || "",
      title,
      productId: mapping.serviceId,
      deliveryMethod: mapping.deliveryMethod || "file",
      columnMap: mapping.columnMap || { email: "A", password: "B" },
      accounts,
      formattedCredentials: formatCredentials(accounts),
    });
  } catch (err) {
    logger.error({ err }, "prepare-order failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/process-order", upload.single("file"), async (req, res) => {
  try {
    const { title, quantity, orderId } = req.body as { title: string; quantity: string; orderId?: string };

    logger.info({ title, quantity, orderId, hasFile: !!req.file, fileSize: req.file?.size }, "process-order: received request");

    if (!title || !quantity) {
      res.status(400).json({ error: "title and quantity are required" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "file is required" });
      return;
    }
    if (!orderId) {
      res.status(400).json({ error: "orderId is required" });
      return;
    }

    const qty = parseInt(quantity, 10);
    const mappings = loadMappings();
    const rawMapping = mappings[title];
    if (!rawMapping) {
      logger.warn({ title, availableKeys: Object.keys(mappings) }, "No mapping found for title");
      res.status(404).json({ error: `No mapping found for title: "${title}"` });
      return;
    }
    const mapping = normalizeMappingEntry(rawMapping);
    logger.info({ mapping }, "Mapping resolved");

    if ((mapping.deliveryMethod || "file") !== "file") {
      const accounts = await purchaseAccounts(mapping.serviceId, qty, mapping.separator);
      res.json({
        ok: true,
        deliveryMethod: mapping.deliveryMethod,
        columnMap: mapping.columnMap,
        accounts,
        formattedCredentials: formatCredentials(accounts),
      });
      return;
    }

    const cached = getCachedFile(orderId);
    if (cached) {
      const outputFilename = req.file.originalname || `${orderId}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${outputFilename}"`);
      res.send(cached);
      return;
    }

    logger.info({ title, productId: mapping.serviceId, quantity: qty, orderId }, "Purchasing from Lfollowers");
    const accounts = await purchaseAccounts(mapping.serviceId, qty, mapping.separator);
    logger.info({ accountsCount: accounts.length, firstAccount: accounts[0] }, "Accounts purchased");

    const columnMap = mapping.columnMap || { email: "A", password: "B" };
    logger.info({ qty, accounts: accounts.length, columnMap }, "Filling template via ZIP+XML surgery");

    const outputBuffer = fillXlsxBuffer(req.file.buffer, accounts, qty, columnMap);
    logger.info({ outputSize: outputBuffer.length }, "Template filled, saving to cache");
    saveCachedFile(orderId, outputBuffer);

    const outputFilename = req.file.originalname || `${orderId}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${outputFilename}"`);
    res.send(outputBuffer);
  } catch (err) {
    logger.error({ err }, "process-order failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/order-cache", (_req, res) => {
  const files = fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR) : [];
  res.json({ count: files.length, orders: files.map((f) => f.replace(".xlsx", "")) });
});

router.delete("/order-cache/:orderId", (req, res) => {
  const p = cacheFilePath(req.params.orderId);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    res.json({ ok: true, message: `Cache cleared for ${req.params.orderId}` });
  } else {
    res.status(404).json({ error: "Not in cache" });
  }
});

router.delete("/order-cache", (_req, res) => {
  const files = fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR) : [];
  files.forEach((f) => fs.unlinkSync(path.join(CACHE_DIR, f)));
  res.json({ ok: true, message: `Cleared ${files.length} cached orders` });
});

export default router;