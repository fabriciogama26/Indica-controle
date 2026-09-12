"use client";

import styles from "../TeamCompositionPageView.module.css";
import type { CompositionItem } from "../types";

type MeasurementProjectModalProps = {
  composition: CompositionItem | null;
  isNavigating: boolean;
  onSelect: (projectId: string) => void;
  onClose: () => void;
};

// A composicao pode carregar mais de um projeto (migration 266). Antes, o botao
// "Fazer medicao" abria o projeto principal em silencio e os demais ficavam sem
// caminho pela tela; aqui a escolha e explicita, com indicacao de quais projetos
// ja tem medicao registrada naquele contexto de Projeto + Equipe + Data.
export function MeasurementProjectModal({
  composition,
  isNavigating,
  onSelect,
  onClose,
}: MeasurementProjectModalProps) {
  if (!composition) return null;

  const projects = composition.projects ?? [];

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <article
        className={styles.modalCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="composicao-medicao-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div className={styles.modalTitleBlock}>
            <h4 id="composicao-medicao-title">Selecione a obra para medir</h4>
            <p className={styles.modalSubtitle}>
              {composition.teamName} | {composition.compositionDate.split("-").reverse().join("/")}
            </p>
          </div>
          <button type="button" className={styles.modalCloseButton} onClick={onClose} disabled={isNavigating}>
            Fechar
          </button>
        </header>
        <div className={styles.modalBody}>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Projeto</th>
                  <th>Centro de Servico</th>
                  <th>Medicao</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>{project.code}</td>
                    <td>{project.serviceCenter || "-"}</td>
                    <td>{project.hasMeasurement ? "Ja registrada" : "Sem medicao"}</td>
                    <td>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => onSelect(project.id)}
                        disabled={isNavigating}
                      >
                        {project.hasMeasurement ? "Abrir mesmo assim" : "Fazer medicao"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </article>
    </div>
  );
}
