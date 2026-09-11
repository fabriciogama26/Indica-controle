"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getStageDisplayClassification } from "@/modules/dashboard/programacao-normalizada";
import { formatDate } from "@/lib/utils/formatters";

import { createPi, fetchProgrammingStages, PiRequestError } from "../api";
import styles from "../PermissionInterventionPageView.module.css";
import type { PiProjectOption, PiStageOption } from "../types";

/**
 * Fluxo `Nova PI`, em dois passos.
 *
 * Passo 1 escolhe o projeto. Passo 2 escolhe COMO criar: a partir de uma etapa
 * da Programacao, herdando os campos dela, ou sem Programacao, informando a
 * data a mao.
 *
 * O rotulo de cada etapa vem de `getStageDisplayClassification`, da fachada da
 * Programacao. Nao e reimplementado aqui: a classificacao tem duas fontes (a
 * atual e a historica da etapa encerrada) e escolher caso a caso e como lista,
 * plano e export ja divergiram antes.
 */

type Props = {
  accessToken: string;
  projects: PiProjectOption[];
  onClose: () => void;
  onCreated: (piId: string, message: string) => void;
  onError: (message: string) => void;
};

type Mode = "CHOOSE" | "FROM_PROGRAMMING" | "MANUAL";

const MAX_SUGGESTIONS = 30;

