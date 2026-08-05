import { SupabaseClient } from "@supabase/supabase-js";

import { fetchTeams } from "./catalogs";
import { normalizeText } from "./normalizers";
import { fetchProgrammingStageById } from "./queries";
import { describeTeamScheduleConflict } from "./scheduleConflict";

// Pre-checagem de "adicionar equipe" — LEITURA apenas.
//
// A autoridade continua sendo a RPC `add_project_programming_team` (migration
// 318), que roda os mesmos testes DENTRO da transacao com `for update` na etapa.
// Este modulo existe so para a tela poder avisar ANTES de gravar: o usuario
// escolhe a equipe no modal e ja ve "pode" ou "nao pode + por que".
//
// Consequencia aceita (TOCTOU): entre o "pode" daqui e o clique em Concluir,
// outra pessoa pode ocupar a agenda da equipe. Por isso o resultado desta
// funcao NUNCA substitui a chamada da RPC, apenas antecipa o aviso.
//
// A ordem dos testes abaixo espelha a da RPC de proposito: se os dois discordarem
// na ordem, o motivo mostrado no modal nao seria o motivo real da recusa.
// `programming_project_has_active_completion` e a MESMA funcao que a RPC usa
// (SECURITY DEFINER, grant so para service_role — o cliente admin do backend),
// entao a regra de "projeto concluido" nao e reimplementada aqui.

const COMPLETION_FN_NAME = "programming_project_has_active_completion";
const ACTIVE_STAGE_STATUSES = ["PROGRAMADA", "REPROGRAMADA"];

export type AddTeamPrecheckResult = {
  allowed: boolean;
  reason: string | null;
  message: string;
  // Janela pretendida (a da etapa) para o modal exibir o horario que sera checado.
  executionDate: string | null;
  startTime: string | null;
  endTime: string | null;
};

function blocked(reason: string, message: string, window: Pick<AddTeamPrecheckResult, "executionDate" | "startTime" | "endTime">) {
  return { allowed: false, reason, message, ...window } satisfies AddTeamPrecheckResult;
}

export async function checkAddTeamFeasibility(params: {
  supabase: SupabaseClient;
  tenantId: string;
  programmingId: string;
  teamId: string;
}): Promise<AddTeamPrecheckResult> {
  const emptyWindow = { executionDate: null, startTime: null, endTime: null };

  const stage = await fetchProgrammingStageById({
    supabase: params.supabase,
    tenantId: params.tenantId,
    programmingId: params.programmingId,
  });

  if (!stage) {
    return blocked("PROGRAMMING_NOT_FOUND", "Etapa nao encontrada para este tenant.", emptyWindow);
  }

  const window = {
    executionDate: stage.execution_date ?? null,
    startTime: stage.start_time ?? null,
    endTime: stage.end_time ?? null,
  };

  if (!ACTIVE_STAGE_STATUSES.includes(stage.status)) {
    return blocked("STAGE_NOT_ACTIVE", "Somente etapas ativas podem receber equipe.", window);
  }

  if (stage.is_pendencia !== true) {
    const { data, error } = await params.supabase.rpc(COMPLETION_FN_NAME, {
      p_tenant_id: params.tenantId,
      p_project_id: stage.project_id,
    });

    // Falha de leitura nao pode virar "pode adicionar": a RPC de escrita ainda
    // barraria depois. Devolve o bloqueio com texto neutro e deixa o usuario
    // tentar — quem decide de fato e a transacao.
    if (error) {
      console.error(`[programacao-normalizada] Falha ao pre-checar conclusao do projeto.`, { message: error.message });
      return blocked(
        "PRECHECK_UNAVAILABLE",
        "Nao foi possivel verificar a situacao do projeto agora. Voce ainda pode tentar adicionar — a validacao final e feita ao concluir.",
        window,
      );
    }

    if (data === true) {
      return blocked("PROJECT_COMPLETED_REQUIRES_REOPEN", "Projeto concluido: reabra antes de adicionar equipe.", window);
    }
  }

  const teams = await fetchTeams(params.supabase, params.tenantId);
  const team = teams.find((item) => item.id === params.teamId);
  if (!team) {
    return blocked("TEAM_NOT_FOUND", "Equipe nao encontrada ou inativa para este tenant.", window);
  }

  const alreadyActive = (stage.programming_team ?? []).some(
    (item) => item.team_id === params.teamId && item.status === "ATIVA",
  );
  if (alreadyActive) {
    return blocked("TEAM_ALREADY_ACTIVE", "Equipe ja esta alocada nesta etapa.", window);
  }

  const teamName = normalizeText(team.name) || "Equipe";

  // Etapa sem horario NUNCA conflita: `programming_team_schedule_conflict`
  // (migration 317) exige `p_start_time`/`p_end_time` nao nulos. Sem esta guarda
  // a pre-checagem bloquearia onde a RPC libera, porque `describeTeamSchedule-
  // Conflict` trata janela desconhecida como "qualquer ocupacao na data conta".
  if (!window.startTime || !window.endTime) {
    return {
      allowed: true,
      reason: null,
      message: `Etapa sem horario definido — nao ha checagem de agenda. ${teamName} pode ser adicionada.`,
      ...window,
    };
  }

  // Conflito de agenda: mesma funcao de leitura que enriquece a mensagem de
  // TEAM_TIME_CONFLICT depois da recusa da RPC (migration 341). `null` = a equipe
  // nao tem ocupacao sobreposta na janela da etapa.
  const conflictDetail = await describeTeamScheduleConflict({
    supabase: params.supabase,
    tenantId: params.tenantId,
    teamIds: [params.teamId],
    programmingId: params.programmingId,
  });

  if (conflictDetail) {
    return blocked("TEAM_TIME_CONFLICT", conflictDetail, window);
  }

  return {
    allowed: true,
    reason: null,
    message: `${teamName} esta livre nesta janela. Pode ser adicionada.`,
    ...window,
  };
}
