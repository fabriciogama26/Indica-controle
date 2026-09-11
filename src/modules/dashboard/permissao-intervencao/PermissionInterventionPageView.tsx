"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Pagination } from "@/components/ui/Pagination";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { formatDate, formatDateTime } from "@/lib/utils/formatters";
import { getStageDisplayClassification } from "@/modules/dashboard/programacao-normalizada";

import { fetchPiList, fetchPiMeta } from "./api";
import { NewPiModal } from "./components/NewPiModal";
import {
  EMPTY_PI_FILTERS,
  PI_CREATION_SOURCE_LABELS,
  PI_LINK_STATUS_LABELS,
  PI_PAGE_SIZE,
  PI_STATUS_LABELS,
} from "./constants";
import styles from "./PermissionInterventionPageView.module.css";
import type {
  PiCatalogOption,
  PiListFilterState,
  PiListItem,
  PiProjectOption,
  PiReadiness,
} from "./types";

/**
 * Tela da Permissao de Intervencao: listagem e criacao.
 *
 * O formulario completo da PI e o passo seguinte. Esta entrega cobre ver as
 * PIs, filtrar e criar nos dois caminhos.
 */

type Feedback = { type: "success" | "error"; message: string };

/** Rotulo da etapa vinculada, sempre pela fonte unica da Programacao. */
function stageLabel(item: PiListItem): string {
  if (!item.linkedStage) return "-";
  const classification = getStageDisplayClassification(item.linkedStage);
  return classification.isHistorical ? `${classification.label} (encerrada)` : classification.label;
}

function linkStatusClass(status: PiListItem["linkStatus"]): string {
  if (status === "LINKED") return styles.badgeOk;
  if (status === "ATTENTION") return styles.badgeWarn;
  return styles.badgeIdle;
}

