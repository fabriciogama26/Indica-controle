import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mecanica generica de importacao em massa, compartilhada por qualquer modulo.
 * Nao contem regra de dominio: cada modulo decide como validar/normalizar a
 * linha (`prepared`) e qual RPC em lote gravar; este arquivo so numera, separa
 * validas de invalidas, faz a UNICA chamada RPC, junta o resultado do banco com
 * as falhas de validacao e ordena por linha.
 */

export type MassImportRowResult = {
  rowNumber: number;
  success: boolean;
  message: string;
  code?: string;
};

export type MassImportRunResult = {
  success: true;
  savedCount: number;
  errorCount: number;
  results: MassImportRowResult[];
};

export type PreparedMassImportRow<TPayload> =
  | { rowNumber: number; ok: true; payload: TPayload }
  | { rowNumber: number; ok: false; message: string; code?: string };

type BatchRpcRowResult = {
  rowNumber: number;
  success: boolean;
  message?: string;
  reason?: string;
};

type BatchRpcResult = {
  success?: boolean;
  message?: string;
  reason?: string;
  results?: BatchRpcRowResult[];
};

export async function runMassImport<TPayload>(params: {
  supabase: SupabaseClient;
  prepared: PreparedMassImportRow<TPayload>[];
  rpcName: string;
  buildRpcParams: (
    validRows: Array<{ rowNumber: number; payload: TPayload }>,
  ) => Record<string, unknown>;
  genericFailureMessage: string;
}): Promise<MassImportRunResult> {
  const { supabase, prepared, rpcName, buildRpcParams, genericFailureMessage } = params;

  const results: MassImportRowResult[] = [];
  const validRows: Array<{ rowNumber: number; payload: TPayload }> = [];

  prepared.forEach((row) => {
    if (!row.ok) {
      results.push({ rowNumber: row.rowNumber, success: false, message: row.message, code: row.code });
      return;
    }

    validRows.push({ rowNumber: row.rowNumber, payload: row.payload });
  });

  let savedCount = 0;

  if (validRows.length > 0) {
    const { data, error } = await supabase.rpc(rpcName, buildRpcParams(validRows));

    if (error) {
      validRows.forEach((row) => {
        results.push({ rowNumber: row.rowNumber, success: false, message: genericFailureMessage });
      });
    } else {
      const rpcResult = (data ?? {}) as BatchRpcResult;

      // Falha estrutural da RPC (payload invalido, pre-condicao do lote nao
      // atendida): nao ha `results` por linha, entao toda linha valida falha
      // com a mesma mensagem, em vez de sumir em silencio do resultado.
      if (rpcResult.success === false) {
        validRows.forEach((row) => {
          results.push({
            rowNumber: row.rowNumber,
            success: false,
            message: rpcResult.message || genericFailureMessage,
            code: rpcResult.reason,
          });
        });
        results.sort((a, b) => a.rowNumber - b.rowNumber);
        return {
          success: true,
          savedCount: 0,
          errorCount: results.filter((row) => !row.success).length,
          results,
        };
      }

      (rpcResult.results ?? []).forEach((row) => {
        if (row.success) {
          savedCount += 1;
        }

        results.push({
          rowNumber: row.rowNumber,
          success: row.success,
          message: row.success ? row.message ?? "Registro salvo com sucesso." : row.message || genericFailureMessage,
          code: row.success ? undefined : row.reason,
        });
      });
    }
  }

  results.sort((a, b) => a.rowNumber - b.rowNumber);

  return {
    success: true,
    savedCount,
    errorCount: results.filter((row) => !row.success).length,
    results,
  };
}
