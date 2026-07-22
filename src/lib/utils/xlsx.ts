type FormatWorksheetDateColumnParams = {
  columnLetter: string;
  dataRowCount: number;
  numberFormat?: string;
};

export function formatWorksheetDateColumn(
  worksheet: unknown,
  { columnLetter, dataRowCount, numberFormat = "dd/mm/yyyy" }: FormatWorksheetDateColumnParams,
) {
  const cells = worksheet as Record<string, { v?: unknown; z?: string } | undefined>;

  for (let rowIndex = 2; rowIndex <= dataRowCount + 1; rowIndex += 1) {
    const cell = cells[`${columnLetter}${rowIndex}`];
    if (!cell || typeof cell !== "object" || cell.v === "" || cell.v === null || cell.v === undefined) {
      continue;
    }

    cell.z = numberFormat;
  }
}
