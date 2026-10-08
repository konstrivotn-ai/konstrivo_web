/**
 * Phase 2 — Lightweight CSV Parser
 *
 * Handles CSV/TSV with comma, semicolon, or tab delimiters.
 * Supports quoted fields with embedded delimiters and newlines.
 * No external dependency.
 */

export interface CsvRow {
  [key: string]: string;
}

export function parseCsv(content: string): CsvRow[] {
  const lines = splitCsvLines(content);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length === 0) continue; // skip empty lines

    const row: CsvRow = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] !== undefined ? values[idx] : '';
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Parse a catalog CSV while supporting the widespread headerless shape:
 *   material_code, material_name, price_ht, unit
 *
 * Detection uses the first record as data only when its third value is a
 * valid number. This keeps normal headered CSV files on the original path.
 */
export function parseCatalogCsv(content: string): {
  rows: CsvRow[];
  headers: string[];
  headerless: boolean;
} {
  let clean = String(content || '').replace(/^\uFEFF/, '');
  // Excel/LibreOffice may prepend a delimiter directive (`sep=;` or `sep=,`).
  // It is metadata, not a header. Leaving it in place makes every canonical
  // field appear "Non mappé", exactly as in the reported Admin screenshot.
  clean = clean.replace(/^\s*(?:sep|delimiter)\s*=\s*[,;\t|]\s*(?:\r\n|\n|\r)/i, '');
  // Ignore empty lines before the first actual record.
  clean = clean.replace(/^(?:[\t ]*(?:\r\n|\n|\r))+/, '');
  // Bulletin / spreadsheet exports (HK Census, ERP "print-to-CSV", …) start
  // with title + date rows that hold a SINGLE populated cell. They are
  // metadata, never a header: taking them as the header collapses every real
  // column into one `''` key (only the last value per row survives), so all
  // canonical fields show « — Non mappé — » and every row fails with
  // "Missing Reference". Skipping them keeps the REAL header as record #1.
  // The `<= 1 populated cell` test cannot match an existing file shape: a
  // headered CSV has >= 2 populated header cells, a headerless record >= 3.
  {
    const records = clean.split(/\r\n|\n|\r/);
    const populatedCells = (line: string): number =>
      line.split(detectDelimiter(line)).filter((cell) => cell.trim() !== '').length;
    let firstRecord = 0;
    while (
      firstRecord < records.length &&
      records[firstRecord].trim() !== '' &&
      populatedCells(records[firstRecord]) <= 1
    ) {
      firstRecord++;
    }
    // Strip ONLY when a REAL record follows (>= 2 populated cells: a header
    // row or a headerless data row). Otherwise the content is returned
    // UNCHANGED — exactly the pre-fix behaviour for files that hold nothing
    // but metadata lines (they end up as "no header row" / "empty file").
    if (firstRecord > 0 && firstRecord < records.length && populatedCells(records[firstRecord]) >= 2) {
      clean = records.slice(firstRecord).join('\n');
    }
  }
  const canonicalHeaders = ['material_code', 'material_name', 'price_ht', 'unit'];
  const withSyntheticHeader = parseCsv(`${canonicalHeaders.join(',')}\n${clean}`);
  const first = withSyntheticHeader[0];
  const price = first
    ? Number(String(first.price_ht || '').trim().replace(/\s/g, '').replace(',', '.'))
    : NaN;
  const headerless = Boolean(
    first &&
    String(first.material_code || '').trim() &&
    String(first.material_name || '').trim() &&
    Number.isFinite(price) &&
    String(first.unit || '').trim()
  );
  if (headerless) {
    return { rows: withSyntheticHeader, headers: canonicalHeaders, headerless: true };
  }
  const rows = parseCsv(clean);
  return { rows, headers: rows[0] ? Object.keys(rows[0]) : [], headerless: false };
}

/** Split content into lines, respecting quoted newlines. */
function splitCsvLines(content: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '""';
      i += 2;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      i++;
      continue;
    }

    if ((char === '\n' || char === '\r\n' || (char === '\r' && !inQuotes)) && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 2;
      } else {
        i++;
      }
      lines.push(current);
      current = '';
      continue;
    }

    current += char;
    i++;
  }

  if (current.trim() !== '') {
    lines.push(current);
  }

  return lines;
}

/** Parse a single CSV line into values. */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let autoQuotes = false;
  let i = 0;

  // Detect delimiter
  const delimiter = detectDelimiter(line);

  while (i < line.length) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      autoQuotes = true;
      i++;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(stripQuotes(current.trim()));
      current = '';
      autoQuotes = false;
      i++;
      continue;
    }

    current += char;
    i++;
  }

  values.push(stripQuotes(current.trim()));

  return values;
}

function detectDelimiter(line: string): string {
  // Check for tab first, then semicolon, then comma
  let tab = 0, semi = 0, comma = 0;
  for (const ch of line) {
    if (ch === '\t') tab++;
    else if (ch === ';') semi++;
    else if (ch === ',') comma++;
  }
  if (tab >= semi && tab >= comma && tab > 0) return '\t';
  if (semi >= comma && semi > 0) return ';';
  return ',';
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/""/g, '"');
  }
  return value;
}

/** Generate a sample CSV matching the existing CatalogUploadModal format. */
export function generateSampleCsv(): string {
  return `Reference,Designation,Categorie,Unite,Prix_HT_TND
PLA-BA13-STD,Plaque de plâtre BA13 Standard 1.2x2.5m,placo,unit,31.500
PLA-BA13-HYD,Plaque de plâtre BA13 Hydrofuge Verte 1.2x2.5m,placo,unit,47.800
ISOL-VERRE50,Laine de verre avec kraft 50mm (Rouleau 15m²),isolation,rouleau,78.000
DAL-VINYL60,Dalle de plafond démontable vinyle 60x60cm,placo,unit,5.800`;
}
