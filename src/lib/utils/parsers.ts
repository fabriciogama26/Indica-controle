export function parseCsvLine(line: string, delimiter: "," | ";" = ";"): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

export function parseCsvRows(content: string, delimiter: "," | ";" = ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(current.trim());
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current || row.length) {
    row.push(current.trim());
    rows.push(row);
  }

  return rows;
}

export const LATITUDE_LIMIT = 90;
export const LONGITUDE_LIMIT = 180;
const DECIMAL_DEGREES_SCALE = 6;

/**
 * Converte um valor em graus decimais (formato aceito pelo Google Maps, ex.: -23.550520).
 * Aceita virgula como separador decimal e o simbolo de grau; devolve `null` quando o texto
 * nao e um numero valido ou estoura o limite do eixo.
 */
export function parseDecimalDegrees(value: unknown, limit: number) {
  let numeric: number;

  if (typeof value === "number") {
    numeric = value;
  } else {
    // Campo vazio nunca pode virar 0 (coordenada valida no meio do Atlantico).
    const raw = String(value ?? "").replace(/[°\s]/g, "").replace(",", ".");
    if (!/^-?\d{1,3}(?:\.\d+)?$/.test(raw)) {
      return null;
    }
    numeric = Number(raw);
  }

  if (!Number.isFinite(numeric) || Math.abs(numeric) > limit) {
    return null;
  }

  return Number(numeric.toFixed(DECIMAL_DEGREES_SCALE));
}

export function parseLatitude(value: unknown) {
  return parseDecimalDegrees(value, LATITUDE_LIMIT);
}

export function parseLongitude(value: unknown) {
  return parseDecimalDegrees(value, LONGITUDE_LIMIT);
}

/**
 * Separa o par "latitude, longitude" que o Google Maps copia para a area de transferencia.
 * Devolve `null` quando o texto nao e um par completo, para o valor seguir como digitacao normal.
 */
export function splitDecimalDegreesPair(value: string) {
  const match = String(value ?? "").trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  const latitude = parseLatitude(match[1]);
  const longitude = parseLongitude(match[2]);
  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude: String(latitude), longitude: String(longitude) };
}

export function formatDecimalDegrees(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : "";
}
