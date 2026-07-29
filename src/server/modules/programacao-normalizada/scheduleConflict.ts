import { SupabaseClient } from "@supabase/supabase-js";

import { normalizeText } from "./normalizers";

// Fase 1 da sugestao de horario livre (migration 341).
//
// As RPCs de escrita continuam devolvendo apenas `TEAM_TIME_CONFLICT` com o
// texto generico. Quando isso acontece, o backend consulta a agenda ocupada da
// equipe naquela data (funcao de LEITURA `programming_team_schedule_agenda`) e
// reescreve a mensagem dizendo COM QUEM conflitou e QUANDO a equipe esta livre.
//
// Expediente NAO e assumido aqui: a janela de trabalho pode variar por equipe/
// tipo de servico e essa decisao ficou para a fase 2. Por isso as folgas sao
// derivadas apenas dos proprios intervalos ocupados — os extremos saem como
// "ate HH:MM" e "a partir de HH:MM", sem inventar inicio ou fim de dia.

const AGENDA_RPC_NAME = "programming_team_schedule_agenda";

// Teto de equipes detalhadas na mensagem: acima disso o texto vira um paragrafo
// ilegivel dentro do alerta da tela.
const MAX_TEAMS_IN_MESSAGE = 3;

type AgendaBusySlot = {
  programmingId?: string | null;
  projectCode?: string | null;
  startTime?: string | null;
  endTime?: string | null;
};

type AgendaTeam = {
  teamId?: string | null;
  teamName?: string | null;
  busy?: AgendaBusySlot[] | null;
};

type AgendaPayload = {
  requested?: { executionDate?: string | null; startTime?: string | null; endTime?: string | null } | null;
  teams?: AgendaTeam[] | null;
};

type Interval = { start: number; end: number };

function toMinutes(value: string | null | undefined) {
  const match = /^(\d{2}):(\d{2})/.exec(normalizeText(value));
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  return hours * 60 + minutes;
}

