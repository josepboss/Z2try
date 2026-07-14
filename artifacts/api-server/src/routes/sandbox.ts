import { Router } from "express";
import { createRequire } from "module";
import { logger } from "../lib/logger.js";

const router = Router();
const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");

// ── Types ─────────────────────────────────────────────────────────────────────
interface ParsedAccount {
  [key: string]: string;
  raw: string;
}

// ── XML escaping ──────────────────────────────────────────────────────────────
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function valueForField(account: ParsedAccount, field: string): string {
  return account[field] || "";
}

function buildRowXml(rowNum: number, account: ParsedAccount, columnMap: Record<string, string>): string {
  const cells = Object.entries(columnMap)
    .map(([field, col]) => ({ field, col: String(col || "").toUpperCase().trim() }))
    .filter((x) => /^[A-Z]+$/.test(x.col))
    .map(({ field, col }) => {
      const value = valueForField(account, field);
      if (!value) return "";
      return `<c r="${col}${rowNum}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
    })
    .filter(Boolean)
    .join("");

  return `<row r="${rowNum}">${cells}</row>`;
}

// ── Main processing ───────────────────────────────────────────────────────────
function fillXlsxBuffer(templateBuffer: Buffer, accounts: ParsedAccount[], columnMap: Record<string, string>): Buffer {
  const zip = new AdmZip(templateBuffer);
  const entries: string[] = zip.getEntries().map((e: { entryName: string }) => e.entryName);
  const sheetEntry = entries.find((n) => /xl\/worksheets\/sheet\d+\.xml/.test(n));
  if (!sheetEntry) throw new Error("Could not find worksheet XML in xlsx");

  let wsXml: string = zip.readAsText(sheetEntry);
  wsXml = wsXml.replace(/<row\s[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (match, rNum) =>
    parseInt(rNum, 10) >= 4 ? "" : match,
  );
  wsXml = wsXml.replace(/<sheetData\s*\/>/, "<sheetData></sheetData>");

  const newRows = accounts
    .map((a, i) => buildRowXml(4 + i, a, columnMap))
    .join("");

  wsXml = wsXml.replace("</sheetData>", newRows + "</sheetData>");
  zip.updateFile(sheetEntry, Buffer.from(wsXml, "utf8"));
  return zip.toBuffer() as Buffer;
}

// ── Endpoint ──────────────────────────────────────────────────────────────────
router.post("/sandbox/process", async (req, res) => {
  try {
    const { templateBytes, dataRows, columnMap } = req.body as {
      templateBytes: number[];
      dataRows: Array<{ [key: string]: string }>;
      columnMap: Record<string, string>;
    };

    if (!templateBytes?.length || !Array.isArray(templateBytes)) {
      res.status(400).json({ error: "templateBytes is required as a number array" });
      return;
    }
    if (!dataRows?.length) {
      res.status(400).json({ error: "dataRows is required and must be a non-empty array" });
      return;
    }
    if (!columnMap || typeof columnMap !== "object" || Array.isArray(columnMap)) {
      res.status(400).json({ error: "columnMap is required as an object mapping field names to column letters" });
      return;
    }

    const templateBuffer = Buffer.from(templateBytes);
    
    // Convert dataRows to ParsedAccount format (dynamic fields)
    const fieldNames = Object.keys(columnMap);
    const accounts: ParsedAccount[] = dataRows.map(row => {
      const account: ParsedAccount = { raw: '' };
      fieldNames.forEach(field => {
        account[field] = row[field] || "";
      });
      account.raw = fieldNames.map(f => row[f] || "").join(" | ");
      return account;
    });

    logger.info({ 
      qty: accounts.length, 
      fields: fieldNames, 
      columnMap 
    }, "Sandbox processing with dynamic mapping");

    const outputBuffer = fillXlsxBuffer(templateBuffer, accounts, columnMap);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Z2U_sandbox_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.xlsx"`);
    res.send(outputBuffer);
  } catch (err) {
    logger.error({ err }, "sandbox process failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;