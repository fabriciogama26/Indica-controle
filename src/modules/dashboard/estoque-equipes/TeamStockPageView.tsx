"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { Pagination } from "@/components/ui/Pagination";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { usePagination } from "@/hooks/usePagination";
import {
  EXPORT_COOLDOWN_MS,
  EXPORT_PAGE_SIZE,
  HISTORY_PAGE_SIZE,
  INITIAL_FILTERS,
  PAGE_SIZE,
} from "./constants";
import type {
  TeamOption,
  TeamStockFilters,
  TeamStockHistoryEntry,
  TeamStockHistoryResponse,
  TeamStockItem,
  TeamStockMetaResponse,
  TeamStockResponse,
} from "./types";
import {
  buildTeamStockQuery,
  buildCsvContent,
  downloadCsvFile,
  formatDateTime,
  formatDecimal,
  formatSignedDecimal,
} from "./utils";
import styles from "./TeamStockPageView.module.css";

function operationLabel(value: string) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "REQUISITION") return "Requisicao";
  if (normalized === "RETURN") return "Devolucao";
  if (normalized === "FIELD_RETURN") return "Retorno de campo";
  if (normalized === "ENTRY") return "Entrada";
  if (normalized === "EXIT") return "Saida";
  if (normalized === "TRANSFER") return "Transferencia";
  return normalized || "-";
}

