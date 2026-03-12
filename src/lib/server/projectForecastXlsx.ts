import * as XLSX from "xlsx";

const CODE_HEADERS = ["codigo"];
const QTY_HEADERS = ["quantidade"];

export type ParsedProjectForecastRow = {
  line: number;
  code: string;
  qtyPlanned: number;
};

export type ParsedProjectForecastResult = {
  rows: ParsedProjectForecastRow[];
  errors: string[];
};

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function parsePositiveNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const raw = normalizeText(value);
  if (!raw) {
    return null;
  }

  let normalized = raw.replace(/\s+/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

function pickHeaderKey(headers: string[], aliases: string[]) {
  for (const alias of aliases) {
    if (headers.includes(alias)) {
      return alias;
    }
  }

  return null;
}

export function buildProjectForecastTemplateWorkbook() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["codigo", "quantidade"],
    ["210232", "1"],
  ]);

  worksheet["!cols"] = [{ wch: 22 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, "MateriaisPrevistos");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export function parseProjectForecastWorkbook(content: ArrayBuffer): ParsedProjectForecastResult {
  const workbook = XLSX.read(Buffer.from(content), { type: "buffer", cellDates: false, raw: false });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return { rows: [], errors: ["Planilha XLSX sem abas."] };
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
    raw: false,
  });

  if (rawRows.length === 0) {
    return { rows: [], errors: ["Planilha vazia. Preencha ao menos uma linha."] };
  }

  const firstRow = rawRows[0] ?? {};
  const normalizedToOriginal = new Map<string, string>();
  for (const key of Object.keys(firstRow)) {
    normalizedToOriginal.set(normalizeHeader(key), key);
  }

  const normalizedHeaders = Array.from(normalizedToOriginal.keys());
  const codeHeader = pickHeaderKey(normalizedHeaders, CODE_HEADERS);
  const qtyHeader = pickHeaderKey(normalizedHeaders, QTY_HEADERS);

  if (!codeHeader || !qtyHeader) {
    return {
      rows: [],
      errors: ["Cabecalho invalido. Use o modelo oficial com as colunas: codigo, quantidade."],
    };
  }

  const codeKey = normalizedToOriginal.get(codeHeader) ?? "";
  const qtyKey = normalizedToOriginal.get(qtyHeader) ?? "";

  const rows: ParsedProjectForecastRow[] = [];
  const errors: string[] = [];

  rawRows.forEach((row, index) => {
    const line = index + 2;
    const rawCode = normalizeText(row[codeKey]).toUpperCase();
    const rawQty = row[qtyKey];

    if (!rawCode && !normalizeText(rawQty)) {
      return;
    }

    if (!rawCode) {
      errors.push(`Linha ${line}: codigo obrigatorio.`);
      return;
    }

    const qtyPlanned = parsePositiveNumber(rawQty);
    if (qtyPlanned === null) {
      errors.push(`Linha ${line}: quantidade invalida.`);
      return;
    }

    rows.push({
      line,
      code: rawCode,
      qtyPlanned,
    });
  });

  if (rows.length === 0 && errors.length === 0) {
    errors.push("Nenhuma linha valida encontrada para importacao.");
  }

  return { rows, errors };
}
