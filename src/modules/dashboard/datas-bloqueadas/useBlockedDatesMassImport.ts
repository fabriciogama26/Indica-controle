"use client";

import { useCallback } from "react";

import { useMassImport, type MassImportController } from "@/hooks/useMassImport";
import type { MassImportRowResult } from "@/lib/utils/massImport";

import {
  buildBlockedDateMassImportTemplateCsv,
  parseBlockedDateMassImportCsv,
  type BlockedDateImportRow,
} from "./massImport";
import type { BlockedDateMunicipalityOption } from "./types";

/**
 * Traduz o codigo devolvido pelo backend para a coluna do CSV de erros, para o
 * usuario abrir o arquivo e ir direto na celula errada.
 */
function resolveErrorColumn(code?: string) {
  switch (code) {
    case "DUPLICATE_NATIONAL_DATE":
    case "DUPLICATE_MUNICIPAL_DATE":
    case "DUPLICATE_IN_FILE":
      return "data";
    case "MUNICIPALITY_REQUIRED":
    case "MUNICIPALITY_NOT_FOUND":
      return "municipio";
    case "INVALID_SCOPE":
      return "abrangencia";
    case "INVALID_KIND":
      return "tipo";
    case "MISSING_REQUIRED_FIELDS":
    case "INVALID_ROW":
      return "linha";
    default:
      return "salvamento";
  }
}

/**
 * Fiacao do cadastro em massa da tela de Datas Bloqueadas.
 *
 * Fica fora do `BlockedDatesPageView` porque a tela ja estava perto do teto de
 * 1.000 linhas do `lint:size`; aqui tambem isola a conversa com a API do resto
 * do formulario.
 *
 * O municipio e resolvido por NOME no CLIENTE, contra a lista de municipios
 * ativos que a propria listagem devolve — mesmo padrao do import de Equipes. O
 * backend recebe o id ja resolvido e nunca faz busca por nome.
 */
export function useBlockedDatesMassImport(params: {
  accessToken: string | null;
  municipalities: BlockedDateMunicipalityOption[];
  onImported: () => Promise<void> | void;
  onFeedback: (feedback: { type: "success" | "error"; message: string }) => void;
  onError: (error: unknown) => Promise<void> | void;
}): MassImportController {
  const { accessToken, municipalities, onImported, onFeedback, onError } = params;

  const parse = useCallback(
    (content: string, fileName: string) => parseBlockedDateMassImportCsv({ content, fileName, municipalities }),
    [municipalities],
  );

  const submit = useCallback(
    async (rows: BlockedDateImportRow[]) => {
      if (!accessToken) {
        return {
          ok: false,
          message: "Sessao invalida para importar datas bloqueadas em massa.",
          savedCount: 0,
          results: [],
        };
      }

      const response = await fetch("/api/blocked-dates", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: "BATCH_IMPORT", rows }),
      });

      const data = (await response.json().catch(() => null)) as
        | { savedCount?: number; results?: MassImportRowResult[]; message?: string }
        | null;

      return {
        ok: response.ok,
        message: data?.message,
        savedCount: Number(data?.savedCount ?? 0),
        results: data?.results ?? [],
      };
    },
    [accessToken],
  );

  return useMassImport<BlockedDateImportRow>({
    entityLabel: "datas bloqueadas",
    errorFilePrefix: "datas_bloqueadas",
    templateFileName: "modelo_datas_bloqueadas_cadastro_em_massa.csv",
    buildTemplateCsv: buildBlockedDateMassImportTemplateCsv,
    parse,
    submit,
    resolveErrorColumn,
    onImported,
    onFeedback,
    onError,
  });
}