export function NewPiModal({ accessToken, projects, onClose, onCreated, onError }: Props) {
  const [search, setSearch] = useState("");
  const [project, setProject] = useState<PiProjectOption | null>(null);
  const [mode, setMode] = useState<Mode>("CHOOSE");

  const [stages, setStages] = useState<PiStageOption[]>([]);
  const [isLoadingStages, setIsLoadingStages] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  const [manualDate, setManualDate] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const suggestions = useMemo(() => {
    const term = search.trim().toUpperCase();
    if (!term) return projects.slice(0, MAX_SUGGESTIONS);
    return projects
      .filter((item) => item.code.toUpperCase().includes(term) || item.city.toUpperCase().includes(term))
      .slice(0, MAX_SUGGESTIONS);
  }, [projects, search]);

  const loadStages = useCallback(
    async (projectId: string) => {
      setIsLoadingStages(true);
      try {
        setStages(await fetchProgrammingStages(accessToken, projectId));
      } catch (error) {
        onError(error instanceof Error ? error.message : "Falha ao carregar as etapas.");
        setStages([]);
      } finally {
        setIsLoadingStages(false);
      }
    },
    [accessToken, onError],
  );

  useEffect(() => {
    if (mode === "FROM_PROGRAMMING" && project) void loadStages(project.id);
  }, [loadStages, mode, project]);

  const selectedStage = stages.find((stage) => stage.programmingId === selectedStageId) ?? null;

  async function handleCreate() {
    if (!project || isSaving) return;

    const workDate = mode === "MANUAL" ? manualDate : selectedStage?.executionDate ?? "";
    if (!workDate) {
      onError("Informe a data da etapa.");
      return;
    }

    setIsSaving(true);
    try {
      const result = await createPi(accessToken, {
        projectId: project.id,
        workDate,
        creationSource: mode === "MANUAL" ? "MANUAL" : "FROM_PROGRAMMING",
        // Campos herdados da etapa. Nascem preenchidos e continuam editaveis na
        // PI; alterar a PI depois nao mexe na Programacao.
        inherited: selectedStage
          ? {
              feeder: selectedStage.feeder,
              installationDescription: selectedStage.serviceDescription,
              startTime: selectedStage.startTime,
              endTime: selectedStage.endTime,
              activityDescription: selectedStage.activities
                .map((activity) => [activity.code, activity.description].filter(Boolean).join(" - "))
                .join("\n"),
            }
          : undefined,
      });
      onCreated(result.piId ?? "", result.message ?? "PI criada com sucesso.");
    } catch (error) {
      const message =
        error instanceof PiRequestError ? error.message : error instanceof Error ? error.message : "Falha ao criar a PI.";
      onError(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-label="Nova PI">
      <div className={styles.modal}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Nova Permissao de Intervencao</h3>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Fechar">
            x
          </button>
        </header>

        <div className={styles.modalBody}>
          <section className={styles.step}>
            <span className={styles.stepLabel}>1. Projeto / Nota</span>
            {project ? (
              <div className={styles.selectedProject}>
                <strong>{project.code}</strong>
                <span className={styles.mutedText}>{[project.city, project.address].filter(Boolean).join(" - ")}</span>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => {
                    setProject(null);
                    setMode("CHOOSE");
                    setStages([]);
                    setSelectedStageId(null);
                  }}
                >
                  Trocar
                </button>
              </div>
            ) : (
              <>
                <input
                  className={styles.input}
                  placeholder="Pesquisar projeto por codigo ou municipio..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  autoFocus
                />
                <ul className={styles.suggestionList}>
                  {suggestions.map((item) => (
                    <li key={item.id}>
                      <button type="button" className={styles.suggestion} onClick={() => setProject(item)}>
                        <strong>{item.code}</strong>
                        <span className={styles.mutedText}>{[item.city, item.address].filter(Boolean).join(" - ")}</span>
                      </button>
                    </li>
                  ))}
                  {suggestions.length === 0 ? <li className={styles.mutedText}>Nenhum projeto encontrado.</li> : null}
                </ul>
              </>
            )}
          </section>

          {project ? (
            <section className={styles.step}>
              <span className={styles.stepLabel}>2. Como criar</span>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={mode === "FROM_PROGRAMMING" ? styles.primaryButton : styles.secondaryButton}
                  onClick={() => setMode("FROM_PROGRAMMING")}
                >
                  A partir da Programacao
                </button>
                <button
                  type="button"
                  className={mode === "MANUAL" ? styles.primaryButton : styles.secondaryButton}
                  onClick={() => setMode("MANUAL")}
                >
                  Sem Programacao
                </button>
              </div>
            </section>
          ) : null}

          {project && mode === "FROM_PROGRAMMING" ? (
            <section className={styles.step}>
              <span className={styles.stepLabel}>3. Etapa</span>
              {isLoadingStages ? <p className={styles.mutedText}>Carregando etapas...</p> : null}
              {!isLoadingStages && stages.length === 0 ? (
                <p className={styles.warning}>
                  Este projeto nao tem nenhuma etapa na Programacao. Use <strong>Sem Programacao</strong> e a PI sera
                  vinculada sozinha quando a etapa daquela data for criada.
                </p>
              ) : null}

              {stages.length > 0 ? (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th />
                        <th>Data</th>
                        <th>Etapa</th>
                        <th>Equipes</th>
                        <th>Encarregados</th>
                        <th>PI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stages.map((stage) => {
                        const classification = getStageDisplayClassification(stage.classification);
                        const blocked = Boolean(stage.existingPiId);
                        return (
                          <tr key={stage.programmingId} className={blocked ? styles.rowDisabled : undefined}>
                            <td>
                              <input
                                type="radio"
                                name="stage"
                                checked={selectedStageId === stage.programmingId}
                                disabled={blocked}
                                onChange={() => setSelectedStageId(stage.programmingId)}
                              />
                            </td>
                            <td>{stage.executionDate ? formatDate(stage.executionDate) : "Em espera"}</td>
                            <td>
                              {classification.label}
                              {classification.isHistorical ? <span className={styles.badgeIdle}>encerrada</span> : null}
                            </td>
                            <td>{stage.teams.map((team) => team.teamName).join(", ") || "-"}</td>
                            <td>
                              {stage.teams
                                .map((team) => team.foremanName)
                                .filter(Boolean)
                                .join(", ") || "-"}
                            </td>
                            <td>{stage.existingPiCode ?? (blocked ? "ja possui" : "-")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          ) : null}

          {project && mode === "MANUAL" ? (
            <section className={styles.step}>
              <span className={styles.stepLabel}>3. Data da etapa</span>
              <input
                type="date"
                className={styles.input}
                value={manualDate}
                onChange={(event) => setManualDate(event.target.value)}
              />
              <p className={styles.mutedText}>
                A PI nasce pendente. Se ja existir etapa ativa nesta data, o vinculo e feito na hora de salvar.
              </p>
            </section>
          ) : null}
        </div>

        <footer className={styles.modalFooter}>
          <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={isSaving}>
            Cancelar
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={
              isSaving ||
              !project ||
              (mode === "FROM_PROGRAMMING" && !selectedStage) ||
              (mode === "MANUAL" && !manualDate) ||
              mode === "CHOOSE"
            }
            onClick={() => void handleCreate()}
          >
            {isSaving ? "Criando..." : "Criar PI"}
          </button>
        </footer>
      </div>
    </div>
  );
}
