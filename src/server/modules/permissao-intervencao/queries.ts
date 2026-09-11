import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllRows } from "@/lib/server/apiHelpers";

import type {
  PiComparisonRow,
  PiLinkedStageClassification,
  PiListFilters,
  PiProgrammingStageOption,
} from "./types";

/**
 * Leituras da Permissao de Intervencao.
 *
 * Regra que atravessa o arquivo: o rotulo de etapa (`Etapa 2`, `Final`,
 * `Unica`, `Era ...`) NAO e montado aqui. O servidor devolve os campos de
 * classificacao crus e quem formata e `getStageDisplayClassification`, da
 * fachada da Programacao. Montar o rotulo aqui criaria uma segunda
 * implementacao da mesma regra.
 */

export const PI_SELECT = `
  id, project_id, work_date, programming_id, creation_source, link_status, status,
  pi_sequence, pi_code, primary_operation_area_code, primary_voltage_level_code,
  manager_name, company_name, contract_number, manager_phone, manager_email,
  utility_contact_name, utility_contact_phone, utility_contact_email,
  activity_description, work_plan, live_work_authorization, pre_apr, emergency_authorization,
  start_time, end_date, end_time, secondary_date, secondary_start_time,
  installation_description, feeder, address, coord_x, coord_y,
  blocked_elements, cut_elements, has_interfering_installation, interfering_description,
  traffic_instructions, emergency_plan_snapshot, emergency_plan_version_snapshot,
  supervisor_person_id, supervisor_name_snapshot,
  supervisor_alternate_person_id, supervisor_alternate_name_snapshot,
  foreman_person_id, foreman_name_snapshot,
  foreman_alternate_person_id, foreman_alternate_name_snapshot,
  author_person_id, author_name_snapshot, prepared_at,
  validator_person_id, validator_name_snapshot, validated_at,
  observations, source_programming_snapshot,
  issued_at, issued_by, issued_template_id, issued_template_version, issued_template_checksum,
  cancellation_reason, cancelled_at, cancelled_by,
  created_by, updated_by, created_at, updated_at
`;

/** Classificacao da etapa, crua. Embutida via FK para nao virar consulta extra. */
const STAGE_CLASSIFICATION_SELECT = `
  programming (
    id, execution_date, status, etapa_number, etapa_unica, etapa_final,
    classification_snapshot_number, classification_snapshot_unica, classification_snapshot_final,
    classification_snapshot_execution_date, classification_snapshot_at
  )
`;

type StageEmbed = {
  id: string;
  execution_date: string | null;
  status: string;
  etapa_number: number | null;
  etapa_unica: boolean;
  etapa_final: boolean;
  classification_snapshot_number: number | null;
  classification_snapshot_unica: boolean | null;
  classification_snapshot_final: boolean | null;
  classification_snapshot_execution_date: string | null;
  classification_snapshot_at: string | null;
};

export type PiRow = Record<string, unknown> & {
  id: string;
  project_id: string;
  work_date: string;
  programming_id: string | null;
  creation_source: string;
  link_status: string;
  status: string;
  pi_code: string | null;
  primary_operation_area_code: string | null;
  primary_voltage_level_code: string | null;
  supervisor_name_snapshot: string | null;
  foreman_name_snapshot: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  programming?: StageEmbed | StageEmbed[] | null;
};

export type ProjectLookupRow = {
  id: string;
  sob: string;
  city_text: string | null;
  street: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  service_description: string | null;
};

export const PROJECT_LOOKUP_SELECT =
  "id, sob, city_text, street, neighborhood, latitude, longitude, service_description";

