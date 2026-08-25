"use client";

import { useCallback, useState } from "react";

import { downloadCsvFile } from "@/lib/utils/csv";
import {
  createMassImportErrorReport,
  type MassImportErrorReport,
  type MassImportIssue,
  type MassImportResult,
  type MassImportRowResult,
} from "@/lib/utils/massImport";

export type MassImportSubmitOutcome = {
  ok: boolean;
  message?: string;
  savedCount: number;
  results: MassImportRowResult[];
};

export type MassImportParseOutcome<TRow> = {
  rows: TRow[];
  issues: MassImportIssue[];
};

type UseMassImportParams<TRow> = {
  /** Rotulo no plural usado nas mensagens ("cargos", "equipes", "atividades"). */
  entityLabel: string;
  /** Prefixo do arquivo CSV de erros baixado pelo usuario. */
  errorFilePrefix: string;
  /** Nome do arquivo modelo e conteudo CSV do modelo. */
  templateFileName: string;
  buildTemplateCsv: () => string;
  /** Validacao de dominio do arquivo, executada antes de enviar ao backend. */
  parse: (content: string, fileName: string) => MassImportParseOutcome<TRow>;
  /** Envio em lote ao backend. */
  submit: (rows: TRow[]) => Promise<MassImportSubmitOutcome>;
  /** Traduz o codigo de erro devolvido pelo backend para a coluna do CSV. */
  resolveErrorColumn?: (code?: string) => string;
  onImported?: (savedCount: number) => Promise<void> | void;
  onFeedback?: (feedback: { type: "success" | "error"; message: string }) => void;
  onError?: (error: unknown) => Promise<void> | void;
};

export type MassImportController = {
  isOpen: boolean;
  isImporting: boolean;
  file: File | null;
  result: MassImportResult | null;
  errorReport: MassImportErrorReport | null;
  open: () => void;
  close: () => void;
  selectFile: (file: File | null) => void;
  downloadTemplate: () => void;
  downloadErrorReport: () => void;
  run: () => Promise<void>;
};

export function useMassImport<TRow>(params: UseMassImportParams<TRow>): MassImportController {
  const {
    entityLabel,
    errorFilePrefix,
    templateFileName,
    buildTemplateCsv,
    parse,
    submit,
    resolveErrorColumn,
    onImported,
    onFeedback,
    onError,
  } = params;

  const [isOpen, setIsOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<MassImportResult | null>(null);
  const [errorReport, setErrorReport] = useState<MassImportErrorReport | null>(null);

  const open = useCallback(() => {
    setFile(null);
    setResult(null);
    setErrorReport(null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    if (isImporting) {
      return;
    }

    setFile(null);
    setResult(null);
    setErrorReport(null);
    setIsOpen(false);
  }, [isImporting]);

  const downloadTemplate = useCallback(() => {
    downloadCsvFile(buildTemplateCsv(), templateFileName);
  }, [buildTemplateCsv, templateFileName]);

  const downloadErrorReport = useCallback(() => {
    if (!errorReport) {
      return;
    }

    downloadCsvFile(errorReport.content, errorReport.fileName);
  }, [errorReport]);

  const run = useCallback(async () => {
    if (!file || isImporting) {
      return;
    }

    setIsImporting(true);
    setResult(null);
    setErrorReport(null);

    try {
      const content = await file.text();
      const parsed = parse(content, file.name);
      const issues = [...parsed.issues];

      if (!parsed.rows.length) {
        const report = createMassImportErrorReport(errorFilePrefix, issues);
        setErrorReport(report);
        setResult({
          status: "error",
          message: `Nenhuma linha valida de ${entityLabel} foi encontrada para importar.`,
          successCount: 0,
          errorRows: report?.errorRows ?? 0,
        });
        onFeedback?.({
          type: "error",
          message: `Nenhuma linha valida de ${entityLabel} foi encontrada. Baixe o CSV de erros para corrigir.`,
        });
        return;
      }

      const outcome = await submit(parsed.rows);

      if (!outcome.ok) {
        issues.push({
          rowNumber: 1,
          column: "salvamento",
          value: file.name,
          error: outcome.message ?? `Falha ao importar ${entityLabel} em massa.`,
        });
      }

      for (const rowResult of outcome.results) {
        if (rowResult.success) {
          continue;
        }

        issues.push({
          rowNumber: rowResult.rowNumber,
          column: resolveErrorColumn?.(rowResult.code) ?? "salvamento",
          value: "",
          error: rowResult.message || `Falha ao salvar ${entityLabel}.`,
        });
      }

      const report = createMassImportErrorReport(errorFilePrefix, issues);
      const errorRows = report?.errorRows ?? 0;
      const successCount = outcome.savedCount;
      setErrorReport(report);

      if (successCount > 0) {
        await onImported?.(successCount);
      }

      if (!successCount) {
        const message = `Cadastro em massa sem sucesso. 0 ${entityLabel} salvos e ${errorRows} linhas com erro.`;
        setResult({ status: "error", message, successCount: 0, errorRows });
        onFeedback?.({ type: "error", message });
        return;
      }

      if (errorRows > 0) {
        const message = `Cadastro em massa parcial: ${successCount} ${entityLabel} salvos e ${errorRows} linhas com erro.`;
        setResult({ status: "partial", message, successCount, errorRows });
        onFeedback?.({ type: "success", message });
        return;
      }

      setResult({ status: "success", message: "Incluido com sucesso.", successCount, errorRows: 0 });
      onFeedback?.({
        type: "success",
        message: `Cadastro em massa concluido com sucesso. ${successCount} ${entityLabel} salvos.`,
      });
    } catch (error) {
      await onError?.(error);
      const message = `Falha ao importar ${entityLabel} em massa.`;
      setResult({ status: "error", message, successCount: 0, errorRows: 0 });
      onFeedback?.({ type: "error", message });
    } finally {
      setIsImporting(false);
    }
  }, [
    entityLabel,
    errorFilePrefix,
    file,
    isImporting,
    onError,
    onFeedback,
    onImported,
    parse,
    resolveErrorColumn,
    submit,
  ]);

  return {
    isOpen,
    isImporting,
    file,
    result,
    errorReport,
    open,
    close,
    selectFile: setFile,
    downloadTemplate,
    downloadErrorReport,
    run,
  };
}
