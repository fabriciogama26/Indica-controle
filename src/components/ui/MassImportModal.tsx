"use client";

import type { MassImportController } from "@/hooks/useMassImport";
import styles from "./MassImportModal.module.css";

type MassImportModalProps = {
  controller: MassImportController;
  /** Rotulo no plural do registro importado ("cargos", "equipes", "atividades"). */
  entityLabel: string;
  /** Texto da etapa 2, descrevendo as colunas obrigatorias do arquivo. */
  columnsHint: string;
};

const RESULT_TITLES = {
  success: "Incluido com sucesso.",
  partial: "Importacao parcial.",
  error: "Importacao com erros.",
} as const;

export function MassImportModal({ controller, entityLabel, columnsHint }: MassImportModalProps) {
  if (!controller.isOpen) {
    return null;
  }

  const { result } = controller;

  return (
    <div className={styles.overlay} onClick={controller.close}>
      <article className={styles.card} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <h4>Cadastro em massa</h4>
            <p className={styles.subtitle}>Importe um CSV para cadastrar {entityLabel} em lote.</p>
          </div>
          <button type="button" className={styles.closeButton} onClick={controller.close}>
            Fechar
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.step}>
            <div className={styles.stepHeader}>
              <span className={styles.stepNumber}>1</span>
              <div>
                <strong>Baixe o modelo</strong>
                <p>Use o arquivo modelo com as colunas obrigatorias.</p>
              </div>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={controller.downloadTemplate}>
              Baixar modelo CSV
            </button>
          </section>

          <section className={styles.step}>
            <div className={styles.stepHeader}>
              <span className={styles.stepNumber}>2</span>
              <div>
                <strong>Preencha a planilha</strong>
                <p>{columnsHint}</p>
              </div>
            </div>
          </section>

          <section className={styles.step}>
            <div className={styles.stepHeader}>
              <span className={styles.stepNumber}>3</span>
              <div>
                <strong>Envie o arquivo</strong>
                <p>Somente arquivo CSV separado por ponto e virgula.</p>
              </div>
            </div>
            <label className={styles.dropzone}>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => controller.selectFile(event.target.files?.[0] ?? null)}
              />
              <span>{controller.file ? controller.file.name : "Clique para selecionar o arquivo CSV"}</span>
            </label>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void controller.run()}
                disabled={!controller.file || controller.isImporting}
              >
                {controller.isImporting ? "Importando..." : "Importar planilha"}
              </button>
              {controller.errorReport ? (
                <button type="button" className={styles.secondaryButton} onClick={controller.downloadErrorReport}>
                  Baixar erros (CSV)
                </button>
              ) : null}
            </div>
            {result ? (
              <div className={result.status === "error" ? styles.feedbackError : styles.feedbackSuccess}>
                <strong>{RESULT_TITLES[result.status]}</strong>
                <div>
                  {result.successCount} {entityLabel} salvos.
                </div>
                {result.errorRows > 0 ? <div>{result.errorRows} linhas com erro.</div> : null}
                <div>{result.message}</div>
              </div>
            ) : null}
          </section>
        </div>
      </article>
    </div>
  );
}
