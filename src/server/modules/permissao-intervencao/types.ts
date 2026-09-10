/**
 * Modelo de dominio do documento da Permissao de Intervencao.
 *
 * Este tipo e a fronteira entre o banco e o Word: o mapper so conhece o que
 * esta aqui, e nenhum nome de tabela ou coluna do Postgres atravessa. Quando a
 * entidade PI existir (Fase 1), a leitura preenche este tipo e nada mais muda
 * na geracao do documento.
 *
 * Convencao de formato na ENTRADA (a saida formatada e responsabilidade do
 * mapper): data em ISO `YYYY-MM-DD`, hora em `HH:mm` ou `HH:mm:ss` (que e como
 * uma coluna `time` do Postgres chega). `null` representa campo em branco e sai
 * como string vazia no documento, nunca como traco.
 */

/** Area de atuacao. Codigo fechado, espelhando as caixas do formulario oficial. */
export type PiOperationAreaCode = "UT_AT" | "UT_MT" | "OM" | "PM" | "CE" | "EC";

/** Nivel de tensao. Codigo fechado, espelhando as caixas do formulario oficial. */
export type PiVoltageLevelCode = "AT" | "MT" | "BT";

export type PiExecutionStep = {
  /** Zona de Trabalho (rede desenergizada) ou Area de Trabalho (em tensao). */
  workZone: string | null;
  teamName: string | null;
  activity: string | null;
};

export type PiDocumentData = {
  /** Codigo completo, ex.: `PI-RJ-MT-PM-INDICA-0001`. Sai nos tres cabecalhos. */
  piCode: string;
  /** Projeto / Nota. Sai nos tres cabecalhos. */
  projectCode: string;

  responsibleParty: {
    managerName: string | null;
    companyName: string | null;
    contractNumber: string | null;
    managerPhone: string | null;
    managerEmail: string | null;
  };

  /** Areas marcadas na PI. Todas saem marcadas no Word; so a principal compoe o codigo. */
  operationAreas: PiOperationAreaCode[];

  utilityContact: {
    name: string | null;
    phone: string | null;
    email: string | null;
    /** Area do contato da distribuidora. Independente de `operationAreas`. */
    operationAreas: PiOperationAreaCode[];
  };

  activity: {
    /** Aceita multiplas linhas. Cada `\n` vira quebra de linha no Word. */
    description: string | null;
    /** Plano de Trabalho (rede desenergizada). Preenchimento manual na PI. */
    workPlan: string | null;
    /** Autorizacao de Trabalho (em tensao). Preenchimento manual na PI. */
    liveWorkAuthorization: string | null;
    /** Identificacao PRE-APR. Preenchimento manual na PI. */
    preApr: string | null;
    emergencyAuthorization: string | null;
  };

  location: {
    installationDescription: string | null;
    feeder: string | null;
    address: string | null;
    coordX: string | null;
    coordY: string | null;
    blockedElements: string | null;
    cutElements: string | null;
  };

  /** Niveis de tensao marcados na PI. Todos saem marcados; so o principal compoe o codigo. */
  voltageLevels: PiVoltageLevelCode[];

  interference: {
    /** `null` deixa as duas caixas (Sim/Nao) desmarcadas, que e o estado "nao informado". */
    present: boolean | null;
    /** Nivel da instalacao interferente. NAO compoe o codigo da PI. */
    voltageLevels: PiVoltageLevelCode[];
    proximityDescription: string | null;
  };

  schedule: {
    startDate: string | null;
    startTime: string | null;
    endDate: string | null;
    endTime: string | null;
    /** Segunda data/hora do formulario, sem regra de negocio definida. Ver `piTemplateTags`. */
    secondaryDate: string | null;
    secondaryStartTime: string | null;
  };

  /** Orientacao de transito e sinalizacao. Aceita multiplas linhas. */
  trafficInstructions: string | null;

  /**
   * Texto do Plano de Emergencia vigente. NAO e digitado na PI: vem da
   * configuracao do tenant/contrato, e a versao usada fica registrada no
   * historico da emissao. Aceita multiplas linhas.
   */
  emergencyPlan: string | null;

  responsibles: {
    supervisor: string | null;
    supervisorAlternate: string | null;
    foreman: string | null;
    foremanAlternate: string | null;
  };

  /**
   * Etapas na ordem atual da PI. Mais de `PI_EXECUTION_PLAN_SLOTS` e erro de
   * emissao, nunca truncamento silencioso.
   */
  executionSteps: PiExecutionStep[];

  observations: string | null;

  /** Elaboracao da PI. */
  preparedAt: { date: string | null; time: string | null };
  /** Validacao/aprovacao da PI. A data tambem sai no cabecalho da primeira secao. */
  validatedAt: { date: string | null; time: string | null };
};

export type PiDocumentIssueCode =
  | "EXECUTION_PLAN_OVERFLOW"
  | "PI_CODE_REQUIRED"
  | "PROJECT_CODE_REQUIRED"
  | "EXECUTION_PLAN_EMPTY";

export type PiDocumentIssue = {
  code: PiDocumentIssueCode;
  severity: "ERROR" | "WARNING";
  message: string;
};
