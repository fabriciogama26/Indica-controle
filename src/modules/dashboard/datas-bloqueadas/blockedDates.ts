import {
  BLOCKED_DATE_KIND_LABELS,
  BLOCKED_DATE_SCOPE_LABELS,
  type ActiveBlockedDate,
} from "./types";

/**
 * Casamento por NOME de municipio, nao por id.
 *
 * As telas consumidoras carregam o municipio do projeto como texto: o catalogo
 * da Programacao devolve `city` a partir de `project_with_labels.city_text` e a
 * lista de etapas devolve o mesmo campo. Os dois lados — esse texto e o
 * `municipalityName` de `/api/blocked-dates/vigentes` — sao lidos AO VIVO de
 * `project_municipalities.name`, entao renomear um municipio move os dois
 * juntos. E `project_municipalities` tem `unique (tenant_id, name_normalized)`,
 * o que impede dois municipios com o mesmo nome no tenant.
 */
export function normalizeMunicipalityName(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

/**
 * Datas bloqueadas que valem para uma data e um municipio.
 *
 * NACIONAL sempre entra. MUNICIPAL so entra quando o municipio casa. Quando o
 * municipio nao e conhecido (`cityName` vazio), as MUNICIPAIS ficam de fora: e
 * melhor nao avisar do que avisar sobre um feriado de outra cidade.
 */
export function findBlockedDatesFor(
  blockedDates: ActiveBlockedDate[],
  isoDate: string,
  cityName: string | null | undefined,
) {
  if (!isoDate) {
    return [] as ActiveBlockedDate[];
  }

  const normalizedCity = normalizeMunicipalityName(cityName);

  return blockedDates.filter((item) => {
    if (item.blockedDate !== isoDate) {
      return false;
    }
    if (item.scope === "NACIONAL") {
      return true;
    }
    return Boolean(normalizedCity) && normalizeMunicipalityName(item.municipalityName) === normalizedCity;
  });
}

/** Rotulo curto para chip, cartao e item de lista. */
export function formatBlockedDateLabel(item: ActiveBlockedDate) {
  const kind = BLOCKED_DATE_KIND_LABELS[item.kind] ?? item.kind;
  const scope =
    item.scope === "MUNICIPAL" && item.municipalityName
      ? `${BLOCKED_DATE_SCOPE_LABELS.MUNICIPAL} - ${item.municipalityName}`
      : BLOCKED_DATE_SCOPE_LABELS[item.scope] ?? item.scope;

  return `${item.description} (${kind}, ${scope})`;
}

export function formatBlockedDateShort(isoDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return isoDate;
  }
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/** Primeiro e ultimo dia do mes de `isoDate`, para a janela do Mapa. */
export function getMonthWindow(isoDate: string) {
  const reference = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : new Date().toISOString().slice(0, 10);
  const [year, month] = reference.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthLabel = String(month).padStart(2, "0");

  return {
    from: `${year}-${monthLabel}-01`,
    to: `${year}-${monthLabel}-${String(lastDay).padStart(2, "0")}`,
  };
}
