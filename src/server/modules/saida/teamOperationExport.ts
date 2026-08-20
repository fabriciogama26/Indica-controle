import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

/**
 * Exportacao CSV de Operacoes de Equipe.
 *
 * O trabalho pesado — joins de material, centro de estoque, projeto e os dois niveis de estorno,
 * mais filtros e ordenacao — fica na RPC `list_team_operations_export` (migration 379). Aqui so
 * sobra serializar as colunas ja prontas e transmitir, paginando a RPC para nao materializar o
 * arquivo inteiro em memoria.
 */

// O PostgREST deste projeto trunca qualquer resposta em 1000 linhas (`db-max-rows`), e essa
// janela nao aparece como erro: a resposta volta 200 com menos linhas do que o SQL produziu.
// Por isso todo o repositorio pagina de 1000 em 1000. Pedir mais do que isso aqui nao traria
// mais linhas, so faria o Postgres calcular resultado que seria descartado no caminho.
export const EXPORT_RPC_PAGE_SIZE = 1000;

const EXPORT_CSV_FIELDS = [
  "operacao",
  "centro_estoque",
  "equipe",
  "encarregado",
  "origem_apoio",
  "projeto",
  "material_codigo",
  "descricao",
  "categoria",
  "subcategoria",
  "quantidade",
  "serial",
  "lp",
  "data_operacao",
  "tipo",
  "status",
  "observacao",
] as const;

const EXPORT_CSV_HEADER = EXPORT_CSV_FIELDS.join(";");

export type TeamOperationExportFilters = {
  teamIdFilter: string;
  operationKindFilter: string | null;
  startDate: string | null;
  endDate: string | null;
  projectIdFilter: string;
  entryTypeFilter: "SUCATA" | "NOVO" | null;
  materialCodeFilter: string;
  categoryIdFilter: string;
  subcategoryIdFilter: string;
  reversalStatus: "TODOS" | "ESTORNADAS" | "NAO_ESTORNADAS" | "ESTORNOS";
};

type TeamOperationExportRow = Record<(typeof EXPORT_CSV_FIELDS)[number], string | null>;

export type TeamOperationExportStream =
  | { kind: "empty" }
  | { kind: "error"; error: PostgrestError }
  | { kind: "stream"; body: ReadableStream<Uint8Array>; fileName: string };

function toCsvLine(row: TeamOperationExportRow) {
  // Mesmo saneamento que o frontend aplicava: o separador e `;`, entao `;` no conteudo vira `,`.
  // Sem isso uma observacao com ponto-e-virgula desloca todas as colunas seguintes da linha.
  return EXPORT_CSV_FIELDS.map((field) => String(row[field] ?? "").replace(/;/g, ",")).join(";");
}

async function loadExportPage(
  supabase: SupabaseClient,
  tenantId: string,
  filters: TeamOperationExportFilters,
  offset: number,
) {
  const { data, error } = await supabase.rpc("list_team_operations_export", {
    p_tenant_id: tenantId,
    p_start_date: filters.startDate,
    p_end_date: filters.endDate,
    p_team_id: filters.teamIdFilter || null,
    p_operation_kind: filters.operationKindFilter,
    p_project_id: filters.projectIdFilter || null,
    p_material_code: filters.materialCodeFilter || null,
    p_category_id: filters.categoryIdFilter || null,
    p_subcategory_id: filters.subcategoryIdFilter || null,
    p_entry_type: filters.entryTypeFilter,
    p_reversal_status: filters.reversalStatus,
    p_limit: EXPORT_RPC_PAGE_SIZE,
    p_offset: offset,
  });

  return {
    data: (data ?? []) as TeamOperationExportRow[],
    error: error as PostgrestError | null,
  };
}

export async function buildTeamOperationExportStream(
  supabase: SupabaseClient,
  tenantId: string,
  filters: TeamOperationExportFilters,
  onPageError: (step: string, error: PostgrestError, context: Record<string, unknown>) => void,
): Promise<TeamOperationExportStream> {
  const firstPage = await loadExportPage(supabase, tenantId, filters, 0);

  if (firstPage.error) {
    return { kind: "error", error: firstPage.error };
  }

  const firstRows = firstPage.data;
  if (!firstRows.length) {
    return { kind: "empty" };
  }

  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // BOM UTF-8: sem ele o Excel pt-BR abre a acentuacao corrompida.
      controller.enqueue(encoder.encode(`\uFEFF${EXPORT_CSV_HEADER}\n`));
      controller.enqueue(encoder.encode(`${firstRows.map(toCsvLine).join("\n")}\n`));

      let offset = firstRows.length;
      let pageRowCount = firstRows.length;

      // Para em pagina VAZIA, nunca em pagina menor que a pedida, e avanca o offset pelo numero
      // de linhas realmente recebidas. Comparar com o limite pedido quebra silenciosamente se o
      // teto do PostgREST for menor que ele: a primeira pagina volta truncada, a condicao da
      // como fim do resultado e o CSV sai cortado parecendo completo. Custa uma chamada extra
      // no fim de cada exportacao.
      while (pageRowCount > 0) {
        const nextPage = await loadExportPage(supabase, tenantId, filters, offset);

        if (nextPage.error) {
          onPageError("team-operations-export-rpc-page", nextPage.error, { tenantId, offset });
          // Status 200 e cabecalhos ja foram enviados; nao ha como virar erro HTTP agora.
          // Abortar o stream faz o navegador acusar download incompleto, em vez de salvar um
          // CSV truncado que parece integro.
          controller.error(nextPage.error);
          return;
        }

        const rows = nextPage.data;
        pageRowCount = rows.length;
        if (!pageRowCount) {
          break;
        }

        controller.enqueue(encoder.encode(`${rows.map(toCsvLine).join("\n")}\n`));
        offset += pageRowCount;
      }

      controller.close();
    },
  });

  return {
    kind: "stream",
    body,
    fileName: `operacoes_equipe_${new Date().toISOString().slice(0, 10)}.csv`,
  };
}
