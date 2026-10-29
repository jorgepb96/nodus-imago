// Adapted from Nodus electron/export/databaseExport.ts. AGPL-3.0-only.
import AdmZip from "adm-zip";
import type { ExportCell } from "../../shared/databaseExport";
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Excel column letter for a 0-based index (0→A, 26→AA). */
function colLetter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function cellXml(ref: string, cell: ExportCell): string {
  if (cell.numeric != null) return `<c r="${ref}"><v>${cell.numeric}</v></c>`;
  if (!cell.text) return `<c r="${ref}"/>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell.text)}</t></is></c>`;
}

function rowXml(rowIndex: number, cells: ExportCell[]): string {
  const r = rowIndex + 1;
  const inner = cells.map((c, i) => cellXml(`${colLetter(i)}${r}`, c)).join("");
  return `<row r="${r}">${inner}</row>`;
}

export interface XlsxSheet {
  /** Already valid for Excel: ≤31 characters, none of []:*?/\, unique. */
  name: string;
  header: string[];
  body: ExportCell[][];
}

export function buildXlsx(header: string[], body: ExportCell[][]): Buffer {
  return buildXlsxWorkbook([{ name: "Datos", header, body }]);
}

/** One worksheet per entry, in order. */
export function buildXlsxWorkbook(sheets: XlsxSheet[]): Buffer {
  const list = sheets.length
    ? sheets
    : [{ name: "Datos", header: [], body: [] }];
  const sheetXml = (sheet: XlsxSheet) => {
    const headerCells: ExportCell[] = sheet.header.map((h) => ({
      text: h,
      numeric: null,
    }));
    const rowsXml = [
      rowXml(0, headerCells),
      ...sheet.body.map((cells, i) => rowXml(i + 1, cells)),
    ].join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
  };
  const overrides = list
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const sheetEntries = list
    .map(
      (sheet, i) =>
        `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join("");
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`;
  const sheetRels = list
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("");
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}</Relationships>`;

  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(contentTypes, "utf8"));
  zip.addFile("_rels/.rels", Buffer.from(rels, "utf8"));
  zip.addFile("xl/workbook.xml", Buffer.from(workbook, "utf8"));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRels, "utf8"));
  list.forEach((sheet, i) =>
    zip.addFile(
      `xl/worksheets/sheet${i + 1}.xml`,
      Buffer.from(sheetXml(sheet), "utf8"),
    ),
  );
  return zip.toBuffer();
}
