// Constantes de dominio, normalizacao de estado da Programacao e calculo de prazos
// para o Cronograma de Solicitacoes Tecnicas.

export const TIPOS_SOLICITACAO = ["INSPECAO", "AS_BUILT", "LOCACAO"] as const;
export const PRIORIDADES = ["BAIXA", "MEDIA", "ALTA"] as const;
export const STATUS_ARMAZENADOS = ["PENDENTE", "CONCLUIDO", "CANCELADO"] as const;

export type TipoSolicitacao = (typeof TIPOS_SOLICITACAO)[number];
export type Prioridade = (typeof PRIORIDADES)[number];
export type StatusArmazenado = (typeof STATUS_ARMAZENADOS)[number];
export type StatusEfetivo = StatusArmazenado | "ATRASADO";

// Prazo automatico por prioridade (dias corridos). ALTA e manual.
export const PRAZO_DIAS_POR_PRIORIDADE: Record<Prioridade, number | null> = {
  BAIXA: 10,
  MEDIA: 5,
  ALTA: null,
};

// Estados da Programacao que liberam As Built (estado atual do projeto).
export const ASBUILT_ESTADOS_PERMITIDOS = new Set<string>([
  "CONCLUIDO",
  "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO",
]);

export function isTipoSolicitacao(value: unknown): value is TipoSolicitacao {
  return TIPOS_SOLICITACAO.includes(String(value ?? "").toUpperCase() as TipoSolicitacao);
}

export function isPrioridade(value: unknown): value is Prioridade {
  return PRIORIDADES.includes(String(value ?? "").toUpperCase() as Prioridade);
}

export function isIsoDate(value: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

// Normaliza o Estado Trabalho da Programacao para um token comparavel.
// Trata acentos e as duas grafias legadas: BENFICIO / BENEFICIO.
export function normalizeWorkCompletionToken(value: unknown): string {
  const token = String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  if (
    token === "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO"
    || token === "PARCIAL_PLANEJADO_BENFICIO_ATINGIDO"
  ) {
    return "PARCIAL_PLANEJADO_BENEFICIO_ATINGIDO";
  }

  return token;
}

export function isAsbuiltAllowedState(stateToken: string): boolean {
  return ASBUILT_ESTADOS_PERMITIDOS.has(normalizeWorkCompletionToken(stateToken));
}

// Data "hoje" do negocio, sempre em America/Sao_Paulo (evita erro de 1 dia por UTC).
export function businessToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function addDaysIso(dateIso: string, days: number): string {
  const parsed = new Date(`${dateIso}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return dateIso;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function diffDays(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

// Calcula a Data Limite. BAIXA/MEDIA sao automaticas; ALTA usa o valor manual informado.
export function resolveDataLimite(
  prioridade: Prioridade,
  dataEntrada: string,
  manualDataLimite: string | null,
): string | null {
  const dias = PRAZO_DIAS_POR_PRIORIDADE[prioridade];
  if (dias !== null) {
    return addDaysIso(dataEntrada, dias);
  }
  return manualDataLimite && isIsoDate(manualDataLimite) ? manualDataLimite : null;
}

// Status efetivo exibido: PENDENTE vencido vira ATRASADO. Concluido/Cancelado nunca atrasam.
export function resolveStatusEfetivo(
  status: StatusArmazenado,
  dataLimite: string,
  today: string,
): StatusEfetivo {
  if (status === "PENDENTE" && dataLimite < today) {
    return "ATRASADO";
  }
  return status;
}

export function resolveDiasRestantes(
  status: StatusArmazenado,
  dataLimite: string,
  today: string,
): number | null {
  if (status !== "PENDENTE") return null;
  return diffDays(today, dataLimite);
}
