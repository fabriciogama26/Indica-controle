import { PI_EXECUTION_PLAN_SLOTS, PI_TEMPLATE_TAGS, piExecutionPlanSlotSuffix } from "./piTemplateTags";
import type { PiDocumentData, PiDocumentIssue, PiOperationAreaCode, PiVoltageLevelCode } from "./types";

/**
 * Traduz o modelo de dominio da PI para o dicionario de tags do template Word.
 *
 * Fonte unica dessa traducao: nenhuma outra camada monta chave de template. O
 * template nao conhece tabela do Postgres, e o banco nao conhece nome de tag.
 */

/** Caixa marcada e desmarcada, nos mesmos pontos Unicode que o formulario oficial ja usa. */
const CHECKED = "☒";
const UNCHECKED = "☐";

/**
 * Toda tag de caixa passa por aqui. O Word nao entende booleano: passar `true`
 * imprimiria a palavra "true" dentro do formulario.
 */
export function checkbox(selected: boolean): string {
  return selected ? CHECKED : UNCHECKED;
}

/**
 * Campo em branco vira string vazia, nunca "-".
 *
 * Por isso este modulo NAO reusa `formatDate` de `lib/utils/formatters`: aquele
 * helper devolve "-" para nulo, o que faz sentido numa tabela da tela e nao faz
 * nenhum num formulario oficial, onde campo vazio e campo vazio.
 */