export function TeamStockPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("estoque_equipes");
  const accessToken = session?.accessToken ?? null;

  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [foremen, setForemen] = useState<string[]>([]);
  const [serviceCenters, setServiceCenters] = useState<string[]>([]);
  const [filterDraft, setFilterDraft] = useState<TeamStockFilters>(INITIAL_FILTERS);
  const [filters, setFilters] = useState<TeamStockFilters>(INITIAL_FILTERS);
  const [items, setItems] = useState<TeamStockItem[]>([]);
  const [summary, setSummary] = useState({ teamsWithStock: 0, distinctMaterials: 0, totalRows: 0 });
  const [summaryByUnit, setSummaryByUnit] = useState<Array<{ unit: string; balanceQuantity: number }>>([]);
  const { page, total, totalPages, setPage, setTotal } = usePagination({ pageSize: PAGE_SIZE });
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportCooldownActive, setIsExportCooldownActive] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [detailItem, setDetailItem] = useState<TeamStockItem | null>(null);
  const [historyItem, setHistoryItem] = useState<TeamStockItem | null>(null);
  const [history, setHistory] = useState<TeamStockHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const materialTypes = useMemo(
    () => Array.from(new Set(items.map((item) => item.materialType).filter(Boolean))).sort(),
    [items],
  );
  const units = useMemo(
    () => Array.from(new Set([...summaryByUnit.map((item) => item.unit), ...items.map((item) => item.unit)].filter(Boolean))).sort(),
    [items, summaryByUnit],
  );

  useEffect(() => {
    if (!accessToken) return;

    let mounted = true;
    async function loadMeta() {
      try {
        const response = await fetch("/api/team-stock-balance?mode=meta", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = (await response.json().catch(() => ({}))) as TeamStockMetaResponse;
        if (!response.ok) throw new Error(payload.message ?? "Falha ao carregar filtros do estoque das equipes.");
        if (mounted) {
          setTeams(payload.teams ?? []);
          setForemen(payload.foremen ?? []);
          setServiceCenters(payload.serviceCenters ?? []);
        }
      } catch (error) {
        if (mounted) setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar filtros." });
        await logError("Falha ao carregar metadados do estoque das equipes.", error);
      }
    }
    void loadMeta();
    return () => {
      mounted = false;
    };
  }, [accessToken, logError]);

  useEffect(() => {
    if (!accessToken) return;

    let mounted = true;
    async function loadList() {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/team-stock-balance?${buildTeamStockQuery(filters, page, PAGE_SIZE)}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = (await response.json().catch(() => ({}))) as TeamStockResponse;
        if (!response.ok) throw new Error(payload.message ?? "Falha ao carregar o estoque das equipes.");
        if (mounted) {
          setItems(payload.items ?? []);
          setSummary(payload.summary ?? { teamsWithStock: 0, distinctMaterials: 0, totalRows: 0 });
          setSummaryByUnit(payload.summaryByUnit ?? []);
          setTotal(payload.pagination?.total ?? 0);
          setFeedback(null);
        }
      } catch (error) {
        if (mounted) {
          setItems([]);
          setTotal(0);
          setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar o estoque das equipes." });
        }
        await logError("Falha ao carregar a lista do estoque das equipes.", error, { filters, page });
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    void loadList();
    return () => {
      mounted = false;
    };
  }, [accessToken, filters, logError, page, setTotal]);

  useEffect(() => {
    if (!accessToken || !historyItem) return;

    let mounted = true;
    const selectedHistoryItem = historyItem;
    async function loadHistory() {
      setIsLoadingHistory(true);
      const params = new URLSearchParams({
        mode: "history",
        teamId: selectedHistoryItem.teamId,
        materialId: selectedHistoryItem.materialId,
        page: String(historyPage),
        pageSize: String(HISTORY_PAGE_SIZE),
      });

      try {
        const response = await fetch(`/api/team-stock-balance?${params.toString()}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = (await response.json().catch(() => ({}))) as TeamStockHistoryResponse;
        if (!response.ok) throw new Error(payload.message ?? "Falha ao carregar o historico.");
        if (mounted) {
          setHistory(payload.history ?? []);
          setHistoryTotal(payload.pagination?.total ?? 0);
        }
      } catch (error) {
        if (mounted) {
          setHistory([]);
          setHistoryTotal(0);
          setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar o historico." });
        }
        await logError("Falha ao carregar historico do estoque da equipe.", error, {
          teamId: selectedHistoryItem.teamId,
          materialId: selectedHistoryItem.materialId,
        });
      } finally {
        if (mounted) setIsLoadingHistory(false);
      }
    }
    void loadHistory();
    return () => {
      mounted = false;
    };
  }, [accessToken, historyItem, historyPage, logError]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setFilters(filterDraft);
  }

  function clearFilters() {
    setFilterDraft(INITIAL_FILTERS);
    setFilters(INITIAL_FILTERS);
    setPage(1);
  }

  async function exportCsv() {
    if (!accessToken || isExporting || isExportCooldownActive) return;
    setIsExporting(true);
    setIsExportCooldownActive(true);
    window.setTimeout(() => setIsExportCooldownActive(false), EXPORT_COOLDOWN_MS);

    try {
      const exportedItems: TeamStockItem[] = [];
      let exportPage = 1;
      let exportTotal = 0;

      do {
        const response = await fetch(
          `/api/team-stock-balance?${buildTeamStockQuery(filters, exportPage, EXPORT_PAGE_SIZE)}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await response.json().catch(() => ({}))) as TeamStockResponse;
        if (!response.ok) throw new Error(payload.message ?? "Falha ao exportar o estoque das equipes.");
        exportedItems.push(...(payload.items ?? []));
        exportTotal = payload.pagination?.total ?? 0;
        exportPage += 1;
      } while (exportedItems.length < exportTotal);

      const headers = ["Equipe", "Status equipe", "Encarregado", "Base", "Material", "Descricao", "UMB", "Tipo", "Saldo", "Ultima movimentacao"];
      const rows = exportedItems.map((item) => [
        item.teamName,
        item.teamIsActive ? "Ativa" : "Inativa",
        item.foremanName,
        item.serviceCenterName,
        item.materialCode,
        item.description,
        item.unit,
        item.materialType,
        String(item.balanceQuantity).replace(".", ","),
        formatDateTime(item.lastMovementAt),
      ]);
      downloadCsvFile(buildCsvContent(headers, rows), "estoque-equipes.csv");
      setFeedback({ type: "success", message: "Estoque das equipes exportado." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao exportar." });
      await logError("Falha ao exportar estoque das equipes.", error, { filters });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Filtros do Estoque das Equipes</h3>
        <form className={styles.filterGrid} onSubmit={applyFilters}>
          <label className={styles.field}>
            <span>Equipe</span>
            <select value={filterDraft.teamId} onChange={(event) => setFilterDraft((current) => ({ ...current, teamId: event.target.value }))}>
              <option value="">Todas</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}{team.isActive ? "" : " (Inativa)"}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Encarregado</span>
            <select value={filterDraft.foreman} onChange={(event) => setFilterDraft((current) => ({ ...current, foreman: event.target.value }))}>
              <option value="">Todos</option>
              {foremen.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Base</span>
            <select value={filterDraft.serviceCenter} onChange={(event) => setFilterDraft((current) => ({ ...current, serviceCenter: event.target.value }))}>
              <option value="">Todas</option>
              {serviceCenters.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Status da equipe</span>
            <select value={filterDraft.teamStatus} onChange={(event) => setFilterDraft((current) => ({ ...current, teamStatus: event.target.value as TeamStockFilters["teamStatus"] }))}>
              <option value="ATIVAS">Ativas</option>
              <option value="INATIVAS">Inativas</option>
              <option value="TODAS">Todas</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Material</span>
            <input value={filterDraft.materialCode} onChange={(event) => setFilterDraft((current) => ({ ...current, materialCode: event.target.value }))} />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Descricao</span>
            <input value={filterDraft.description} onChange={(event) => setFilterDraft((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <label className={styles.field}>
            <span>Tipo</span>
            <input list="team-stock-material-types" value={filterDraft.materialType} onChange={(event) => setFilterDraft((current) => ({ ...current, materialType: event.target.value }))} />
            <datalist id="team-stock-material-types">{materialTypes.map((value) => <option key={value} value={value} />)}</datalist>
          </label>
          <label className={styles.field}>
            <span>UMB</span>
            <input list="team-stock-units" value={filterDraft.unit} onChange={(event) => setFilterDraft((current) => ({ ...current, unit: event.target.value }))} />
            <datalist id="team-stock-units">{units.map((value) => <option key={value} value={value} />)}</datalist>
          </label>
          <label className={styles.field}>
            <span>Saldo minimo</span>
            <input inputMode="decimal" value={filterDraft.qtyMin} onChange={(event) => setFilterDraft((current) => ({ ...current, qtyMin: event.target.value }))} />
          </label>
          <label className={styles.field}>
            <span>Saldo maximo</span>
            <input inputMode="decimal" value={filterDraft.qtyMax} onChange={(event) => setFilterDraft((current) => ({ ...current, qtyMax: event.target.value }))} />
          </label>
          <label className={styles.checkboxField}>
            <input type="checkbox" checked={filterDraft.includeZero} onChange={(event) => setFilterDraft((current) => ({ ...current, includeZero: event.target.checked }))} />
            <span>Exibir saldo zero</span>
          </label>
          <div className={styles.actions}>
            <button className={styles.secondaryButton} type="submit">Aplicar filtros</button>
            <button className={styles.ghostButton} type="button" onClick={clearFilters}>Limpar</button>
          </div>
        </form>
      </section>

      {feedback ? <div className={feedback.type === "error" ? styles.feedbackError : styles.feedbackSuccess}>{feedback.message}</div> : null}

      <section className={styles.statsGrid}>
        <article className={styles.statCard}><span className={styles.statLabel}>Equipes com estoque</span><strong className={styles.statValue}>{summary.teamsWithStock}</strong></article>
        <article className={styles.statCard}><span className={styles.statLabel}>Materiais distintos</span><strong className={styles.statValue}>{summary.distinctMaterials}</strong></article>
        <article className={styles.statCard}><span className={styles.statLabel}>Registros filtrados</span><strong className={styles.statValue}>{summary.totalRows}</strong></article>
        {summaryByUnit.map((item) => <article className={styles.statCard} key={item.unit}><span className={styles.statLabel}>Saldo {item.unit}</span><strong className={styles.statValue}>{formatDecimal(item.balanceQuantity)}</strong></article>)}
      </section>

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <h3 className={styles.cardTitle}>Lista de Estoque das Equipes</h3>
          <CsvExportButton onClick={() => void exportCsv()} disabled={isExporting || isExportCooldownActive || total === 0} isLoading={isExporting} className={styles.secondaryButton} />
        </div>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead><tr><th>Equipe</th><th>Encarregado</th><th>Base</th><th>Material</th><th>Descricao</th><th>UMB</th><th>Tipo</th><th>Saldo</th><th>Ultima movimentacao</th><th>Acoes</th></tr></thead>
            <tbody>
              {isLoading ? <tr><td className={styles.emptyRow} colSpan={10}>Carregando...</td></tr> : null}
              {!isLoading && items.length === 0 ? <tr><td className={styles.emptyRow} colSpan={10}>Nenhum saldo encontrado.</td></tr> : null}
              {!isLoading && items.map((item) => (
                <tr key={`${item.teamId}:${item.materialId}`}>
                  <td>{item.teamName}{item.teamIsActive ? "" : " (Inativa)"}</td><td>{item.foremanName}</td><td>{item.serviceCenterName}</td>
                  <td>{item.materialCode}</td><td>{item.description}</td><td>{item.unit || "-"}</td><td>{item.materialType || "-"}</td>
                  <td className={styles.quantityCell}>{formatDecimal(item.balanceQuantity)}</td><td>{formatDateTime(item.lastMovementAt)}</td>
                  <td><div className={styles.tableActions}>
                    <button type="button" className={`${styles.actionButton} ${styles.actionView}`} title="Detalhes" onClick={() => setDetailItem(item)}><ActionIcon name="details" /></button>
                    <button type="button" className={`${styles.actionButton} ${styles.actionHistory}`} title="Historico" onClick={() => { setHistoryItem(item); setHistoryPage(1); }}><ActionIcon name="history" /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          showTotal={false}
          onPrev={() => setPage((value) => value - 1)}
          onNext={() => setPage((value) => value + 1)}
          disabled={isLoading}
          className={styles.pagination}
          actionsClassName={styles.paginationActions}
          buttonClassName={styles.ghostButton}
        />
      </section>

      {detailItem ? <div className={styles.modalOverlay} role="presentation">
        <div className={styles.modalCard} role="dialog" aria-modal="true">
          <div className={styles.modalHeader}><h4>Detalhes do Estoque da Equipe</h4><button className={styles.modalCloseButton} type="button" onClick={() => setDetailItem(null)}>Fechar</button></div>
          <div className={styles.detailGrid}>
            <div><strong>Equipe:</strong> {detailItem.teamName}</div><div><strong>Status:</strong> {detailItem.teamIsActive ? "Ativa" : "Inativa"}</div>
            <div><strong>Encarregado:</strong> {detailItem.foremanName}</div><div><strong>Base:</strong> {detailItem.serviceCenterName}</div>
            <div><strong>Material:</strong> {detailItem.materialCode}</div><div><strong>Descricao:</strong> {detailItem.description}</div>
            <div><strong>UMB:</strong> {detailItem.unit || "-"}</div><div><strong>Tipo:</strong> {detailItem.materialType || "-"}</div>
            <div><strong>Saldo:</strong> {formatDecimal(detailItem.balanceQuantity)}</div><div><strong>Ultima movimentacao:</strong> {formatDateTime(detailItem.lastMovementAt)}</div>
          </div>
        </div>
      </div> : null}

      {historyItem ? <div className={styles.modalOverlay} role="presentation">
        <div className={styles.modalCard} role="dialog" aria-modal="true">
          <div className={styles.modalHeader}><div><h4>Historico do Estoque da Equipe</h4><p className={styles.modalSubtitle}>{historyItem.teamName} - {historyItem.materialCode}</p></div><button className={styles.modalCloseButton} type="button" onClick={() => setHistoryItem(null)}>Fechar</button></div>
          {isLoadingHistory ? <p>Carregando...</p> : null}
          {!isLoadingHistory && history.length === 0 ? <p>Nenhuma movimentacao encontrada.</p> : null}
          {!isLoadingHistory && history.map((entry) => <article className={styles.historyCard} key={entry.id}>
            <div className={styles.historyCardHeader}><strong>{operationLabel(entry.operationKind)}</strong><span>{formatDateTime(entry.changedAt)}</span></div>
            <div className={styles.historyMeta}>
              <span>Saldo aplicado: <strong className={entry.signedQuantity >= 0 ? styles.historySignedPositive : styles.historySignedNegative}>{formatSignedDecimal(entry.signedQuantity)}</strong></span>
              <span>Projeto: {entry.projectCode}</span><span>Data da operacao: {entry.entryDate}</span>
              {entry.serialNumber ? <span>Serial: {entry.serialNumber}</span> : null}{entry.lotCode ? <span>LP: {entry.lotCode}</span> : null}
              {entry.notes ? <span>Observacoes: {entry.notes}</span> : null}
            </div>
          </article>)}
          <div className={styles.pagination}><span>Pagina {historyPage} de {historyTotalPages}</span><div className={styles.paginationActions}>
            <button className={styles.ghostButton} type="button" disabled={historyPage <= 1 || isLoadingHistory} onClick={() => setHistoryPage((value) => value - 1)}>Anterior</button>
            <button className={styles.ghostButton} type="button" disabled={historyPage >= historyTotalPages || isLoadingHistory} onClick={() => setHistoryPage((value) => value + 1)}>Proxima</button>
          </div></div>
        </div>
      </div> : null}
    </div>
  );
}
