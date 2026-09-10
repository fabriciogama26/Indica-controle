import { PI_EXECUTION_PLAN_SLOTS } from "./piTemplateTags";
import type { PiDocumentData, PiExecutionStep } from "./types";

/**
 * Conjunto de demonstracao usado para CONFERIR um template, nunca para emitir
 * uma PI.
 *
 * Vive aqui, e nao dentro do script de verificacao, porque dois consumidores
 * precisam exatamente do mesmo conjunto: a rota de preview (que devolve o DOCX
 * para o usuario abrir no Word depois de subir uma versao nova) e
 * `scripts/pi-docx-verify.mjs`. Duplicar levaria a conferir uma coisa e
 * publicar outra.
 *
 * O conteudo e propositalmente adversarial: acentuacao, cedilha, texto em
 * varias linhas, todas as familias de caixa de selecao em uso e as duas areas
 * de atuacao divergentes entre si.
 */

export function buildPiDemoExecutionStep(index: number): PiExecutionStep {
  return {
    workZone: `Zona ${index} - entre postes P${index} e P${index + 1}`,
    teamName: index % 2 === 0 ? "LV-02" : "MK-01",
    activity: `Etapa ${index}: atividade prevista no plano de execucao`,
  };
}

export function buildPiDemoExecutionSteps(count: number): PiExecutionStep[] {
  return Array.from({ length: count }, (_, index) => buildPiDemoExecutionStep(index + 1));
}

export function buildPiDemoDocumentData(overrides: Partial<PiDocumentData> = {}): PiDocumentData {
  const base: PiDocumentData = {
    piCode: "PI-RJ-MT-PM-INDICA-0001",
    projectCode: "0013199671",
    responsibleParty: {
      managerName: "LUIZ CARLOS QUINTANILHA JÚNIOR",
      companyName: "INDICA SERVIÇOS",
      contractNumber: "2024/001",
      managerPhone: "(21) 99999-0000",
      managerEmail: "gestor@indica.com.br",
    },
    operationAreas: ["PM", "CE"],
    utilityContact: {
      name: "MARIA APARECIDA GONÇALVES",
      phone: "(21) 98888-1111",
      email: "contato.unidade@enel.com",
      operationAreas: ["OM"],
    },
    activity: {
      description:
        "Substituição de poste de concreto 11/300.\nInstalação de chave fusível.\nPoda de árvore em conflito com a rede.",
      workPlan: "PT-2026-004512",
      liveWorkAuthorization: "AT-2026-000987",
      preApr: "APR-88123",
      emergencyAuthorization: "",
    },
    location: {
      installationDescription: "Ramal de distribuição urbano, trecho residencial com carga concentrada.",
      feeder: "MUR02",
      address: "Rua das Palmeiras, 145 - Centro",
      coordX: "-44.318920",
      coordY: "-22.973410",
      blockedElements: "CH-4471, CH-4472",
      cutElements: "CD-1188",
    },
    voltageLevels: ["MT", "BT"],
    interference: {
      present: true,
      voltageLevels: ["AT"],
      proximityDescription: "Linha de transmissão 138 kV paralela ao trecho, afastamento aproximado de 9 metros.",
    },
    schedule: {
      startDate: "2026-09-14",
      startTime: "07:30:00",
      endDate: "2026-09-14",
      endTime: "17:00:00",
      // Sem regra de negocio definida para a segunda data do formulario.
      secondaryDate: null,
      secondaryStartTime: null,
    },
    trafficInstructions:
      "Bloqueio parcial da via com cones a cada 5 metros.\nSinalização a 50 metros nos dois sentidos.\nApoio de bandeirinha durante o içamento.",
    emergencyPlan:
      "1. Interromper a atividade e isolar a área.\n2. Acionar o SAMU (192) e a supervisão.\n3. Registrar a ocorrência no sistema em até 2 horas.",
    responsibles: {
      supervisor: "JOÃO PEREIRA DA SILVA",
      supervisorAlternate: "CARLOS EDUARDO RAMOS",
      foreman: "JOSÉ ANTÔNIO NUNES",
      foremanAlternate: "MARCOS VINÍCIUS LIMA",
    },
    executionSteps: buildPiDemoExecutionSteps(5),
    observations: "Documento gerado para conferência visual do template. Não vale como PI emitida.",
    preparedAt: { date: "2026-09-10", time: "13:02:00" },
    validatedAt: { date: "2026-09-11", time: "09:45:00" },
  };

  return { ...base, ...overrides };
}

/** Preenche as 23 linhas do plano, para conferir o pior caso de layout. */
export function buildPiDemoFullPlanData(): PiDocumentData {
  return buildPiDemoDocumentData({ executionSteps: buildPiDemoExecutionSteps(PI_EXECUTION_PLAN_SLOTS) });
}
