import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Acesso ao bucket do template da Permissao de Intervencao.
 *
 * Regra que este modulo existe para impor: NENHUM trecho do caminho vem do
 * cliente. O caminho e derivado do tenant da sessao e de um UUID gerado no
 * servidor. Aceitar caminho do frontend permitiria ler o template de outro
 * tenant trocando uma string no corpo da requisicao.
 *
 * O bucket e privado e nasceu sem policy alguma em `storage.objects`: com RLS
 * ativa e zero policy, so o `service_role` alcanca o arquivo. Todas as funcoes
 * daqui recebem o cliente ja resolvido pela rota, que e o de service_role.
 */

export const PI_TEMPLATE_BUCKET = "pi-templates";

/** MIME do `.docx`. O bucket tambem restringe por este valor. */
export const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Teto da aplicacao, menor que o teto do bucket (10 MB) de proposito: assim o
 * usuario recebe a nossa mensagem em portugues, e nao o erro cru do Storage.
 */
export const PI_TEMPLATE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Caminho do objeto. O primeiro segmento e o tenant, e o nome e o UUID que
 * tambem vira PK da linha em `pi_document_template`.
 *
 * A versao NAO entra no caminho: ela so pode ser atribuida com seguranca dentro
 * da transacao que insere a linha (ver comentario da migration 426), e o
 * caminho precisa existir antes disso.
 */
export function buildPiTemplateStoragePath(tenantId: string, templateId: string): string {
  return `${tenantId}/${templateId}.docx`;
}

/** Confere que um caminho gravado pertence mesmo ao tenant da sessao. */
export function isPiTemplatePathOwnedByTenant(storagePath: string, tenantId: string): boolean {
  return storagePath.startsWith(`${tenantId}/`);
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export type PiStorageResult<T> = { ok: true; value: T } | { ok: false; message: string };

export async function uploadPiTemplateObject(
  supabase: SupabaseClient,
  storagePath: string,
  buffer: Buffer,
): Promise<PiStorageResult<null>> {
  // `contentType` explicito e obrigatorio: o cliente do Supabase nao deduz o
  // tipo de um Buffer, e o bucket restringe MIME. Sem isto o upload e recusado
  // com uma mensagem que nao explica a causa.
  const { error } = await supabase.storage.from(PI_TEMPLATE_BUCKET).upload(storagePath, buffer, {
    contentType: DOCX_MIME_TYPE,
    upsert: false,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, value: null };
}

export async function downloadPiTemplateObject(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<PiStorageResult<Buffer>> {
  const { data, error } = await supabase.storage.from(PI_TEMPLATE_BUCKET).download(storagePath);
  if (error || !data) return { ok: false, message: error?.message ?? "Arquivo do template nao encontrado." };
  return { ok: true, value: Buffer.from(await data.arrayBuffer()) };
}

/**
 * Remove um objeto. Usada apenas para limpar upload orfao quando o registro da
 * versao falha depois de o arquivo ja ter subido — nunca para apagar versao
 * publicada.
 */
export async function removePiTemplateObject(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<PiStorageResult<null>> {
  const { error } = await supabase.storage.from(PI_TEMPLATE_BUCKET).remove([storagePath]);
  if (error) return { ok: false, message: error.message };
  return { ok: true, value: null };
}
