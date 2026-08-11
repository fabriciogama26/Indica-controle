export function formatDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "-";
  }
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

// Etapa da Programacao Normalizada pode ter N equipes ativas ao mesmo tempo
// (diferente do legado, que era 1 equipe por linha) — mostra a lista inteira em
// vez de esconder as demais.
export function formatNameList(names: string[]) {
  return names.length ? names.join(", ") : "-";
}

export function formatDaysSince(value: number | null) {
  if (value === null) return "-";
  if (value < 0) return `em ${Math.abs(value)} dias`;
  if (value === 0) return "hoje";
  if (value === 1) return "ha 1 dia";
  return `ha ${value} dias`;
}
