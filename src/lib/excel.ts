import * as XLSX from "xlsx-js-style";

export type ExcelColumn<Row> = {
  key: keyof Row & string;
  label: string;
  width: number;
  format?: string;
};

export function createExcelSheet<Row extends Record<string, string | number>>(
  title: string,
  subtitle: string,
  rows: Row[],
  columns: ExcelColumn<Row>[],
) {
  const headers = columns.map((column) => column.label);
  const worksheet = XLSX.utils.aoa_to_sheet([[title], [subtitle], [], headers]);
  const values = rows.map((row) => columns.map((column) => row[column.key]));
  if (values.length) {
    XLSX.utils.sheet_add_aoa(worksheet, values, { origin: "A5" });
  }

  const lastColumn = XLSX.utils.encode_col(columns.length - 1);
  const lastRow = Math.max(3, values.length + 3);
  worksheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: columns.length - 1 } },
  ];
  worksheet["!cols"] = columns.map((column) => ({ wch: column.width }));
  worksheet["!rows"] = [{ hpt: 26 }, { hpt: 18 }, { hpt: 8 }, { hpt: 22 }];
  worksheet["!autofilter"] = { ref: `A4:${lastColumn}${lastRow + 1}` };

  const border = {
    bottom: { style: "thin", color: { rgb: "D9E4DC" } },
  };
  const titleStyle = {
    fill: { fgColor: { rgb: "176E3A" } },
    font: { name: "Aptos Display", sz: 16, bold: true, color: { rgb: "FFFFFF" } },
    alignment: { vertical: "center" },
  };
  const subtitleStyle = {
    fill: { fgColor: { rgb: "F1F7F2" } },
    font: { name: "Aptos", sz: 9, italic: true, color: { rgb: "52635A" } },
    alignment: { vertical: "center" },
  };
  const headerStyle = {
    fill: { fgColor: { rgb: "176E3A" } },
    font: { name: "Aptos", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
    alignment: { vertical: "center", wrapText: true },
    border,
  };

  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const titleCell = worksheet[XLSX.utils.encode_cell({ r: 0, c: columnIndex })];
    const subtitleCell = worksheet[XLSX.utils.encode_cell({ r: 1, c: columnIndex })];
    const headerCell = worksheet[XLSX.utils.encode_cell({ r: 3, c: columnIndex })];
    if (titleCell) titleCell.s = titleStyle;
    if (subtitleCell) subtitleCell.s = subtitleStyle;
    if (headerCell) headerCell.s = headerStyle;
  }

  columns.forEach((column, columnIndex) => {
    for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex + 4, c: columnIndex })];
      if (!cell) continue;
      cell.s = {
        font: { name: "Aptos", sz: 10, color: { rgb: "26332B" } },
        alignment: { vertical: "center" },
        border,
        fill: {
          fgColor: { rgb: rowIndex % 2 === 0 ? "FFFFFF" : "F6F8F6" },
        },
      };
      if (column.format && cell.t === "n") cell.z = column.format;
    }
  });

  return worksheet;
}

export function excelGeneratedAt() {
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
}