function toClock(minutes: number) {
  const normalized = Math.max(0, Math.round(minutes));
  const hours = Math.floor(normalized / 60);
  const rest = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}h${String(rest).padStart(2, "0")}`;
  if (hours) return `${hours}h`;
  return `${rest}min`;
}

function formatDate(isoDate: string | null | undefined) {
  const normalized = normalizeText(isoDate);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : normalized;
}

// Uniao dos intervalos ocupados: duas etapas coladas (08:00-12:00 e 12:00-17:00)
// nao podem virar uma "folga" de zero minuto entre elas.
function mergeIntervals(intervals: Interval[]) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
      continue;
    }
    merged.push({ ...interval });
  }

  return merged;
}

function describeBusySlots(slots: AgendaBusySlot[]) {
  return slots
    .map((slot) => {
      const start = toMinutes(slot.startTime);
      const end = toMinutes(slot.endTime);
      const code = normalizeText(slot.projectCode) || "projeto sem SOB";
      if (start === null || end === null) return code;
      return `${code} (${toClock(start)}-${toClock(end)})`;
    })
    .join(", ");
}

// Folgas DERIVADAS dos intervalos ocupados. Os extremos ficam abertos de
// proposito: sem expediente definido nao da para afirmar que "livre a partir das
// 17:00" acaba as 18:00.
function describeFreeWindows(busy: Interval[], requiredMinutes: number | null) {
  const merged = mergeIntervals(busy);
  if (!merged.length) return "";

  const windows: string[] = [];
  windows.push(`ate ${toClock(merged[0].start)}`);

  for (let index = 0; index < merged.length - 1; index += 1) {
    const gapStart = merged[index].end;
    const gapEnd = merged[index + 1].start;
    const gap = gapEnd - gapStart;
    if (gap <= 0) continue;
    if (requiredMinutes !== null && gap < requiredMinutes) continue;
    windows.push(`${toClock(gapStart)}-${toClock(gapEnd)} (${formatDuration(gap)})`);
  }

  windows.push(`a partir de ${toClock(merged[merged.length - 1].end)}`);

  return windows.join("; ");
}

function buildConflictMessage(payload: AgendaPayload) {
  const requestedDate = formatDate(payload.requested?.executionDate);
  const requestedStart = toMinutes(payload.requested?.startTime);
  const requestedEnd = toMinutes(payload.requested?.endTime);
  const requiredMinutes =
    requestedStart !== null && requestedEnd !== null && requestedEnd > requestedStart ? requestedEnd - requestedStart : null;

  const conflicting = (payload.teams ?? [])
    .map((team) => {
      const slots = (team.busy ?? []).filter((slot) => toMinutes(slot.startTime) !== null && toMinutes(slot.endTime) !== null);

      // Sem janela pretendida conhecida, qualquer ocupacao na data e relevante.
      const overlapping =
        requestedStart === null || requestedEnd === null
          ? slots
          : slots.filter((slot) => {
              const start = toMinutes(slot.startTime) as number;
              const end = toMinutes(slot.endTime) as number;
              return start < requestedEnd && requestedStart < end;
            });

      return { name: normalizeText(team.teamName) || "Equipe", slots, overlapping };
    })
    .filter((team) => team.overlapping.length > 0);

  if (!conflicting.length) return "";

  const shown = conflicting.slice(0, MAX_TEAMS_IN_MESSAGE);
  const hidden = conflicting.length - shown.length;

  const parts = shown.map((team) => {
    const busyIntervals = team.slots
      .map((slot) => ({ start: toMinutes(slot.startTime) as number, end: toMinutes(slot.endTime) as number }))
      .filter((interval) => interval.end > interval.start);

    const free = describeFreeWindows(busyIntervals, requiredMinutes);
    const occupied = describeBusySlots(team.overlapping);
    return free ? `${team.name}: ocupada por ${occupied}. Livre: ${free}` : `${team.name}: ocupada por ${occupied}`;
  });

  const header = requestedDate ? `Conflito de agenda em ${requestedDate}.` : "Conflito de agenda.";
  const requestedWindow =
    requestedStart !== null && requestedEnd !== null
      ? ` Voce pediu ${toClock(requestedStart)}-${toClock(requestedEnd)}.`
      : "";
  const overflow = hidden > 0 ? ` (+${hidden} equipe${hidden === 1 ? "" : "s"} em conflito)` : "";

  return `${header}${requestedWindow} ${parts.join(" | ")}${overflow}`.trim();
}

/**
 * Monta a mensagem detalhada de TEAM_TIME_CONFLICT. Devolve `null` quando nao
 * consegue detalhar (funcao ausente, erro de leitura ou agenda vazia) — nesse
 * caso o chamador mantem a mensagem original da RPC.
 */
export async function describeTeamScheduleConflict(params: {
  supabase: SupabaseClient;
  tenantId: string;
  teamIds?: string[] | null;
  programmingId?: string | null;
  executionDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  excludeProgrammingId?: string | null;
}) {
  const { data, error } = await params.supabase.rpc(AGENDA_RPC_NAME, {
    p_tenant_id: params.tenantId,
    p_team_ids: params.teamIds?.length ? params.teamIds : null,
    p_programming_id: params.programmingId ?? null,
    p_execution_date: params.executionDate ?? null,
    p_start_time: params.startTime ?? null,
    p_end_time: params.endTime ?? null,
    p_exclude_programming_id: params.excludeProgrammingId ?? null,
  });

  // Ambiente sem a migration 341 ou falha de leitura: o detalhe e um extra, nunca
  // pode transformar um 409 de negocio em erro de infraestrutura.
  if (error) {
    console.error(`[programacao-normalizada] Falha ao detalhar conflito de agenda.`, { message: error.message });
    return null;
  }

  return buildConflictMessage((data ?? {}) as AgendaPayload) || null;
}
