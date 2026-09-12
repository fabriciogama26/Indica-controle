"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { formatDateTime } from "@/lib/utils/formatters";

import {
  activatePiTemplate,
  downloadPiTemplatePreview,
  fetchPiTemplates,
  uploadPiTemplate,
} from "./api";
import { PiConfigurationCard } from "./components/PiConfigurationCard";
import styles from "./PiTemplatePageView.module.css";
import type { PiPreviewVariant, PiTemplateItem, PiTemplateMutationResponse } from "./types";

/**
 * Tela da Permissao de Intervencao — primeira etapa: gestao das versoes do
 * template Word.
 *
 * O cadastro da PI em si (listagem, formulario, vinculo com a Programacao,
 * emissao) depende da entidade `permission_intervention`, que ainda nao existe.
 * Enquanto isso, esta tela entrega o que ja e utilizavel: subir uma versao do
 * template, ver a conferencia das tags, ativar a versao que vale e gerar um
 * documento de demonstracao para conferir o layout no Word.
 */

type Feedback = { type: "success" | "error"; message: string; tags?: string[] };

function describeTagIssues(payload: PiTemplateMutationResponse | undefined): string[] {
  const report = payload?.tagReport;
  if (!report) return [];
  const issues: string[] = [];
  if (report.missingRequired?.length) {
    issues.push(`Tags obrigatorias ausentes: ${report.missingRequired.join(", ")}`);
  }
  if (report.unknown?.length) {
    issues.push(`Tags desconhecidas no arquivo: ${report.unknown.join(", ")}`);
  }
  return issues;
}