function text(value: string | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Data ISO (`YYYY-MM-DD`) para `DD/MM/AAAA`.
 *
 * Conversao puramente textual, sem `Date` e sem `toLocaleDateString`: o
 * resultado nao pode depender do fuso nem do locale do servidor.
 * `new Date("2026-09-10")` e interpretado como UTC e, num servidor a oeste de
 * Greenwich, imprimiria 09/09.
 */
function formatDateBr(value: string | null | undefined): string {
  const raw = text(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) return raw;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** Hora `HH:mm[:ss]` para `HH:mm`. Coluna `time` do Postgres chega com segundos. */
function formatTimeBr(value: string | null | undefined): string {
  const raw = text(value).trim();
  const match = /^(\d{2}):(\d{2})/.exec(raw);
  if (!match) return raw;
  return `${match[1]}:${match[2]}`;
}

const OPERATION_AREA_TAG_SUFFIX: Record<PiOperationAreaCode, string> = {
  UT_AT: "ut_at",
  UT_MT: "ut_mt",
  OM: "om",
  PM: "pm",
  CE: "ce",
  EC: "ec",
};

const VOLTAGE_LEVEL_TAG_SUFFIX: Record<PiVoltageLevelCode, string> = {
  AT: "at",
  MT: "mt",
  BT: "bt",
};

function areaCheckboxes(prefix: "a" | "e", selected: readonly PiOperationAreaCode[]): Record<string, string> {
  const marked = new Set(selected);
  const output: Record<string, string> = {};
  for (const [code, suffix] of Object.entries(OPERATION_AREA_TAG_SUFFIX) as [PiOperationAreaCode, string][]) {
    output[`${prefix}_${suffix}`] = checkbox(marked.has(code));
  }
  return output;
}

function voltageCheckboxes(prefix: "v" | "iv", selected: readonly PiVoltageLevelCode[]): Record<string, string> {
  const marked = new Set(selected);
  const output: Record<string, string> = {};
  for (const [code, suffix] of Object.entries(VOLTAGE_LEVEL_TAG_SUFFIX) as [PiVoltageLevelCode, string][]) {
    output[`${prefix}_${suffix}`] = checkbox(marked.has(code));
  }
  return output;
}

/**
 * Distribui as etapas pelos 23 slots fisicos do template.
 *
 * Emite SEMPRE as 69 tags. Slot sem etapa recebe string vazia: deixar a tag de
 * fora faria o `{z18}` sair impresso no documento, e a varredura pos-render
 * abortaria a emissao.
 */
function executionPlanTags(steps: PiDocumentData["executionSteps"]): Record<string, string> {
  const output: Record<string, string> = {};
  for (let slot = 1; slot <= PI_EXECUTION_PLAN_SLOTS; slot += 1) {
    const suffix = piExecutionPlanSlotSuffix(slot);
    const step = steps[slot - 1];
    output[`z${suffix}`] = text(step?.workZone);
    output[`eq${suffix}`] = text(step?.teamName);
    output[`at${suffix}`] = text(step?.activity);
  }
  return output;
}

/**
 * Regras que impedem a emissao, verificadas ANTES de renderizar.
 *
 * O estouro do Plano de Execucao e o caso que mais importa: o template tem 23
 * linhas fisicas para preservar o layout oficial de 8 paginas, e truncar em
 * silencio produziria um documento que parece completo e nao esta. Enquanto nao
 * houver regra oficial de pagina adicional, a emissao para aqui.
 */
export function validatePiDocumentData(data: PiDocumentData): PiDocumentIssue[] {
  const issues: PiDocumentIssue[] = [];

  if (!text(data.piCode).trim()) {
    issues.push({
      code: "PI_CODE_REQUIRED",
      severity: "ERROR",
      message: "A PI precisa de codigo atribuido antes de gerar o documento.",
    });
  }

  if (!text(data.projectCode).trim()) {
    issues.push({
      code: "PROJECT_CODE_REQUIRED",
      severity: "ERROR",
      message: "Informe o projeto/nota da PI antes de gerar o documento.",
    });
  }

  if (data.executionSteps.length === 0) {
    issues.push({
      code: "EXECUTION_PLAN_EMPTY",
      severity: "ERROR",
      message: "O Plano de Execucao precisa de ao menos uma etapa.",
    });
  }

  if (data.executionSteps.length > PI_EXECUTION_PLAN_SLOTS) {
    issues.push({
      code: "EXECUTION_PLAN_OVERFLOW",
      severity: "ERROR",
      message: `O Plano de Execucao tem ${data.executionSteps.length} etapas e o documento comporta ${PI_EXECUTION_PLAN_SLOTS}. Reduza as etapas antes de emitir.`,
    });
  }

  return issues;
}

/**
 * Monta o dicionario com as 129 chaves do contrato.
 *
 * Sempre as 129, inclusive as vazias: o `nullGetter` do renderizador cobre o
 * esquecimento, mas depender dele esconderia um mapeamento faltando ate alguem
 * abrir o documento.
 */
export function buildPiTemplateData(data: PiDocumentData): Record<string, string> {
  if (data.executionSteps.length > PI_EXECUTION_PLAN_SLOTS) {
    throw new Error(
      `buildPiTemplateData: ${data.executionSteps.length} etapas excedem os ${PI_EXECUTION_PLAN_SLOTS} slots do template. Rode validatePiDocumentData antes.`,
    );
  }

  return {
    // Identificacao. `pi_code` e `project_code` saem nos tres cabecalhos.
    pi_code: text(data.piCode),
    project_code: text(data.projectCode),
    validation_date: formatDateBr(data.validatedAt.date),

    // Responsavel executante e contrato.
    manager_name: text(data.responsibleParty.managerName),
    company_name: text(data.responsibleParty.companyName),
    contract_number: text(data.responsibleParty.contractNumber),
    manager_phone: text(data.responsibleParty.managerPhone),
    manager_email: text(data.responsibleParty.managerEmail),

    // Area de atuacao da PI e do contato da distribuidora, independentes entre si.
    ...areaCheckboxes("a", data.operationAreas),
    enel_contact_name: text(data.utilityContact.name),
    enel_contact_phone: text(data.utilityContact.phone),
    enel_contact_email: text(data.utilityContact.email),
    ...areaCheckboxes("e", data.utilityContact.operationAreas),

    // Atividade e autorizacoes.
    activity_description: text(data.activity.description),
    work_plan: text(data.activity.workPlan),
    live_work_authorization: text(data.activity.liveWorkAuthorization),
    pre_apr: text(data.activity.preApr),
    emergency_authorization: text(data.activity.emergencyAuthorization),

    // Local e rede.
    installation_description: text(data.location.installationDescription),
    feeder: text(data.location.feeder),
    address: text(data.location.address),
    coord_x: text(data.location.coordX),
    coord_y: text(data.location.coordY),
    blocked_elements: text(data.location.blockedElements),
    cut_elements: text(data.location.cutElements),
    ...voltageCheckboxes("v", data.voltageLevels),

    // Instalacao interferente. `present` nulo deixa as duas caixas vazias.
    int_yes: checkbox(data.interference.present === true),
    int_no: checkbox(data.interference.present === false),
    ...voltageCheckboxes("iv", data.interference.voltageLevels),
    proximity_description: text(data.interference.proximityDescription),

    // Datas e horarios.
    start_date: formatDateBr(data.schedule.startDate),
    start_time: formatTimeBr(data.schedule.startTime),
    end_date: formatDateBr(data.schedule.endDate),
    end_time: formatTimeBr(data.schedule.endTime),
    secondary_date: formatDateBr(data.schedule.secondaryDate),
    secondary_start_time: formatTimeBr(data.schedule.secondaryStartTime),

    // Seguranca.
    traffic_instructions: text(data.trafficInstructions),
    emergency_plan: text(data.emergencyPlan),

    // Responsaveis. Nomes curtos preservam o layout das celulas do Word.
    sup: text(data.responsibles.supervisor),
    sup_s: text(data.responsibles.supervisorAlternate),
    enc: text(data.responsibles.foreman),
    enc_s: text(data.responsibles.foremanAlternate),

    // Plano de Execucao: 23 linhas fisicas, sempre todas preenchidas.
    ...executionPlanTags(data.executionSteps),

    // Observacoes, elaboracao e validacao.
    observations: text(data.observations),
    prepared_date: formatDateBr(data.preparedAt.date),
    prepared_time: formatTimeBr(data.preparedAt.time),
    validation_time: formatTimeBr(data.validatedAt.time),
  };
}

/**
 * Guarda de desenvolvimento: garante que o mapper cobre exatamente o contrato.
 *
 * Existe porque as duas listas sao editadas em arquivos diferentes e sairiam de
 * sincronia em silencio. A tag nova ficaria sem valor e so apareceria como
 * `{tag}` impressa no documento oficial.
 */
export function findPiTemplateDataGaps(mapped: Record<string, string>): { missing: string[]; extra: string[] } {
  const mappedKeys = new Set(Object.keys(mapped));
  const contract = new Set(PI_TEMPLATE_TAGS);
  return {
    missing: PI_TEMPLATE_TAGS.filter((tag) => !mappedKeys.has(tag)),
    extra: Object.keys(mapped).filter((tag) => !contract.has(tag)),
  };
}
