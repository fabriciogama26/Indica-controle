import { NextResponse } from "next/server";

import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { authorizeAnyPageAction } from "@/lib/server/routeAuthorization";
import { findUnresolvedDocxTags, renderDocxTemplate } from "@/lib/server/docxTemplate";

import { PI_PAGE_KEY } from "./handlers";
import { buildPiTemplateData, validatePiDocumentData } from "./piTemplateMapper";
import { downloadPiTemplateObject, isPiTemplatePathOwnedByTenant } from "./piTemplateStorage";
import { PI_TEMPLATE_PAGE_KEY } from "./templates";
import {
  fetchPiById,
  fetchPiExecutionSteps,
  fetchPiTagsByPi,
  fetchProjectLookupMap,
} from "./queries";
import type { PiDocumentData, PiOperationAreaCode, PiVoltageLevelCode } from "./types";

/**
 * Geracao do documento oficial da PI.
 *
 * PERMISSAO: o template pertence a tela `modelo-pi`, mas ESTE endpoint e da
 * tela da PI. Exigir `modelo-pi` faria a tela abrir e o proprio botao dela
 * tomar 403 — o caso que o "Padrao de permissao por tela" do CLAUDE.md proibe.
 * Por isso `authorizeAnyPageAction` com as duas chaves.
 *
 * SOMENTE PI EMITIDA: o documento carrega o codigo oficial e a assinatura do
 * template usado. Gerar a partir de rascunho produziria um arquivo com cara de
 * documento valido e sem numero. Para conferir layout existe o preview de
 * demonstracao da tela `Modelo e Configuracao da PI`.
 *
 * TEMPLATE: usa a versao registrada NA EMISSAO (`issued_template_id`), nunca a
 * ativa hoje. E o que torna o documento reconstruivel depois de o contrato
 * trocar de modelo.
 */

const PI_DOCUMENT_PAGE_KEYS = [PI_PAGE_KEY, PI_TEMPLATE_PAGE_KEY] as const;

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ message, ...(extra ?? {}) }, { status });
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