export function PermissionInterventionPageView() {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? null;
  const logError = useErrorLogger("permissao-intervencao");

  const [filters, setFilters] = useState<PiListFilterState>(EMPTY_PI_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<PiListFilterState>(EMPTY_PI_FILTERS);
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<PiListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const [projects, setProjects] = useState<PiProjectOption[]>([]);
  const [operationAreas, setOperationAreas] = useState<PiCatalogOption[]>([]);
  const [voltageLevels, setVoltageLevels] = useState<PiCatalogOption[]>([]);
  const [readiness, setReadiness] = useState<PiReadiness | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const loadMeta = useCallback(async () => {
    if (!accessToken) return;
    try {
      const meta = await fetchPiMeta(accessToken);
      setProjects(meta.projects ?? []);
      setOperationAreas(meta.operationAreas ?? []);
      setVoltageLevels(meta.voltageLevels ?? []);
      setReadiness(meta.readiness ?? null);
    } catch (error) {
      logError("Falha ao carregar os catalogos da PI.", error, { step: "load-meta" });
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar catalogos." });
    }
  }, [accessToken, logError]);

  const loadList = useCallback(async () => {
    if (!accessToken) return;
    setIsLoading(true);
    try {
      const data = await fetchPiList(accessToken, appliedFilters, page, PI_PAGE_SIZE);
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (error) {
      logError("Falha ao carregar as Permissoes de Intervencao.", error, { step: "load-list" });
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar a lista." });
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, appliedFilters, logError, page]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const totalPages = Math.max(1, Math.ceil(total / PI_PAGE_SIZE));

  /** Avisos de configuracao, para o usuario nao descobrir a pendencia so na emissao. */
  const readinessWarnings = useMemo(() => {
    if (!readiness) return [];
    const warnings: string[] = [];
    if (!readiness.hasSettings) warnings.push("Configuracao da PI nao definida para este contrato.");
    if (!readiness.hasEmergencyPlan) warnings.push("Plano de Emergencia nao configurado. A emissao ficara bloqueada.");
    if (!readiness.hasActiveTemplate) {
      warnings.push("Nenhum template ativo. Ative uma versao em Cadastro Base > Modelo de PI.");
    }
    if (!readiness.hasStepTemplates) warnings.push("Nenhuma etapa padrao cadastrada para o Plano de Execucao.");
    return warnings;
  }, [readiness]);

  function applyFilters() {
    setPage(1);
    setAppliedFilters(filters);
  }

  function clearFilters() {
    setFilters(EMPTY_PI_FILTERS);
    setAppliedFilters(EMPTY_PI_FILTERS);
    setPage(1);
  }

  return (
    <div className={styles.wrapper}>
      {readinessWarnings.length > 0 ? (
        <section className={styles.warning}>
          <strong>Pendencias de configuracao</strong>
          <ul className={styles.tagList}>
            {readinessWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Permissoes de Intervencao</h3>
          <button type="button" className={styles.primaryButton} onClick={() => setIsModalOpen(true)} disabled={!accessToken}>
            + Nova PI
          </button>
        </div>

        <div className={styles.filterGrid}>
          <label className={styles.field}>
            <span>Busca</span>
            <input
              className={styles.input}
              placeholder="Codigo da PI ou do projeto"
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyFilters();
              }}
            />
          </label>

          <label className={styles.field}>
            <span>Status</span>
            <select
              className={styles.input}
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="">Todos</option>
              {Object.entries(PI_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Vinculo</span>
            <select
              className={styles.input}
              value={filters.linkStatus}
              onChange={(event) => setFilters((current) => ({ ...current, linkStatus: event.target.value }))}
            >
              <option value="">Todos</option>
              {Object.entries(PI_LINK_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Area</span>
            <select
              className={styles.input}
              value={filters.operationArea}
              onChange={(event) => setFilters((current) => ({ ...current, operationArea: event.target.value }))}
            >
              <option value="">Todas</option>
              {operationAreas.map((area) => (
                <option key={area.code} value={area.code}>
                  {area.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Tensao</span>
            <select
              className={styles.input}
              value={filters.voltageLevel}
              onChange={(event) => setFilters((current) => ({ ...current, voltageLevel: event.target.value }))}
            >
              <option value="">Todas</option>
              {voltageLevels.map((level) => (
                <option key={level.code} value={level.code}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Data inicial</span>
            <input
              type="date"
              className={styles.input}
              value={filters.dateFrom}
              onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
            />
          </label>

          <label className={styles.field}>
            <span>Data final</span>
            <input
              type="date"
              className={styles.input}
              value={filters.dateTo}
              onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
            />
          </label>

          <div className={styles.filterActions}>
            <button type="button" className={styles.primaryButton} onClick={applyFilters} disabled={isLoading}>
              Filtrar
            </button>
            <button type="button" className={styles.secondaryButton} onClick={clearFilters} disabled={isLoading}>
              Limpar
            </button>
          </div>
        </div>

        {feedback ? (
          <p className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>
            {feedback.message}
          </p>
        ) : null}
      </section>

      <section className={styles.card}>
        {isLoading ? <p className={styles.mutedText}>Carregando...</p> : null}
        {!isLoading && items.length === 0 ? (
          <p className={styles.mutedText}>Nenhuma PI encontrada com os filtros atuais.</p>
        ) : null}

        {items.length > 0 ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Codigo PI</th>
                  <th>Projeto</th>
                  <th>Data</th>
                  <th>Etapa</th>
                  <th>Origem</th>
                  <th>Vinculo</th>
                  <th>Status</th>
                  <th>Area</th>
                  <th>Tensao</th>
                  <th>Responsavel</th>
                  <th>Encarregado</th>
                  <th>Criada em</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.piCode ?? <span className={styles.mutedText}>sem codigo</span>}</td>
                    <td>
                      <strong>{item.projectCode}</strong>
                      {item.projectCity ? <div className={styles.mutedText}>{item.projectCity}</div> : null}
                    </td>
                    <td>{formatDate(item.workDate)}</td>
                    <td>{stageLabel(item)}</td>
                    <td>{PI_CREATION_SOURCE_LABELS[item.creationSource]}</td>
                    <td>
                      <span className={linkStatusClass(item.linkStatus)}>{PI_LINK_STATUS_LABELS[item.linkStatus]}</span>
                    </td>
                    <td>{PI_STATUS_LABELS[item.status]}</td>
                    <td>{item.operationAreaCodes.join(", ") || "-"}</td>
                    <td>{item.voltageLevelCodes.join(", ") || "-"}</td>
                    <td>{item.supervisorName ?? "-"}</td>
                    <td>{item.foremanName ?? "-"}</td>
                    <td>{formatDateTime(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {total > 0 ? (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            disabled={isLoading}
            onPrev={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() => setPage((current) => Math.min(totalPages, current + 1))}
          />
        ) : null}
      </section>

      {isModalOpen && accessToken ? (
        <NewPiModal
          accessToken={accessToken}
          projects={projects}
          onClose={() => setIsModalOpen(false)}
          onCreated={(_piId, message) => {
            setIsModalOpen(false);
            setFeedback({ type: "success", message });
            void loadList();
          }}
          onError={(message) => setFeedback({ type: "error", message })}
        />
      ) : null}
    </div>
  );
}
