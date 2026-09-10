import type {
  PiPreviewVariant,
  PiTemplateListResponse,
  PiTemplateMutationResponse,
} from "./types";

/**
 * Chamadas da tela para `/api/permissao-intervencao`.
 *
 * Todas usam o mesmo `page_key` da tela, entao quem consegue abrir a tela
 * consegue executar todas as acoes dela. Nao ha permissao granular por operacao
 * neste modulo.
 */

const TEMPLATES_URL = "/api/permissao-intervencao/templates";

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function fetchPiTemplates(accessToken: string): Promise<PiTemplateListResponse> {
  const response = await fetch(TEMPLATES_URL, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
  const data = (await response.json().catch(() => ({}))) as PiTemplateListResponse;
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao carregar as versoes do template.");
  }
  return data;
}

export async function uploadPiTemplate(accessToken: string, file: File): Promise<PiTemplateMutationResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(TEMPLATES_URL, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: formData,
  });

  const data = (await response.json().catch(() => ({}))) as PiTemplateMutationResponse;
  if (!response.ok) {
    // O erro de conferencia de tags carrega o relatorio: a tela precisa dele
    // para dizer QUAL tag falta, e nao apenas que o template foi recusado.
    const error = new Error(data.message ?? "Falha ao enviar o template.") as Error & {
      payload?: PiTemplateMutationResponse;
    };
    error.payload = data;
    throw error;
  }
  return data;
}

export async function activatePiTemplate(
  accessToken: string,
  templateId: string,
  expectedUpdatedAt: string,
): Promise<PiTemplateMutationResponse> {
  const response = await fetch(TEMPLATES_URL, {
    method: "PUT",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ templateId, expectedUpdatedAt }),
  });

  const data = (await response.json().catch(() => ({}))) as PiTemplateMutationResponse;
  if (!response.ok) {
    throw new Error(data.message ?? "Falha ao ativar a versao.");
  }
  return data;
}

/**
 * Baixa o DOCX de demonstracao do template ativo.
 *
 * A resposta e binaria no caminho feliz e JSON no erro, entao o tipo do
 * conteudo decide como ler. Devolve o Blob para quem chama disparar o download.
 */
export async function downloadPiTemplatePreview(
  accessToken: string,
  variant: PiPreviewVariant,
): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(`${TEMPLATES_URL}/preview`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ variant }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as PiTemplateMutationResponse;
    throw new Error(data.message ?? "Falha ao gerar o documento de demonstracao.");
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await response.blob(), fileName: match?.[1] ?? "PI-demonstracao.docx" };
}
