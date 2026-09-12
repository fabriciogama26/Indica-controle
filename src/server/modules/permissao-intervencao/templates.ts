import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import type { AuthenticatedAppUserContext } from "@/lib/server/appUsersAdmin";
import { buildUserDisplayMap, fetchTenantLinkedAppUsers, loadAllRows } from "@/lib/server/apiHelpers";
import { normalizeExpectedUpdatedAt } from "@/lib/server/concurrency";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { authorizePageAction } from "@/lib/server/routeAuthorization";
import {
  findUnresolvedDocxTags,
  isZipBuffer,
  listDocxTemplateTags,
  renderDocxTemplate,
} from "@/lib/server/docxTemplate";

import { buildPiDemoDocumentData, buildPiDemoFullPlanData } from "./piDemoDocument";
import { buildPiTemplateData, validatePiDocumentData } from "./piTemplateMapper";
import {
  buildPiTemplateStoragePath,
  downloadPiTemplateObject,
  isPiTemplatePathOwnedByTenant,
  PI_TEMPLATE_MAX_BYTES,
  removePiTemplateObject,
  sha256Hex,
  uploadPiTemplateObject,
} from "./piTemplateStorage";
import { buildPiTemplateTagReport, isPiTemplateActivatable, type PiTemplateTagReport } from "./piTemplateTags";

/**
 * Backend da gestao de versoes do template Word da Permissao de Intervencao.
 *
 * A administracao do template e uma tela PROPRIA (`Cadastro Base > Modelo de
 * PI`), separada do cadastro da PI: sao publicos diferentes. Quem sobe e valida
 * o modelo oficial e quem administra o contrato; quem preenche a PI e a
 * operacao. Por isso a `page_key` aqui e `modelo-pi`, e nao a da PI.
 *
 * Uma unica `page_key` cobre listagem, upload, ativacao e preview desta tela,
 * como manda o "Padrao de permissao por tela" do CLAUDE.md: quem enxerga a tela
 * usa todas as funcoes dela. Nao ha permissao granular por operacao.
 *
 * QUANDO A FASE 1 CHEGAR: o endpoint que gera o documento de uma PI real le o
 * template ativo, mas pertence a tela da PI. Ele NAO pode exigir `modelo-pi` —
 * usar `authorizeAnyPageAction` com as duas chaves, ou a tela da PI abriria e a
 * geracao tomaria 403.
 */

export const PI_TEMPLATE_PAGE_KEY = "modelo-pi";

type PiTemplateRow = {
  id: string;
  version: number;
  storage_path: string;
  original_filename: string;
  checksum_sha256: string;
  tag_report: PiTemplateTagReport | Record<string, never>;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type RpcResult = {
  success?: boolean;
  status?: number;
  reason?: string | null;
  message?: string;
  template_id?: string;
  version?: number;
  previous_version?: number | null;
  updated_at?: string;
  tag_report?: unknown;
};

const TEMPLATE_SELECT =
  "id, version, storage_path, original_filename, checksum_sha256, tag_report, is_active, created_by, created_at, updated_at";

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ message, ...(extra ?? {}) }, { status });
}

