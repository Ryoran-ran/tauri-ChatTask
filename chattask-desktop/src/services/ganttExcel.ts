import type { PlannedRange } from "../types";
import { xmlEscape, zipFiles } from "./xmlSpreadsheet";

export interface GanttExcelRow {
  kind: string;
  title: string;
  status: string;
  priority: string;
  depth: number;
  baselineRanges: PlannedRange[];
  plannedRanges: PlannedRange[];
  actualDates: string[];
  achievedDates: string[];
  plannedHours: number;
  actualHours: number;
  dueDate: string;
}

type GanttExcelDisplay = "compare" | "planned" | "actual";

const columnName = (index: number) => {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
};
const inlineCell = (column: number, row: number, value: string, style: number) => `<c r="${columnName(column)}${row}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
const numberCell = (column: number, row: number, value: number, style: number) => `<c r="${columnName(column)}${row}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
const styledCell = (column: number, row: number, style: number, value = "") => value ? inlineCell(column, row, value, style) : `<c r="${columnName(column)}${row}" s="${style}"/>`;
const includesDate = (ranges: PlannedRange[], date: string) => ranges.some((range) => range.startDate <= date && range.endDate >= date);

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4"><font><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FF0F172A"/><sz val="14"/><name val="Aptos"/></font><font><color rgb="FF64748B"/><sz val="9"/><name val="Aptos"/></font></fonts>
  <fills count="11"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF334155"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF60A5FA"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF22C55E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0D9488"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFCBD5E1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF59E0B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEF4444"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE2E8F0"/></left><right style="thin"><color rgb="FFE2E8F0"/></right><top style="thin"><color rgb="FFE2E8F0"/></top><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="20">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0"/><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0"/><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0"/><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="7" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="8" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="9" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="0"/></xf><xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf><xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="2"/></xf><xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="3"/></xf><xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="4"/></xf><xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="5"/></xf><xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="6"/></xf><xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="7"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export const createGanttExcel = ({ title, start, end, dates, rows, display, nonWorkingDates, today }: {
  title: string;
  start: string;
  end: string;
  dates: string[];
  rows: GanttExcelRow[];
  display: GanttExcelDisplay;
  nonWorkingDates: Set<string>;
  today: string;
}) => {
  const fixedHeaders = ["種別", "項目", "状態", "優先度", "予定工数", "実績工数"];
  const lastColumn = columnName(fixedHeaders.length + dates.length - 1);
  const titleRow = `<row r="1" ht="25" customHeight="1">${inlineCell(0, 1, title, 19)}</row>`;
  const note = `表示期間 ${start}〜${end}　予定：青　実績：緑　予定＋実績：青緑　当初予定：灰色　期限：赤`;
  const noteRow = `<row r="2" ht="20" customHeight="1">${inlineCell(0, 2, note, 0)}</row>`;
  const headerCells = fixedHeaders.map((value, index) => inlineCell(index, 3, value, 1));
  dates.forEach((date, index) => {
    const style = date === today ? 9 : nonWorkingDates.has(date) ? 8 : 1;
    headerCells.push(inlineCell(fixedHeaders.length + index, 3, `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`, style));
  });
  const headerRow = `<row r="3" ht="24" customHeight="1">${headerCells.join("")}</row>`;
  const dataRows = rows.map((item, index) => {
    const rowNumber = index + 4;
    const actualDates = new Set([...item.actualDates, ...item.achievedDates]);
    const values = [
      inlineCell(0, rowNumber, item.kind, 2),
      inlineCell(1, rowNumber, item.title, 11 + Math.min(7, Math.max(0, item.depth))),
      inlineCell(2, rowNumber, item.status, 2),
      inlineCell(3, rowNumber, item.priority, 3),
      numberCell(4, rowNumber, item.plannedHours, 3),
      numberCell(5, rowNumber, item.actualHours, 3),
    ];
    dates.forEach((date, dateIndex) => {
      const planned = display !== "actual" && includesDate(item.plannedRanges, date);
      const actual = display !== "planned" && actualDates.has(date);
      const baseline = display === "compare" && includesDate(item.baselineRanges, date);
      const deadline = item.dueDate === date;
      const style = planned && actual ? 6 : actual ? 5 : planned ? 4 : baseline ? 7 : deadline ? 10 : 3;
      values.push(styledCell(fixedHeaders.length + dateIndex, rowNumber, style, deadline ? "◆" : ""));
    });
    return `<row r="${rowNumber}" ht="20" customHeight="1" outlineLevel="${Math.min(7, Math.max(0, item.depth))}">${values.join("")}</row>`;
  }).join("");
  const dateColumns = dates.map((_, index) => `<col min="${fixedHeaders.length + index + 1}" max="${fixedHeaders.length + index + 1}" width="5.5" customWidth="1"/>`).join("");
  // SpreadsheetMLでは autoFilter が mergeCells より前にある必要がある。
  // 要素順が逆だとZIP自体は正常でも、Excelが修復対象のファイルと判定する。
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><outlinePr summaryBelow="0"/></sheetPr><dimension ref="A1:${lastColumn}${rows.length + 3}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="6" ySplit="3" topLeftCell="G4" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="12" customWidth="1"/><col min="2" max="2" width="38" customWidth="1"/><col min="3" max="3" width="16" customWidth="1"/><col min="4" max="4" width="10" customWidth="1"/><col min="5" max="6" width="12" customWidth="1"/>${dateColumns}</cols><sheetData>${titleRow}${noteRow}${headerRow}${dataRows}</sheetData><autoFilter ref="A3:F${rows.length + 3}"/><mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells></worksheet>`;
  return zipFiles([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ガントチャート" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: stylesXml },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml },
  ]);
};