/** PostgREST devolve embed de FK simples como objeto e de reverso como array. */
function firstEmbed(value: StageEmbed | StageEmbed[] | null | undefined): StageEmbed | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function toStageClassification(
  value: StageEmbed | StageEmbed[] | null | undefined,
): PiLinkedStageClassification | null {
  const stage = firstEmbed(value);
  if (!stage) return null;
  return {
    status: stage.status,
    executionDate: stage.execution_date,
    etapaNumber: stage.etapa_number,
    etapaUnica: stage.etapa_unica,
    etapaFinal: stage.etapa_final,
    classificationSnapshotNumber: stage.classification_snapshot_number,
    classificationSnapshotUnica: stage.classification_snapshot_unica,
    classificationSnapshotFinal: stage.classification_snapshot_final,
    classificationSnapshotExecutionDate: stage.classification_snapshot_execution_date,
    classificationSnapshotAt: stage.classification_snapshot_at,
  };
}

// ---------------------------------------------------------------------------
// Listagem
// ---------------------------------------------------------------------------

/**
 * Ids de PI que casam com o filtro de area ou de tensao.
 *
 * Resolvido em consulta propria em vez de `!inner` no embed porque a mesma
 * consulta precisa devolver TODAS as areas de cada PI para exibicao; com
 * `!inner` filtrado, o embed voltaria so com a area filtrada e a coluna da tela
 * mentiria.
 */
async function resolveIdsByTag(
  supabase: SupabaseClient,
  tenantId: string,
  table: "pi_operation_area_link" | "pi_voltage_level_link",
  column: "area_code" | "voltage_code",
  value: string,
): Promise<string[] | null> {
  if (!value) return null;
  const { data } = await loadAllRows<{ pi_id: string }>((from, to) =>
    supabase
      .from(table)
      .select("pi_id")
      .eq("tenant_id", tenantId)
      .eq("scope", "PI")
      .eq(column, value)
      .order("pi_id")
      .range(from, to)
      .returns<{ pi_id: string }[]>(),
  );
  return Array.from(new Set((data ?? []).map((row) => row.pi_id)));
}

function intersect(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  const set = new Set(b);
  return a.filter((id) => set.has(id));
}

export async function fetchPiList(
  supabase: SupabaseClient,
  tenantId: string,
  filters: PiListFilters,
) {
  let restrictedIds: string[] | null = null;

  restrictedIds = intersect(
    restrictedIds,
    await resolveIdsByTag(supabase, tenantId, "pi_operation_area_link", "area_code", filters.operationAreaCode),
  );
  restrictedIds = intersect(
    restrictedIds,
    await resolveIdsByTag(supabase, tenantId, "pi_voltage_level_link", "voltage_code", filters.voltageLevelCode),
  );

  // Busca textual casa codigo da PI ou codigo do projeto. O projeto e resolvido
  // antes para a condicao virar um `in` de ids.
  let searchProjectIds: string[] = [];
  if (filters.search) {
    const { data } = await supabase
      .from("project")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("sob", `%${filters.search}%`)
      .limit(500)
      .returns<{ id: string }[]>();
    searchProjectIds = (data ?? []).map((row) => row.id);
  }

  if (restrictedIds !== null && restrictedIds.length === 0) {
    return { items: [] as PiRow[], total: 0, projectMap: new Map<string, ProjectLookupRow>() };
  }

  let query = supabase
    .from("permission_intervention")
    .select(`${PI_SELECT}, ${STAGE_CLASSIFICATION_SELECT}`, { count: "exact" })
    .eq("tenant_id", tenantId);

  if (restrictedIds !== null) query = query.in("id", restrictedIds);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.linkStatus) query = query.eq("link_status", filters.linkStatus);
  if (filters.projectId) query = query.eq("project_id", filters.projectId);
  if (filters.dateFrom) query = query.gte("work_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("work_date", filters.dateTo);

  if (filters.search) {
    const conditions = [`pi_code.ilike.%${filters.search}%`];
    if (searchProjectIds.length > 0) conditions.push(`project_id.in.(${searchProjectIds.join(",")})`);
    query = query.or(conditions.join(","));
  }

  const from = (filters.page - 1) * filters.pageSize;
  const { data, error, count } = await query
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + filters.pageSize - 1)
    .returns<PiRow[]>();

  if (error) throw error;

  const rows = data ?? [];
  const projectMap = await fetchProjectLookupMap(
    supabase,
    tenantId,
    rows.map((row) => row.project_id),
  );

  return { items: rows, total: count ?? 0, projectMap };
}

