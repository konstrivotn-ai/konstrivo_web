/**
 * Phase C — Safe server-side XLSX parsing (Excel/ExcelJS wrapper)
 *
 * Converts the first suitable worksheet of an .xlsx workbook into the SAME
 * row shape the shared CSV parser produces (Record<rawHeader, string>), so
 * both file types flow through one catalog import pipeline
 * (server/services/catalogImport.ts).
 *
 * Safety rules (Phase C):
 *  - Only the ZIP-based .xlsx OOXML format is accepted (magic bytes "PK");
 *    legacy binary .xls (BIFF) is NOT supported and is rejected here.
 *  - Parsing never evaluates spreadsheet formulas: formula cells return
 *    their cached result value only (no arbitrary code execution).
 *  - Hard sanity caps (worksheets / columns / rows) protect the server from
 *    decompression bombs inside the 10 MB upload limit.
 *  - Any structural problem → { ok: false, error } with a SHORT, generic
 *    message (never stack traces or internal paths).
 */
import ExcelJS from 'exceljs';
import type { CsvRow } from './csv';

export interface ParsedXlsx {
  ok: true;
  sheetName: string;
  headerRowNumber: number;
  headers: string[];
  rows: CsvRow[];
}

export interface ParsedXlsxFailure {
  ok: false;
  error: string;
}

/** Sanity caps — an import is at most 1000 data rows; leave headroom for
 *  cosmetic (empty) rows/columns that get skipped. */
const MAX_SHEETS = 32;
const MAX_COLS = 256;
const MAX_ROWS_SCANNED = 5000;
const MAX_HEADER_SEARCH_ROWS = 10;

/**
 * Normalize a single ExcelJS cell value to the plain text used by the import
 * pipeline. Formula cells contribute their CACHED result (never evaluated);
 * errors/rich objects are flattened defensively.
 */
function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    // Formula: use the cached result only (never re-evaluate formulas).
    if ('result' in (value as any)) return cellToText((value as any).result);
    // Hyperlink: use the display text.
    if ('text' in (value as any)) return cellToText((value as any).text);
    // Rich text: concatenate the runs.
    if (Array.isArray((value as any).richText)) {
      return (value as any).richText.map((r: any) => cellToText(r?.text ?? '')).join('').trim();
    }
    // Shared formula / error object / anything else → ignore safely.
    if ('error' in (value as any)) return '';
    return '';
  }
  return '';
}

/** Check the ZIP local-file-header magic ("PK\x03\x04" or empty "PK\x05\x06"). */
export function looksLikeZip(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  const isPkJunk = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  const isPkEmpty = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x05 && buffer[3] === 0x06;
  return isPkJunk || isPkEmpty;
}
/**
 * Parse an XLSX upload into { headers, rows } using the same conventions as
 * the CSV import: raw header texts become row keys; all values are trimmed
 * strings; empty trailing rows are skipped.
 *
 * Header detection: the first row (within the first 10 rows) containing at
 * least 2 non-empty cells where at least one cell is non-numeric text.
 * Files with a title/banner row are therefore still imported correctly.
 */
export async function parseXlsxToRows(buffer: Buffer): Promise<ParsedXlsx | ParsedXlsxFailure> {
  try {
    if (!looksLikeZip(buffer)) {
      return { ok: false, error: 'The file is not a valid .xlsx workbook (missing ZIP signature).' };
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sheets = workbook.worksheets || [];
    if (sheets.length > MAX_SHEETS) {
      return { ok: false, error: 'The workbook has too many worksheets.' };
    }
    const sheet = pickWorksheet(workbook);
    if (!sheet) {
      return { ok: false, error: 'The workbook does not contain any worksheet.' };
    }

    const colCount = Math.min(Math.max(sheet.columnCount || 0, 0), MAX_COLS);
    if ((sheet.rowCount || 0) > MAX_ROWS_SCANNED) {
      return { ok: false, error: 'The worksheet is too large to import.' };
    }
    const totalRows = Math.min(Math.max(sheet.rowCount || 0, 0), MAX_ROWS_SCANNED);

    // ── 1) Locate the header row ────────────────────────────────────────────
    let headerRowNumber = 0;
    let headerValues: string[] = [];
    for (let r = 1; r <= Math.min(totalRows, MAX_HEADER_SEARCH_ROWS); r++) {
      const row = sheet.getRow(r);
      const cells: string[] = [];
      let nonEmpty = 0;
      let nonNumeric = 0;
      for (let c = 1; c <= colCount; c++) {
        const text = cellToText(row.getCell(c).value);
        cells.push(text);
        if (text !== '') {
          nonEmpty++;
          // A fully numeric row is treated as data, not as headers.
          if (!/^-?\d+([.,]\d+)?$/.test(text)) nonNumeric++;
        }
      }
      if (nonEmpty >= 2 && nonNumeric >= 1) {
        headerRowNumber = r;
        headerValues = cells;
        break;
      }
    }
    if (headerRowNumber === 0) {
      return { ok: false, error: 'No header row could be detected in the first worksheet.' };
    }

    // ── 2) Keep only columns that have a non-empty header text ─────────────
    //     (xlsx files often contain styled-but-empty trailing columns).
    const keptCols: Array<{ colIndex: number; header: string }> = [];
    for (let c = 0; c < headerValues.length; c++) {
      const header = headerValues[c];
      if (header !== '') keptCols.push({ colIndex: c + 1, header });
    }
    if (keptCols.length === 0) {
      return { ok: false, error: 'The header row contains no usable column names.' };
    }
    const headers = keptCols.map((k) => k.header);

    // Duplicate headers would silently overwrite each other in row objects.
    // Make duplicates addressable by suffixing " #2", " #3", … so Admin can
    // still map them explicitly.
    const seen = new Map<string, number>();
    const uniqueHeaders = headers.map((h) => {
      const n = (seen.get(h) || 0) + 1;
      seen.set(h, n);
      return n === 1 ? h : `${h} #${n}`;
    });

    // ── 3) Extract data rows ───────────────────────────────────────────────
    const rows: CsvRow[] = [];
    for (let r = headerRowNumber + 1; r <= totalRows; r++) {
      const row = sheet.getRow(r);
      const record: CsvRow = {};
      let anyValue = false;
      for (let i = 0; i < keptCols.length; i++) {
        const text = cellToText(row.getCell(keptCols[i].colIndex).value);
        if (text !== '') anyValue = true;
        record[uniqueHeaders[i]] = text;
      }
      // Skip fully empty spreadsheet rows (very common below the data).
      if (anyValue) rows.push(record);
    }

    return { ok: true, sheetName: sheet.name || 'Sheet1', headerRowNumber, headers: uniqueHeaders, rows };
  } catch {
    // Deliberately generic: never leak zip/xml internals to the client.
    return { ok: false, error: 'The file could not be parsed as an .xlsx workbook. Re-save it as Excel Workbook (.xlsx) and try again.' };
  }
}

/**
 * Pick the first suitable worksheet: the first VISIBLE sheet, falling back to
 * the first sheet when visibility metadata is absent.
 */
function pickWorksheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet | undefined {
  const sheets = workbook.worksheets || [];
  if (sheets.length === 0) return undefined;
  const visible = sheets.find((ws) => (ws.state ?? 'visible') === 'visible');
  return visible || sheets[0];
}