/** Nome de arquivo seguro para o cabecalho `Content-Disposition`. */
function safeFileName(base: string): string {
  const cleaned = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${cleaned || "documento"}.docx`;
}

function docxResponse(buffer: Buffer, fileName: string) {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ---------------------------------------------------------------------------
// Listagem
// ---------------------------------------------------------------------------

export async function listPiTemplates(context: AuthenticatedAppUserContext) {
  const denied = await authorizePageAction(context, PI_TEMPLATE_PAGE_KEY, "read");
  if (denied) return denied;

  const { supabase, appUser } = context;

  const { data, error } = await loadAllRows<PiTemplateRow>((from, to) =>
    supabase
      .from("pi_document_template")
      .select(TEMPLATE_SELECT)
      .eq("tenant_id", appUser.tenant_id)
      .order("version", { ascending: false })
      .range(from, to)
      .returns<PiTemplateRow[]>(),
  );

  if (error) {
    return jsonError("Falha ao carregar as versoes do template.", 500);
  }

  const rows = data ?? [];
  const userIds = Array.from(new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id))));
  const users = userIds.length ? await fetchTenantLinkedAppUsers(supabase, appUser.tenant_id, userIds) : [];
  const displayMap = buildUserDisplayMap(users);

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      version: row.version,
      originalFilename: row.original_filename,
      checksumSha256: row.checksum_sha256,
      tagReport: (row.tag_report ?? {}) as Partial<PiTemplateTagReport>,
      isActive: row.is_active,
      createdByName: displayMap.get(row.created_by ?? "") ?? "Nao identificado",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    hasActiveTemplate: rows.some((row) => row.is_active),
  });
}

// ---------------------------------------------------------------------------
// Upload de versao
// ---------------------------------------------------------------------------

export async function uploadPiTemplate(context: AuthenticatedAppUserContext, request: NextRequest) {
  const denied = await authorizePageAction(context, PI_TEMPLATE_PAGE_KEY, "import");
  if (denied) return denied;

  const { supabase, appUser } = context;

  // Le e valida um arquivo inteiro em memoria, entao e a rota mais cara do
  // modulo. O teto cobre retentativa legitima sem permitir repeticao continua.
  const limited = await enforceRateLimit(supabase, {
    route: "api.permissao-intervencao.templates.upload",
    identity: appUser.id,
    maxHits: 10,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const formData = await request.formData().catch(() => null);
  if (!formData) return jsonError("Falha ao ler o formulario enviado.", 400);

  const file = formData.get("file");
  if (!(file instanceof File)) return jsonError("Arquivo .docx obrigatorio.", 400);
  if (!file.name.toLowerCase().endsWith(".docx")) return jsonError("Somente arquivo .docx e permitido.", 400);
  if (file.size > PI_TEMPLATE_MAX_BYTES) {
    return jsonError("Arquivo maior que 5MB nao e permitido.", 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Extensao mente; assinatura nao. Um `.docx` e um ZIP e precisa comecar com
  // `PK\x03\x04`.
  if (!isZipBuffer(buffer)) return jsonError("O arquivo enviado nao e um .docx valido.", 400);

  const tags = listDocxTemplateTags(buffer);
  if (!tags.ok) {
    return jsonError(tags.error.message, 400, { code: tags.error.code, details: tags.error.details });
  }

  const tagReport = buildPiTemplateTagReport(tags.value);

  // Recusa ANTES de gravar: template invalido nao ocupa espaco no bucket nem
  // aparece na lista de versoes.
  if (!isPiTemplateActivatable(tagReport)) {
    return jsonError(
      "O template enviado nao passou na conferencia de tags e nao foi gravado.",
      422,
      { code: "TEMPLATE_TAGS_INVALID", tagReport },
    );
  }

  const templateId = randomUUID();
  const storagePath = buildPiTemplateStoragePath(appUser.tenant_id, templateId);

  const uploaded = await uploadPiTemplateObject(supabase, storagePath, buffer);
  if (!uploaded.ok) {
    return jsonError(`Falha ao gravar o arquivo no Storage: ${uploaded.message}`, 500);
  }

  const { data, error } = await supabase.rpc("register_pi_document_template", {
    p_tenant_id: appUser.tenant_id,
    p_actor_user_id: appUser.id,
    p_template_id: templateId,
    p_storage_path: storagePath,
    p_original_filename: file.name,
    p_checksum_sha256: sha256Hex(buffer),
    p_tag_report: tagReport,
  });

  const result = (data ?? {}) as RpcResult;

  // Arquivo gravado e registro recusado deixaria um objeto orfao no bucket, que
  // ninguem enxerga e ninguem limpa. A remocao e best-effort: se falhar, o
  // usuario ainda recebe o erro real do registro.
  if (error || result.success !== true) {
    await removePiTemplateObject(supabase, storagePath);
    return jsonError(result.message ?? "Falha ao registrar a versao do template.", Number(result.status ?? 500), {
      reason: result.reason ?? null,
    });
  }

  return NextResponse.json({
    templateId: result.template_id ?? templateId,
    version: result.version ?? null,
    updatedAt: result.updated_at ?? null,
    tagReport,
    message: result.message ?? "Versao do template registrada.",
  });
}

// ---------------------------------------------------------------------------
// Ativacao de versao
// ---------------------------------------------------------------------------

export type ActivatePiTemplatePayload = {
  templateId?: string;
  expectedUpdatedAt?: string;
};

export async function activatePiTemplate(
  context: AuthenticatedAppUserContext,
  payload: ActivatePiTemplatePayload,
) {
  const denied = await authorizePageAction(context, PI_TEMPLATE_PAGE_KEY, "update");
  if (denied) return denied;

  const templateId = String(payload.templateId ?? "").trim();
  if (!templateId) return jsonError("Informe a versao do template a ativar.", 400);

  const { supabase, appUser } = context;

  const { data, error } = await supabase.rpc("activate_pi_document_template", {
    p_tenant_id: appUser.tenant_id,
    p_actor_user_id: appUser.id,
    p_template_id: templateId,
    p_expected_updated_at: normalizeExpectedUpdatedAt(payload.expectedUpdatedAt),
  });

  if (error) return jsonError("Falha ao ativar a versao do template.", 500);

  const result = (data ?? {}) as RpcResult;
  if (result.success !== true) {
    return jsonError(result.message ?? "Falha ao ativar a versao do template.", Number(result.status ?? 400), {
      reason: result.reason ?? null,
      tagReport: result.tag_report ?? null,
    });
  }

  return NextResponse.json({
    templateId: result.template_id ?? templateId,
    version: result.version ?? null,
    previousVersion: result.previous_version ?? null,
    updatedAt: result.updated_at ?? null,
    message: result.message ?? "Versao ativada com sucesso.",
  });
}

// ---------------------------------------------------------------------------
// Preview: DOCX de demonstracao a partir do template ativo
// ---------------------------------------------------------------------------

export type PiTemplatePreviewPayload = {
  /** `full` preenche as 23 linhas do plano, para conferir o pior caso de layout. */
  variant?: "default" | "full";
};

/**
 * Gera um DOCX de DEMONSTRACAO a partir do template ativo do tenant.
 *
 * Os dados sao montados no servidor (`buildPiDemoDocumentData`) e nao vem do
 * cliente: o preview existe para conferir o TEMPLATE, e aceitar conteudo
 * arbitrario transformaria a rota num gerador de documento livre com a
 * identidade visual oficial.
 *
 * Este NAO e o endpoint que emite a PI. Aquele depende da entidade
 * `permission_intervention`, que entra na Fase 1 do modulo.
 */
export async function generatePiTemplatePreview(
  context: AuthenticatedAppUserContext,
  payload: PiTemplatePreviewPayload,
) {
  const denied = await authorizePageAction(context, PI_TEMPLATE_PAGE_KEY, "export");
  if (denied) return denied;

  const { supabase, appUser } = context;

  const limited = await enforceRateLimit(supabase, {
    route: "api.permissao-intervencao.templates.preview",
    identity: appUser.id,
    maxHits: 20,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const { data: row, error } = await supabase
    .from("pi_document_template")
    .select(TEMPLATE_SELECT)
    .eq("tenant_id", appUser.tenant_id)
    .eq("is_active", true)
    .maybeSingle<PiTemplateRow>();

  if (error) return jsonError("Falha ao localizar o template ativo.", 500);
  if (!row) {
    return jsonError("Nenhum template ativo neste contrato. Suba e ative uma versao antes de gerar o documento.", 404, {
      code: "NO_ACTIVE_TEMPLATE",
    });
  }

  // Defesa em profundidade: o caminho foi gravado pelo servidor, mas uma linha
  // adulterada nao pode virar leitura do arquivo de outro tenant.
  if (!isPiTemplatePathOwnedByTenant(row.storage_path, appUser.tenant_id)) {
    return jsonError("Caminho do template inconsistente com o contrato.", 409, { code: "TEMPLATE_PATH_MISMATCH" });
  }

  const downloaded = await downloadPiTemplateObject(supabase, row.storage_path);
  if (!downloaded.ok) {
    return jsonError(`Falha ao baixar o template ativo: ${downloaded.message}`, 500);
  }

  const documentData =
    payload.variant === "full" ? buildPiDemoFullPlanData() : buildPiDemoDocumentData();

  const issues = validatePiDocumentData(documentData);
  const blocking = issues.filter((issue) => issue.severity === "ERROR");
  if (blocking.length > 0) {
    return jsonError("Os dados de demonstracao nao passaram na validacao.", 422, { issues: blocking });
  }

  const rendered = renderDocxTemplate(downloaded.value, buildPiTemplateData(documentData));
  if (!rendered.ok) {
    return jsonError(rendered.error.message, 500, { code: rendered.error.code, details: rendered.error.details });
  }

  // Ultima barreira: tag que sobra sai impressa como `{manager_name}` no
  // documento. Melhor recusar do que entregar um arquivo assim.
  const leftovers = findUnresolvedDocxTags(rendered.value);
  if (leftovers.ok && leftovers.value.length > 0) {
    return jsonError("O documento gerado ficou com tags nao resolvidas e nao foi entregue.", 500, {
      code: "UNRESOLVED_TAGS",
      tags: leftovers.value,
    });
  }

  return docxResponse(rendered.value, safeFileName(`PI-demonstracao-v${row.version}`));
}