/**
 * Le de `project_with_labels`, NAO da tabela `project`.
 *
 * `city_text` e uma coluna da VIEW, resolvida a partir do lookup de municipio;
 * a tabela base guarda so o id. Apontar para `project` devolve erro de coluna
 * inexistente, e como o erro era descartado a listagem mostraria
 * "Nao identificado" em todo projeto, sem nenhum sintoma no log. O erro agora
 * sobe, e quem chama transforma em 500.
 *
 * A view tem `security_invoker = true`, entao a RLS das tabelas base continua
 * valendo; o filtro por tenant e explicito mesmo assim.
 */
export async function fetchProjectLookupMap(
  supabase: SupabaseClient,
  tenantId: string,
  projectIds: string[],
): Promise<Map<string, ProjectLookupRow>> {
  const ids = Array.from(new Set(projectIds.filter(Boolean)));
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("project_with_labels")
    .select(PROJECT_LOOKUP_SELECT)
    .eq("tenant_id", tenantId)
    .in("id", ids)
    .returns<ProjectLookupRow[]>();

  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, row]));
}

/** Areas e tensoes marcadas, agrupadas por PI e escopo. */
export async function fetchPiTagsByPi(
  supabase: SupabaseClient,
  tenantId: string,
  piIds: string[],
) {
  const areas = new Map<string, { PI: string[]; CONTACT: string[] }>();
  const voltages = new Map<string, { PI: string[]; INTERFERING: string[] }>();
  if (piIds.length === 0) return { areas, voltages };

  const [areaRows, voltageRows] = await Promise.all([
    supabase
      .from("pi_operation_area_link")
      .select("pi_id, scope, area_code")
      .eq("tenant_id", tenantId)
      .in("pi_id", piIds)
      .returns<{ pi_id: string; scope: string; area_code: string }[]>(),
    supabase
      .from("pi_voltage_level_link")
      .select("pi_id, scope, voltage_code")
      .eq("tenant_id", tenantId)
      .in("pi_id", piIds)
      .returns<{ pi_id: string; scope: string; voltage_code: string }[]>(),
  ]);

  for (const row of areaRows.data ?? []) {
    const entry = areas.get(row.pi_id) ?? { PI: [], CONTACT: [] };
    if (row.scope === "PI") entry.PI.push(row.area_code);
    else entry.CONTACT.push(row.area_code);
    areas.set(row.pi_id, entry);
  }

  for (const row of voltageRows.data ?? []) {
    const entry = voltages.get(row.pi_id) ?? { PI: [], INTERFERING: [] };
    if (row.scope === "PI") entry.PI.push(row.voltage_code);
    else entry.INTERFERING.push(row.voltage_code);
    voltages.set(row.pi_id, entry);
  }

  return { areas, voltages };
}

// ---------------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------------

export async function fetchPiById(supabase: SupabaseClient, tenantId: string, piId: string) {
  const { data, error } = await supabase
    .from("permission_intervention")
    .select(`${PI_SELECT}, ${STAGE_CLASSIFICATION_SELECT}`)
    .eq("tenant_id", tenantId)
    .eq("id", piId)
    .maybeSingle<PiRow>();

  if (error) throw error;
  return data;
}

export async function fetchPiExecutionSteps(supabase: SupabaseClient, tenantId: string, piId: string) {
  const { data } = await supabase
    .from("pi_execution_step")
    .select("id, sort_order, work_zone, team_id, team_name_snapshot, activity, origin")
    .eq("tenant_id", tenantId)
    .eq("pi_id", piId)
    .order("sort_order")
    .returns<
      Array<{
        id: string;
        sort_order: number;
        work_zone: string | null;
        team_id: string | null;
        team_name_snapshot: string | null;
        activity: string | null;
        origin: string;
      }>
    >();

  return data ?? [];
}