export function PiTemplatePageView() {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const logError = useErrorLogger("modelo-pi");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<PiTemplateItem[]>([]);
  const [hasActiveTemplate, setHasActiveTemplate] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [previewVariant, setPreviewVariant] = useState<PiPreviewVariant | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const loadTemplates = useCallback(async () => {
    if (!accessToken) return;

    setIsLoading(true);
    try {
      const data = await fetchPiTemplates(accessToken);
      setItems(data.items ?? []);
      setHasActiveTemplate(Boolean(data.hasActiveTemplate));
    } catch (error) {
      logError("Falha ao carregar as versoes do template da PI.", error, { step: "load-templates" });
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar as versoes." });
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, logError]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  async function handleUpload(file: File) {
    if (!accessToken || isUploading) return;

    setIsUploading(true);
    setFeedback(null);

    try {
      const result = await uploadPiTemplate(accessToken, file);
      setFeedback({
        type: "success",
        message: result.message ?? `Versao ${result.version ?? ""} registrada. Ative-a para passar a valer.`,
      });
      await loadTemplates();
    } catch (error) {
      const payload = (error as { payload?: PiTemplateMutationResponse }).payload;
      const issues = describeTagIssues(payload);
      logError("Falha ao enviar uma versao do template da PI.", error, { step: "upload-template" });
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao enviar o template.",
        tags: issues,
      });
    } finally {
      setIsUploading(false);
      // Sem isto, escolher o MESMO arquivo de novo depois de um erro nao
      // dispara `change` e a tela parece travada.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleActivate(item: PiTemplateItem) {
    if (!accessToken || busyTemplateId) return;

    setBusyTemplateId(item.id);
    setFeedback(null);

    try {
      const result = await activatePiTemplate(accessToken, item.id, item.updatedAt);
      setFeedback({ type: "success", message: result.message ?? `Versao ${item.version} ativada.` });
      await loadTemplates();
    } catch (error) {
      logError("Falha ao ativar uma versao do template da PI.", error, { step: "activate-template" });
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao ativar a versao." });
    } finally {
      setBusyTemplateId(null);
    }
  }

  async function handlePreview(variant: PiPreviewVariant) {
    if (!accessToken || previewVariant) return;

    setPreviewVariant(variant);
    setFeedback(null);

    try {
      const { blob, fileName } = await downloadPiTemplatePreview(accessToken, variant);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      setFeedback({ type: "success", message: "Documento de demonstracao gerado. Abra no Word para conferir o layout." });
    } catch (error) {
      logError("Falha ao gerar o documento de demonstracao da PI.", error, { step: "preview-template", variant });
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao gerar o documento." });
    } finally {
      setPreviewVariant(null);
    }
  }

  const isBusy = isLoading || isUploading || Boolean(busyTemplateId) || Boolean(previewVariant);

  return (
    <div className={styles.wrapper}>
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Template do documento</h3>
        <p className={styles.intro}>
          O documento da Permissao de Intervencao e gerado a partir do arquivo Word oficial: o sistema
          copia o template e preenche as tags com os dados do cadastro. O arquivo original nunca e
          alterado, e o layout continua sendo o do formulario aprovado.
        </p>
        <p className={styles.intro}>
          Cada envio cria uma versao nova, que nasce inativa. Somente a versao <strong>ativa</strong> e
          usada na geracao, e voltar para uma versao anterior e so ativa-la de novo.
        </p>

        <div className={styles.actions}>
          <label className={styles.primaryButton}>
            {isUploading ? "Enviando..." : "Enviar nova versao"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx"
              className={styles.hiddenInput}
              disabled={isBusy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
          </label>

          <button
            type="button"
            className={styles.secondaryButton}
            disabled={isBusy || !hasActiveTemplate}
            onClick={() => void handlePreview("default")}
          >
            {previewVariant === "default" ? "Gerando..." : "Gerar demonstracao"}
          </button>

          <button
            type="button"
            className={styles.secondaryButton}
            disabled={isBusy || !hasActiveTemplate}
            onClick={() => void handlePreview("full")}
          >
            {previewVariant === "full" ? "Gerando..." : "Gerar demonstracao (23 etapas)"}
          </button>
        </div>

        {!hasActiveTemplate && !isLoading ? (
          <p className={styles.warning}>
            Nenhuma versao ativa neste contrato. Envie um arquivo e ative a versao antes de gerar
            qualquer documento.
          </p>
        ) : null}

        {feedback ? (
          <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
            <p className={styles.feedbackMessage}>{feedback.message}</p>
            {feedback.tags?.length ? (
              <ul className={styles.tagList}>
                {feedback.tags.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Versoes registradas</h3>

        {isLoading ? <p className={styles.intro}>Carregando...</p> : null}

        {!isLoading && items.length === 0 ? (
          <p className={styles.intro}>Nenhuma versao registrada ainda.</p>
        ) : null}

        {items.length > 0 ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Versao</th>
                  <th>Arquivo</th>
                  <th>Tags</th>
                  <th>Enviado por</th>
                  <th>Enviado em</th>
                  <th>Situacao</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const present = item.tagReport?.present?.length ?? 0;
                  const missing = item.tagReport?.missing?.length ?? 0;
                  return (
                    <tr key={item.id}>
                      <td>v{item.version}</td>
                      <td className={styles.fileCell} title={item.checksumSha256}>
                        {item.originalFilename}
                      </td>
                      <td>
                        {present} conferidas{missing > 0 ? `, ${missing} ausentes` : ""}
                      </td>
                      <td>{item.createdByName}</td>
                      <td>{formatDateTime(item.createdAt)}</td>
                      <td>
                        <span className={item.isActive ? styles.badgeActive : styles.badgeIdle}>
                          {item.isActive ? "Ativa" : "Inativa"}
                        </span>
                      </td>
                      <td>
                        {item.isActive ? (
                          <span className={styles.mutedText}>Em uso</span>
                        ) : (
                          <button
                            type="button"
                            className={styles.linkButton}
                            disabled={isBusy}
                            onClick={() => void handleActivate(item)}
                          >
                            {busyTemplateId === item.id ? "Ativando..." : "Ativar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      {accessToken ? <PiConfigurationCard accessToken={accessToken} /> : null}
    </div>
  );
}
