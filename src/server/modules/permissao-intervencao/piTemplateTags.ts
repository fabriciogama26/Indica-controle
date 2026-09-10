/**
 * Contrato de tags do template Word da Permissao de Intervencao.
 *
 * A lista NAO foi escrita a mao: saiu da leitura do proprio
 * `Modelo_PI_Template_Tags.docx`, que declara 129 tags distintas em 136
 * ocorrencias. `pi_code` e `project_code` aparecem tres vezes cada (uma por
 * cabecalho de secao) e `validation_date` duas (corpo e cabecalho da primeira
 * secao); o docxtemplater preenche todas as ocorrencias com o mesmo valor.
 *
 * As oito tags de Responsavel Tecnico e Validador que chegaram a ser
 * especificadas (`rt_name`, `rt_mat`, `rt_unit`, `rt_role`, `val_name`,
 * `val_mat`, `val_unit`, `val_role`) NAO existem no template e ficaram de fora
 * por decisao do usuario: naquele espaco entra a imagem da assinatura.
 */

/** Linhas fisicas do Plano de Execucao no template. Fixo por layout, nao por regra de negocio. */
export const PI_EXECUTION_PLAN_SLOTS = 23;

/** `01`, `02`, ... `23`. O sufixo das tags do plano e sempre de dois digitos. */
export function piExecutionPlanSlotSuffix(slot: number): string {
  return String(slot).padStart(2, "0");
}

function buildExecutionPlanTags(): string[] {
  const tags: string[] = [];
  for (let slot = 1; slot <= PI_EXECUTION_PLAN_SLOTS; slot += 1) {
    const suffix = piExecutionPlanSlotSuffix(slot);
    tags.push(`z${suffix}`, `eq${suffix}`, `at${suffix}`);
  }
  return tags;
}

const IDENTIFICATION_TAGS = ["pi_code", "project_code", "validation_date"] as const;

const CONTRACT_TAGS = [
  "manager_name",
  "company_name",
  "contract_number",
  "manager_phone",
  "manager_email",
] as const;

/** Area de atuacao QUE COMPOE o codigo da PI. Recebem caixa marcada/desmarcada, nunca booleano. */
const PI_AREA_TAGS = ["a_ut_at", "a_ut_mt", "a_om", "a_pm", "a_ce", "a_ec"] as const;

const UTILITY_CONTACT_TAGS = ["enel_contact_name", "enel_contact_phone", "enel_contact_email"] as const;

/** Area de atuacao DO CONTATO da distribuidora. Independente da area que compoe o codigo. */
const CONTACT_AREA_TAGS = ["e_ut_at", "e_ut_mt", "e_om", "e_pm", "e_ce", "e_ec"] as const;

const ACTIVITY_TAGS = [
  "activity_description",
  "work_plan",
  "live_work_authorization",
  "pre_apr",
  "emergency_authorization",
] as const;

const LOCATION_TAGS = [
  "installation_description",
  "feeder",
  "address",
  "coord_x",
  "coord_y",
  "blocked_elements",
  "cut_elements",
] as const;

const VOLTAGE_TAGS = ["v_at", "v_mt", "v_bt"] as const;

/** Instalacao interferente. O nivel dela NAO entra na composicao do codigo da PI. */
const INTERFERENCE_TAGS = ["int_yes", "int_no", "iv_at", "iv_mt", "iv_bt", "proximity_description"] as const;

const SCHEDULE_TAGS = [
  "start_date",
  "start_time",
  "end_date",
  "end_time",
  // Segunda data/hora do formulario. O template nao traz rotulo algum para ela
  // (celula unica na faixa azul, so "Data:" e "Hora Inicio:"), e a regra de
  // negocio ainda nao foi definida. Fica mapeada e vazia de proposito — nao
  // inventar significado.
  "secondary_date",
  "secondary_start_time",
] as const;

const SAFETY_TAGS = ["traffic_instructions", "emergency_plan"] as const;

const RESPONSIBLE_TAGS = ["sup", "sup_s", "enc", "enc_s"] as const;

const CLOSING_TAGS = ["observations", "prepared_date", "prepared_time", "validation_time"] as const;

/** Todas as tags que o template pode conter. Qualquer outra e erro de template. */
export const PI_TEMPLATE_TAGS: readonly string[] = Object.freeze([
  ...IDENTIFICATION_TAGS,
  ...CONTRACT_TAGS,
  ...PI_AREA_TAGS,
  ...UTILITY_CONTACT_TAGS,
  ...CONTACT_AREA_TAGS,
  ...ACTIVITY_TAGS,
  ...LOCATION_TAGS,
  ...VOLTAGE_TAGS,
  ...INTERFERENCE_TAGS,
  ...SCHEDULE_TAGS,
  ...SAFETY_TAGS,
  ...RESPONSIBLE_TAGS,
  ...buildExecutionPlanTags(),
  ...CLOSING_TAGS,
]);

/**
 * Tags sem as quais o documento nao cumpre a funcao dele. Um template que nao
 * as tenha e recusado na ativacao, e a versao anterior continua no ar.
 *
 * A lista e menor que o contrato inteiro de proposito: uma tag opcional que
 * suma do template degrada o documento, mas nao o invalida.
 */
export const PI_REQUIRED_TEMPLATE_TAGS: readonly string[] = Object.freeze([
  "pi_code",
  "project_code",
  "manager_name",
  "company_name",
  "contract_number",
  "activity_description",
  "work_plan",
  "live_work_authorization",
  "pre_apr",
  "feeder",
  "address",
  "sup",
  "enc",
  "emergency_plan",
]);

export type PiTemplateTagReport = {
  /** Tags do contrato que faltam no arquivo. Vazio quando o template esta completo. */
  missing: string[];
  /** Obrigatorias que faltam. Subconjunto de `missing`; qualquer item aqui recusa a ativacao. */
  missingRequired: string[];
  /** Tags presentes no arquivo e fora do contrato. Pega o erro de digitacao (`{maneger_name}`). */
  unknown: string[];
  /** Tags do contrato encontradas no arquivo. */
  present: string[];
};

/**
 * Compara as tags encontradas no arquivo com o contrato.
 *
 * Roda na ATIVACAO de uma versao de template, nao na geracao: e mais barato
 * recusar um template errado uma vez do que descobrir a falta na hora em que
 * alguem precisa emitir a PI.
 */
export function buildPiTemplateTagReport(foundTags: readonly string[]): PiTemplateTagReport {
  const found = new Set(foundTags);
  const contract = new Set(PI_TEMPLATE_TAGS);

  const missing = PI_TEMPLATE_TAGS.filter((tag) => !found.has(tag));
  const missingRequired = PI_REQUIRED_TEMPLATE_TAGS.filter((tag) => !found.has(tag));
  const unknown = foundTags.filter((tag) => !contract.has(tag));
  const present = PI_TEMPLATE_TAGS.filter((tag) => found.has(tag));

  return { missing, missingRequired, unknown, present };
}

/** Um template so pode ser ativado sem obrigatoria faltando e sem tag desconhecida. */
export function isPiTemplateActivatable(report: PiTemplateTagReport): boolean {
  return report.missingRequired.length === 0 && report.unknown.length === 0;
}