export async function fetchPiHistory(supabase: SupabaseClient, tenantId: string, piId: string) {
  const { data } = await loadAllRows<{
    id: string;
    action_type: string;
    reason: string | null;
    changes: Record<string, unknown>;
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: string;
  }>((from, to) =>
    supabase
      .from("pi_history")
      .select("id, action_type, reason, changes, metadata, created_by, created_at")
      .eq("tenant_id", tenantId)
      .eq("pi_id", piId)
      .order("created_at", { ascending: false })
      .range(from, to)
      .returns<
        Array<{
          id: string;
          action_type: string;
          reason: string | null;
          changes: Record<string, unknown>;
          metadata: Record<string, unknown>;
          created_by: string | null;
          created_at: string;
        }>
      >(),
  );

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Etapas da Programacao oferecidas no fluxo `Criar a partir da Programacao`
// ---------------------------------------------------------------------------

type StageListRow = StageEmbed & {
  feeder: string | null;
  service_description: string | null;
  start_time: string | null;
  end_time: string | null;
  programming_team: Array<{
    team_id: string;
    status: string;
    programmed_foreman_name_snapshot: string | null;
  }> | null;
  programming_activity: Array<{
    service_activity_id: string;
    quantity: number | string;
    is_active: boolean;
  }> | null;
};

/**
 * Etapas do projeto oferecidas na criacao da PI.
 *
 * Traz TODAS as etapas, inclusive encerradas: a tela mostra a lista completa
 * com o rotulo correto de cada uma, e quem decide e o usuario. O que a criacao
 * NAO faz e escolher sozinha uma etapa encerrada — isso e responsabilidade da
 * RPC, que so vincula automaticamente etapa ativa.
 */
export async function fetchProgrammingStageOptions(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<PiProgrammingStageOption[]> {
  const { data } = await loadAllRows<StageListRow>((from, to) =>
    supabase
      .from("programming")
      .select(
        `id, execution_date, status, etapa_number, etapa_unica, etapa_final,
         classification_snapshot_number, classification_snapshot_unica, classification_snapshot_final,
         classification_snapshot_execution_date, classification_snapshot_at,
         feeder, service_description, start_time, end_time,
         programming_team ( team_id, status, programmed_foreman_name_snapshot ),
         programming_activity ( service_activity_id, quantity, is_active )`,
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .order("execution_date", { ascending: false, nullsFirst: false })
      .range(from, to)
      .returns<StageListRow[]>(),
  );

  const stages = data ?? [];
  if (stages.length === 0) return [];

  const teamIds = Array.from(
    new Set(stages.flatMap((stage) => (stage.programming_team ?? []).map((team) => team.team_id))),
  );
  const activityIds = Array.from(
    new Set(stages.flatMap((stage) => (stage.programming_activity ?? []).map((a) => a.service_activity_id))),
  );

  const [teams, activities, existingPis] = await Promise.all([
    teamIds.length
      ? supabase
          .from("teams")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .in("id", teamIds)
          .returns<{ id: string; name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    activityIds.length
      ? supabase
          .from("service_activities")
          .select("id, code, description")
          .eq("tenant_id", tenantId)
          .in("id", activityIds)
          .returns<{ id: string; code: string; description: string }[]>()
      : Promise.resolve({ data: [] as { id: string; code: string; description: string }[] }),
    supabase
      .from("permission_intervention")
      .select("id, pi_code, programming_id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .neq("status", "CANCELLED")
      .returns<{ id: string; pi_code: string | null; programming_id: string | null }[]>(),
  ]);

  const teamMap = new Map((teams.data ?? []).map((row) => [row.id, row.name]));
  const activityMap = new Map((activities.data ?? []).map((row) => [row.id, row]));
  const piByStage = new Map(
    (existingPis.data ?? [])
      .filter((row) => row.programming_id)
      .map((row) => [row.programming_id as string, row]),
  );

  return stages.map((stage) => {
    const existing = piByStage.get(stage.id) ?? null;
    return {
      programmingId: stage.id,
      executionDate: stage.execution_date,
      classification: toStageClassification(stage) as PiLinkedStageClassification,
      teams: (stage.programming_team ?? [])
        .filter((team) => team.status === "ATIVA")
        .map((team) => ({
          teamId: team.team_id,
          teamName: teamMap.get(team.team_id) ?? "Nao identificada",
          foremanName: team.programmed_foreman_name_snapshot,
        })),
      activities: (stage.programming_activity ?? [])
        .filter((activity) => activity.is_active)
        .map((activity) => ({
          code: activityMap.get(activity.service_activity_id)?.code ?? "",
          description: activityMap.get(activity.service_activity_id)?.description ?? "",
          quantity: String(activity.quantity),
        })),
      feeder: stage.feeder,
      serviceDescription: stage.service_description,
      startTime: stage.start_time,
      endTime: stage.end_time,
      existingPiId: existing?.id ?? null,
      existingPiCode: existing?.pi_code ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Catalogos e valores iniciais
// ---------------------------------------------------------------------------

export type PiProjectOption = {
  id: string;
  sob: string;
  city_text: string | null;
  street: string | null;
  neighborhood: string | null;
};

/**
 * Projetos ativos para o autocomplete do fluxo `Nova PI`.
 *
 * Lista completa em vez de busca por digitacao, no mesmo padrao do Cronograma
 * de Solicitacoes: a escolha do projeto e o primeiro passo e precisa responder
 * na hora. `loadAllRows` porque o teto de 1.000 linhas do PostgREST corta sem
 * sinalizar, e a carteira ja passa disso.
 */
export async function fetchActiveProjectOptions(supabase: SupabaseClient, tenantId: string) {
  const { data } = await loadAllRows<PiProjectOption>((from, to) =>
    supabase
      .from("project_with_labels")
      .select("id, sob, city_text, street, neighborhood")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sob", { ascending: true })
      .range(from, to)
      .returns<PiProjectOption[]>(),
  );

  return data ?? [];
}

export async function fetchPiMeta(supabase: SupabaseClient, tenantId: string) {
  const [areas, voltages, contract, stepTemplates, settings, hasTemplate] = await Promise.all([
    supabase
      .from("pi_operation_areas")
      .select("code, label, sort_order")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sort_order")
      .returns<{ code: string; label: string; sort_order: number }[]>(),
    supabase
      .from("pi_voltage_levels")
      .select("code, label, sort_order")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sort_order")
      .returns<{ code: string; label: string; sort_order: number }[]>(),
    // Contrato e unico por tenant desde a migration 413. Alimenta os valores
    // iniciais da secao de identificacao, que continuam editaveis na PI.
    supabase
      .from("contract")
      .select("empresa, nome_gestor, email, telefone_corporativo, number")
      .eq("tenant_id", tenantId)
      .maybeSingle<{
        empresa: string | null;
        nome_gestor: string | null;
        email: string | null;
        telefone_corporativo: string | null;
        number: string | null;
      }>(),
    supabase
      .from("pi_execution_step_template")
      .select("code, description, sort_order")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sort_order")
      .returns<{ code: string; description: string; sort_order: number }[]>(),
    supabase
      .from("pi_settings")
      .select("code_prefix, company_code, sequence_digits, emergency_plan_text, emergency_plan_version")
      .eq("tenant_id", tenantId)
      .maybeSingle<{
        code_prefix: string;
        company_code: string;
        sequence_digits: number;
        emergency_plan_text: string | null;
        emergency_plan_version: number;
      }>(),
    supabase
      .from("pi_document_template")
      .select("version")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .maybeSingle<{ version: number }>(),
  ]);

  return {
    operationAreas: areas.data ?? [],
    voltageLevels: voltages.data ?? [],
    contract: contract.data ?? null,
    executionStepTemplates: stepTemplates.data ?? [],
    settings: settings.data ?? null,
    activeTemplateVersion: hasTemplate.data?.version ?? null,
  };
}

// ---------------------------------------------------------------------------
// Comparacao Programacao x PI
// ---------------------------------------------------------------------------

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Compara o snapshot tirado na criacao com o estado atual da PI.
 *
 * E LEITURA, nao validacao: divergir nunca bloqueia nada. Por isso vive aqui e
 * nao nas RPCs. A estrutura devolvida ja serve de base para o dashboard de
 * qualidade do planejamento, sem precisar recalcular.
 *
 * PI sem snapshot (criada sem Programacao) nao tem origem contra a qual medir e
 * devolve lista vazia.
 */
export function buildPiComparison(
  snapshot: Record<string, unknown> | null,
  pi: {
    feeder: string | null;
    activity_description: string | null;
    start_time: string | null;
    end_time: string | null;
    foreman_name_snapshot: string | null;
  },
  steps: Array<{ team_name_snapshot: string | null }>,
): PiComparisonRow[] {
  if (!snapshot) return [];

  const snapshotTeams = (snapshot.teams as Array<{ teamName?: string; foremanName?: string }> | undefined) ?? [];
  const snapshotActivities =
    (snapshot.activities as Array<{ code?: string; description?: string }> | undefined) ?? [];

  const rows: PiComparisonRow[] = [
    {
      field: "feeder",
      label: "Alimentador",
      programmingValue: asText(snapshot.feeder),
      piValue: asText(pi.feeder),
      divergent: false,
    },
    {
      field: "startTime",
      label: "Hora de inicio",
      programmingValue: asText(snapshot.startTime).slice(0, 5),
      piValue: asText(pi.start_time).slice(0, 5),
      divergent: false,
    },
    {
      field: "endTime",
      label: "Hora de termino",
      programmingValue: asText(snapshot.endTime).slice(0, 5),
      piValue: asText(pi.end_time).slice(0, 5),
      divergent: false,
    },
    {
      field: "foreman",
      label: "Encarregado",
      // A etapa pode ter VARIAS equipes, entao varios encarregados. A PI tem um.
      // Divergencia aqui significa "o escolhido nao esta entre os programados",
      // e nao "e diferente do primeiro da lista".
      programmingValue: snapshotTeams
        .map((team) => asText(team.foremanName))
        .filter(Boolean)
        .join(", "),
      piValue: asText(pi.foreman_name_snapshot),
      divergent: false,
    },
    {
      field: "teams",
      label: "Equipes",
      programmingValue: snapshotTeams.map((team) => asText(team.teamName)).filter(Boolean).join(", "),
      piValue: Array.from(new Set(steps.map((step) => asText(step.team_name_snapshot)).filter(Boolean))).join(", "),
      divergent: false,
    },
    {
      field: "activities",
      label: "Atividades",
      programmingValue: snapshotActivities
        .map((activity) => [asText(activity.code), asText(activity.description)].filter(Boolean).join(" - "))
        .join(" | "),
      piValue: asText(pi.activity_description).replace(/\n+/g, " | "),
      divergent: false,
    },
  ];

  return rows.map((row) => {
    if (row.field === "foreman") {
      const programmed = row.programmingValue.split(", ").filter(Boolean);
      // Sem encarregado escolhido na PI ainda, nao ha divergencia a apontar.
      const divergent = row.piValue.length > 0 && programmed.length > 0 && !programmed.includes(row.piValue);
      return { ...row, divergent };
    }
    return { ...row, divergent: row.programmingValue !== row.piValue };
  });
}
