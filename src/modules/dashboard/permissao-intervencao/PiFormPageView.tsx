"use client";

import Link from "next/link";
import { useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { formatDate } from "@/lib/utils/formatters";
import { getStageDisplayClassification } from "@/modules/dashboard/programacao-normalizada";

import { downloadPiDocument, PiRequestError, triggerBlobDownload } from "./api";
import { PiExecutionPlan } from "./components/PiExecutionPlan";
import { PiFormFields } from "./components/PiFormFields";
import { PiComparisonPanel, PiHistoryModal } from "./components/PiSidePanels";
import { PI_CREATION_SOURCE_LABELS, PI_LINK_STATUS_LABELS, PI_STATUS_LABELS } from "./constants";
import styles from "./PermissionInterventionPageView.module.css";
import type { PiCreationSource, PiLinkStatus } from "./types";
import { usePiForm } from "./usePiForm";

/**
 * Formulario da PI.
 *
 * Salvar e emitir sao acoes separadas, como manda a regra do modulo: a PI vive
 * como rascunho e so a emissao cobra os campos obrigatorios do documento e
 * queima numero. Emitir exige passar por "pronta" antes.
 */

export function PiFormPageView({ piId }: { piId: string }) {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const logError = useErrorLogger("permissao-intervencao");

  const pi = usePiForm(accessToken, piId);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  async function handleDownload() {
    if (!accessToken || isDownloading) return;
    setIsDownloading(true);
    try {
      const { blob, fileName } = await downloadPiDocument(accessToken, piId);
      triggerBlobDownload(blob, fileName);
      pi.setFeedback({ type: "success", message: "Documento gerado." });
    } catch (error) {
      logError("Falha ao gerar o documento da PI.", error, { piId });
      pi.setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao gerar o documento.",
        errors: error instanceof PiRequestError ? error.payload.errors : undefined,
      });
    } finally {
      setIsDownloading(false);
    }
  }

  if (!accessToken) return <p className={styles.mutedText}>Sessao invalida.</p>;
  if (pi.isLoading) return <p className={styles.mutedText}>Carregando PI...</p>;
  if (!pi.header) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.feedbackError}>{pi.feedback?.message ?? "PI nao encontrada."}</p>
        <Link href="/permissao-intervencao" className={styles.linkButton}>
          Voltar para a listagem
        </Link>
      </div>
    );
  }

  const header = pi.header;
  const stage = header.linkedStage ? getStageDisplayClassification(header.linkedStage) : null;

  async function runStatus(action: "READY" | "REOPEN" | "ISSUE" | "CANCEL", reason?: string) {
    const ok = await pi.handleStatus(action, reason);
    if (!ok) logError("Falha ao alterar o status da PI.", null, { action, piId });
    return ok;
  }

  return (
    <div className={styles.wrapper}>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3 className={styles.cardTitle}>{header.piCode ?? "PI sem codigo"}</h3>
            <p className={styles.intro}>
              Projeto <strong>{header.projectCode}</strong>
              {header.projectCity ? ` - ${header.projectCity}` : ""} | Data {formatDate(header.workDate)}
              {stage ? ` | ${stage.label}${stage.isHistorical ? " (encerrada)" : ""}` : ""}
            </p>
          </div>
          <div className={styles.actions}>
            <Link href="/permissao-intervencao" className={styles.secondaryButton}>
              Voltar
            </Link>
            <button type="button" className={styles.secondaryButton} onClick={() => setIsHistoryOpen(true)}>
              Historico
            </button>
          </div>
        </div>

        <div className={styles.actions}>
          <span className={styles.badgeOk}>{PI_STATUS_LABELS[header.status]}</span>
          <span className={header.linkStatus === "LINKED" ? styles.badgeOk : styles.badgeWarn}>
            {PI_LINK_STATUS_LABELS[header.linkStatus as PiLinkStatus] ?? header.linkStatus}
          </span>
          <span className={styles.badgeIdle}>
            {PI_CREATION_SOURCE_LABELS[header.creationSource as PiCreationSource] ?? header.creationSource}
          </span>
        </div>

        {/* Aviso da regra do Supervisor. A contagem que vale e a da etapa no
            momento da emissao, medida no servidor; aqui e so orientacao. */}
        {header.linkStatus !== "PENDING" && !pi.form.supervisorPersonId ? (
          <p className={styles.mutedText}>
            O Responsavel pela Intervencao vira obrigatorio se a etapa vinculada tiver mais de{" "}
            {pi.supervisorTeamLimit} equipes.
          </p>
        ) : null}

        {header.linkStatus === "PENDING" ? (
          <p className={styles.warning}>
            PI criada sem Programacao. Aguardando a programacao do projeto {header.projectCode} em{" "}
            {formatDate(header.workDate)}. O vinculo e feito sozinho quando a etapa daquela data existir.
          </p>
        ) : null}

        {pi.feedback ? (
          <div className={pi.feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
            <p className={styles.feedbackMessage}>{pi.feedback.message}</p>
            {pi.feedback.errors?.length ? (
              <ul className={styles.tagList}>
                {pi.feedback.errors.map((item) => (
                  <li key={item.code}>{item.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!pi.isEditable || pi.isSaving || !pi.isDirty}
            onClick={() => void pi.handleSave()}
          >
            {pi.isSaving ? "Salvando..." : "Salvar"}
          </button>

          {header.status === "DRAFT" ? (
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={pi.isSaving || pi.isDirty}
              title={pi.isDirty ? "Salve as alteracoes antes" : undefined}
              onClick={() => void runStatus("READY")}
            >
              Marcar como pronta
            </button>
          ) : null}

          {header.status === "READY" ? (
            <>
              <button type="button" className={styles.secondaryButton} disabled={pi.isSaving} onClick={() => void runStatus("REOPEN")}>
                Voltar para rascunho
              </button>
              <button type="button" className={styles.primaryButton} disabled={pi.isSaving} onClick={() => void runStatus("ISSUE")}>
                Emitir PI
              </button>
            </>
          ) : null}

          {/* O documento so existe depois da emissao: e ele que carrega o
              codigo oficial e o template registrado. Para conferir layout antes
              disso ha o preview em Modelo e Configuracao da PI. */}
          {header.status === "ISSUED" ? (
            <button
              type="button"
              className={styles.primaryButton}
              disabled={isDownloading}
              onClick={() => void handleDownload()}
            >
              {isDownloading ? "Gerando..." : "Baixar PI"}
            </button>
          ) : null}

          {header.status !== "CANCELLED" ? (
            <button type="button" className={styles.secondaryButton} disabled={pi.isSaving} onClick={() => setIsCancelOpen(true)}>
              Cancelar PI
            </button>
          ) : null}
        </div>

        {pi.isDirty ? <p className={styles.mutedText}>Ha alteracoes nao salvas.</p> : null}
      </section>

      <PiComparisonPanel rows={pi.comparison} />

      <PiFormFields
        form={pi.form}
        operationAreas={pi.operationAreas}
        voltageLevels={pi.voltageLevels}
        people={pi.people}
        roleFilter={pi.roleFilter}
        disabled={!pi.isEditable || pi.isSaving}
        emergencyPlan={header.emergencyPlanSnapshot}
        onField={pi.setField}
        onToggle={pi.toggleInList}
      />

      <PiExecutionPlan
        steps={pi.steps}
        teams={pi.teams}
        stepTemplates={pi.stepTemplates}
        disabled={!pi.isEditable || pi.isSaving}
        onChange={pi.setSteps}
      />

      {isHistoryOpen ? (
        <PiHistoryModal accessToken={accessToken} piId={piId} onClose={() => setIsHistoryOpen(false)} />
      ) : null}

      {isCancelOpen ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="Cancelar PI">
          <div className={styles.modal}>
            <header className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Cancelar PI</h3>
            </header>
            <div className={styles.modalBody}>
              <label className={styles.fieldWide}>
                <span>Motivo do cancelamento</span>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                />
              </label>
              <p className={styles.mutedText}>
                PI cancelada nao volta atras e permanece no historico. A data fica livre para uma PI nova.
              </p>
            </div>
            <footer className={styles.modalFooter}>
              <button type="button" className={styles.secondaryButton} onClick={() => setIsCancelOpen(false)}>
                Voltar
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={pi.isSaving || cancelReason.trim().length === 0}
                onClick={async () => {
                  const ok = await runStatus("CANCEL", cancelReason.trim());
                  if (ok) {
                    setIsCancelOpen(false);
                    setCancelReason("");
                  }
                }}
              >
                Confirmar cancelamento
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
