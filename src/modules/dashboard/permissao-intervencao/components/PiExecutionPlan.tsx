"use client";

import styles from "../PermissionInterventionPageView.module.css";
import type { PiExecutionStepRow, PiTeamOption } from "../types";

/**
 * Secao 7: Plano de Execucao.
 *
 * O documento tem 23 linhas fisicas. O teto NAO e travado aqui de proposito: o
 * usuario pode montar o plano com mais linhas enquanto rascunha, e quem recusa
 * e a validacao de emissao, com mensagem explicando o limite. Travar durante a
 * edicao daria erro no meio do trabalho.
 *
 * A ordem e a posicao na lista. Reordenar acontece pelos botoes de subir e
 * descer, e nao por arrastar: o drag-and-drop exigiria dependencia nova e nao
 * funciona por teclado.
 */

const MAX_DOCUMENT_ROWS = 23;

type Props = {
  steps: PiExecutionStepRow[];
  teams: PiTeamOption[];
  stepTemplates: Array<{ code: string; description: string }>;
  disabled: boolean;
  onChange: (steps: PiExecutionStepRow[]) => void;
};

function emptyStep(): PiExecutionStepRow {
  return { workZone: "", teamId: null, teamName: null, activity: "", origin: "MANUAL" };
}

export function PiExecutionPlan({ steps, teams, stepTemplates, disabled, onChange }: Props) {
  function update(index: number, patch: Partial<PiExecutionStepRow>) {
    onChange(steps.map((step, position) => (position === index ? { ...step, ...patch } : step)));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function remove(index: number) {
    onChange(steps.filter((_, position) => position !== index));
  }

  function addTemplateSteps() {
    onChange([
      ...steps,
      ...stepTemplates.map<PiExecutionStepRow>((template) => ({
        workZone: "",
        teamId: null,
        teamName: null,
        activity: template.description,
        origin: "TEMPLATE",
      })),
    ]);
  }

  const overflow = steps.length > MAX_DOCUMENT_ROWS;

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>7. Plano de Execucao</h3>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={disabled || stepTemplates.length === 0}
            onClick={addTemplateSteps}
            title={stepTemplates.length === 0 ? "Nenhuma etapa padrao cadastrada" : undefined}
          >
            Adicionar etapas padrao
          </button>
          <button type="button" className={styles.primaryButton} disabled={disabled} onClick={() => onChange([...steps, emptyStep()])}>
            + Etapa
          </button>
        </div>
      </div>

      {overflow ? (
        <p className={styles.warning}>
          O plano tem {steps.length} etapas e o documento comporta {MAX_DOCUMENT_ROWS}. Da para continuar salvando o
          rascunho, mas a emissao fica bloqueada ate reduzir.
        </p>
      ) : null}

      {steps.length === 0 ? <p className={styles.mutedText}>Nenhuma etapa. O Plano de Execucao precisa de ao menos uma para emitir.</p> : null}

      {steps.length > 0 ? (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ordem</th>
                <th>Zona / Area de Trabalho</th>
                <th>Equipe</th>
                <th>Atividade prevista</th>
                <th>Origem</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step, index) => (
                <tr key={`${index}-${step.id ?? "novo"}`} className={index >= MAX_DOCUMENT_ROWS ? styles.rowDisabled : undefined}>
                  <td>{String(index + 1).padStart(2, "0")}</td>
                  <td>
                    <input
                      className={styles.input}
                      value={step.workZone ?? ""}
                      disabled={disabled}
                      onChange={(event) => update(index, { workZone: event.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className={styles.input}
                      value={step.teamId ?? ""}
                      disabled={disabled}
                      onChange={(event) => {
                        const teamId = event.target.value || null;
                        update(index, {
                          teamId,
                          teamName: teams.find((team) => team.id === teamId)?.name ?? null,
                        });
                      }}
                    >
                      <option value="">Nao informada</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className={styles.input}
                      value={step.activity ?? ""}
                      disabled={disabled}
                      onChange={(event) => update(index, { activity: event.target.value })}
                    />
                  </td>
                  <td>
                    <span className={styles.badgeIdle}>{step.origin}</span>
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.linkButton} disabled={disabled || index === 0} onClick={() => move(index, -1)}>
                        Subir
                      </button>
                      <button
                        type="button"
                        className={styles.linkButton}
                        disabled={disabled || index === steps.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        Descer
                      </button>
                      <button type="button" className={styles.linkButton} disabled={disabled} onClick={() => remove(index)}>
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
