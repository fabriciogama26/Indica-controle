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

// ---------------------------------------------------------------------------
// Leitura da tela (listagem, detalhe e vinculo)
// ---------------------------------------------------------------------------

export type PiStatus = "DRAFT" | "READY" | "ISSUED" | "CANCELLED";
export type PiLinkStatus = "LINKED" | "PENDING" | "ATTENTION";
export type PiCreationSource = "FROM_PROGRAMMING" | "MANUAL";

/**
 * Campos de classificacao da etapa vinculada, repassados CRUS para a tela.
 *
 * O rotulo (`Etapa 2`, `Final`, `Unica`, `Era ...`) NAO e montado aqui: quem
 * monta e `getStageDisplayClassification`, da fachada da Programacao, que e a
 * fonte unica dessa regra. Calcular no servidor criaria uma segunda
 * implementacao, que e exatamente como lista, plano e export ja divergiram
 * antes no proprio modulo da Programacao.
 */
export type PiLinkedStageClassification = {
  status: string;
  executionDate: string | null;
  etapaNumber: number | null;
  etapaUnica: boolean;
  etapaFinal: boolean;
  classificationSnapshotNumber: number | null;
  classificationSnapshotUnica: boolean | null;
  classificationSnapshotFinal: boolean | null;
  classificationSnapshotExecutionDate: string | null;
  classificationSnapshotAt: string | null;
};

export type PiListItem = {
  id: string;
  piCode: string | null;
  projectId: string;
  projectCode: string;
  projectCity: string;
  workDate: string;
  status: PiStatus;
  linkStatus: PiLinkStatus;
  creationSource: PiCreationSource;
  programmingId: string | null;
  linkedStage: PiLinkedStageClassification | null;
  operationAreaCodes: string[];
  voltageLevelCodes: string[];
  primaryOperationAreaCode: string | null;
  primaryVoltageLevelCode: string | null;
  supervisorName: string | null;
  foremanName: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type PiListFilters = {
  search: string;
  status: string;
  linkStatus: string;
  projectId: string;
  operationAreaCode: string;
  voltageLevelCode: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
};

/** Etapa da Programacao oferecida no fluxo `Criar a partir da Programacao`. */
export type PiProgrammingStageOption = {
  programmingId: string;
  executionDate: string | null;
  classification: PiLinkedStageClassification;
  teams: Array<{ teamId: string; teamName: string; foremanName: string | null }>;
  activities: Array<{ code: string; description: string; quantity: string }>;
  feeder: string | null;
  serviceDescription: string | null;
  startTime: string | null;
  endTime: string | null;
  /** PI ja existente para esta etapa. A tela mostra em vez de deixar duplicar. */
  existingPiId: string | null;
  existingPiCode: string | null;
};

/** Uma linha da comparacao Programacao x PI. */
export type PiComparisonRow = {
  field: string;
  label: string;
  programmingValue: string;
  piValue: string;
  divergent: boolean;
};