/** Nome de arquivo seguro para o cabecalho `Content-Disposition`. */
function safeFileName(base: string): string {
  const cleaned = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${cleaned || "PI"}.docx`;
}

type TemplateRow = {
  id: string;
  version: number;
  storage_path: string;
  checksum_sha256: string;
};

export async function generatePiDocument(context: AuthenticatedAppUserContext, piId: string) {
  const denied = await authorizeAnyPageAction(context, PI_DOCUMENT_PAGE_KEYS, "export");
  if (denied) return denied;

  const { supabase, appUser } = context;

  try {
    const row = await fetchPiById(supabase, appUser.tenant_id, piId);
    if (!row) return jsonError("PI nao encontrada.", 404);

    if (row.status !== "ISSUED") {
      return jsonError(
        "O documento so pode ser gerado depois da emissao. Marque a PI como pronta e emita.",
        409,
        { code: "PI_NOT_ISSUED", piStatus: row.status },
      );
    }

    const [steps, { areas, voltages }, projectMap] = await Promise.all([
      fetchPiExecutionSteps(supabase, appUser.tenant_id, piId),
      fetchPiTagsByPi(supabase, appUser.tenant_id, [piId]),
      fetchProjectLookupMap(supabase, appUser.tenant_id, [row.project_id]),
    ]);

    // A versao usada na emissao, e nao a ativa de hoje.
    const templateId = row.issued_template_id as string | null;
    if (!templateId) {
      return jsonError("Esta PI nao registrou o template usado na emissao.", 409, { code: "TEMPLATE_NOT_RECORDED" });
    }

    const { data: template, error: templateError } = await supabase
      .from("pi_document_template")
      .select("id, version, storage_path, checksum_sha256")
      .eq("tenant_id", appUser.tenant_id)
      .eq("id", templateId)
      .maybeSingle<TemplateRow>();

    if (templateError) return jsonError("Falha ao localizar o template da emissao.", 500);
    if (!template) {
      return jsonError("O template usado na emissao nao existe mais.", 409, { code: "TEMPLATE_MISSING" });
    }

    // Defesa em profundidade: o caminho foi gravado pelo servidor, mas uma linha
    // adulterada nao pode virar leitura do arquivo de outro contrato.
    if (!isPiTemplatePathOwnedByTenant(template.storage_path, appUser.tenant_id)) {
      return jsonError("Caminho do template inconsistente com o contrato.", 409, { code: "TEMPLATE_PATH_MISMATCH" });
    }

    const downloaded = await downloadPiTemplateObject(supabase, template.storage_path);
    if (!downloaded.ok) return jsonError(`Falha ao baixar o template: ${downloaded.message}`, 500);

    const documentData = buildDocumentData(row, {
      projectCode: projectMap.get(row.project_id)?.sob ?? "",
      operationAreas: areas.get(piId)?.PI ?? [],
      contactOperationAreas: areas.get(piId)?.CONTACT ?? [],
      voltageLevels: voltages.get(piId)?.PI ?? [],
      interferingVoltageLevels: voltages.get(piId)?.INTERFERING ?? [],
      steps,
    });

    const issues = validatePiDocumentData(documentData).filter((issue) => issue.severity === "ERROR");
    if (issues.length > 0) {
      return jsonError("A PI tem pendencias que impedem gerar o documento.", 422, { errors: issues });
    }

    const rendered = renderDocxTemplate(downloaded.value, buildPiTemplateData(documentData));
    if (!rendered.ok) {
      return jsonError(rendered.error.message, 500, { code: rendered.error.code, details: rendered.error.details });
    }

    // Ultima barreira: tag que sobra sai impressa como `{manager_name}` no
    // documento oficial. Melhor recusar do que entregar um arquivo assim.
    const leftovers = findUnresolvedDocxTags(rendered.value);
    if (leftovers.ok && leftovers.value.length > 0) {
      return jsonError("O documento gerado ficou com tags nao resolvidas e nao foi entregue.", 500, {
        code: "UNRESOLVED_TAGS",
        tags: leftovers.value,
      });
    }

    // Historico so depois de o arquivo existir de verdade: registrar antes
    // deixaria no historico geracoes que nunca chegaram ao usuario.
    //
    // Insert direto em vez da RPC `pi_append_history`: aquele helper e INTERNO
    // das funcoes `SECURITY DEFINER` e nao tem grant para `service_role` — dar
    // esse grant alargaria a superficie sem beneficio. A tabela ja recusa
    // escrita de `anon`/`authenticated`, entao so o Route Handler chega aqui.
    // Falha de log nao derruba a entrega do documento: o arquivo ja existe e o
    // usuario esta esperando por ele.
    const history = await supabase.from("pi_history").insert({
      tenant_id: appUser.tenant_id,
      pi_id: piId,
      action_type: "GENERATE_DOCUMENT",
      changes: {},
      metadata: {
        templateVersion: template.version,
        templateChecksum: template.checksum_sha256,
        piCode: row.pi_code,
      },
      created_by: appUser.id,
    });

    if (history.error) {
      console.error("[permissao-intervencao] falha ao registrar geracao no historico", history.error.message);
    }

    return new NextResponse(new Uint8Array(rendered.value), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeFileName(String(row.pi_code ?? "PI"))}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return jsonError("Falha ao gerar o documento da PI.", 500);
  }
}

type DocumentContext = {
  projectCode: string;
  operationAreas: string[];
  contactOperationAreas: string[];
  voltageLevels: string[];
  interferingVoltageLevels: string[];
  steps: Array<{ work_zone: string | null; team_name_snapshot: string | null; activity: string | null }>;
};

/**
 * Traduz a linha do banco no modelo de dominio do documento.
 *
 * Os nomes dos responsaveis saem do SNAPSHOT gravado na PI, e nao de um join
 * com `people`: renomear alguem depois nao pode reescrever documento ja
 * emitido. Mesma razao para o Plano de Emergencia, que vem do snapshot da
 * emissao e nao da configuracao atual do contrato.
 */
function buildDocumentData(row: Record<string, unknown>, ctx: DocumentContext): PiDocumentData {
  return {
    piCode: String(row.pi_code ?? ""),
    projectCode: ctx.projectCode,
    responsibleParty: {
      managerName: text(row.manager_name),
      companyName: text(row.company_name),
      contractNumber: text(row.contract_number),
      managerPhone: text(row.manager_phone),
      managerEmail: text(row.manager_email),
    },
    operationAreas: ctx.operationAreas as PiOperationAreaCode[],
    utilityContact: {
      name: text(row.utility_contact_name),
      phone: text(row.utility_contact_phone),
      email: text(row.utility_contact_email),
      operationAreas: ctx.contactOperationAreas as PiOperationAreaCode[],
    },
    activity: {
      description: text(row.activity_description),
      workPlan: text(row.work_plan),
      liveWorkAuthorization: text(row.live_work_authorization),
      preApr: text(row.pre_apr),
      emergencyAuthorization: text(row.emergency_authorization),
    },
    location: {
      installationDescription: text(row.installation_description),
      feeder: text(row.feeder),
      address: text(row.address),
      coordX: text(row.coord_x),
      coordY: text(row.coord_y),
      blockedElements: text(row.blocked_elements),
      cutElements: text(row.cut_elements),
    },
    voltageLevels: ctx.voltageLevels as PiVoltageLevelCode[],
    interference: {
      present:
        row.has_interfering_installation === null || row.has_interfering_installation === undefined
          ? null
          : Boolean(row.has_interfering_installation),
      voltageLevels: ctx.interferingVoltageLevels as PiVoltageLevelCode[],
      proximityDescription: text(row.interfering_description),
    },
    schedule: {
      // `work_date` da PI e a data de execucao que aparece no documento.
      startDate: text(row.work_date),
      startTime: text(row.start_time),
      endDate: text(row.end_date),
      endTime: text(row.end_time),
      secondaryDate: text(row.secondary_date),
      secondaryStartTime: text(row.secondary_start_time),
    },
    trafficInstructions: text(row.traffic_instructions),
    emergencyPlan: text(row.emergency_plan_snapshot),
    responsibles: {
      supervisor: text(row.supervisor_name_snapshot),
      supervisorAlternate: text(row.supervisor_alternate_name_snapshot),
      foreman: text(row.foreman_name_snapshot),
      foremanAlternate: text(row.foreman_alternate_name_snapshot),
    },
    executionSteps: ctx.steps.map((step) => ({
      workZone: step.work_zone,
      teamName: step.team_name_snapshot,
      activity: step.activity,
    })),
    observations: text(row.observations),
    preparedAt: {
      date: text(row.prepared_at)?.slice(0, 10) ?? null,
      time: text(row.prepared_at)?.slice(11, 16) ?? null,
    },
    validatedAt: {
      date: text(row.validated_at)?.slice(0, 10) ?? null,
      time: text(row.validated_at)?.slice(11, 16) ?? null,
    },
  };
}
