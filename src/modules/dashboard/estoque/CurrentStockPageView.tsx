"use client";

import { FormEvent, useEffect, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { EXPORT_COOLDOWN_MS, EXPORT_PAGE_SIZE, HISTORY_PAGE_SIZE, INITIAL_FILTERS, PAGE_SIZE } from "./constants";
import type {
  CurrentStockFilters,
  CurrentStockHistoryFilters,
  CurrentStockHistoryEntry,
  CurrentStockHistoryResponse,
  CurrentStockListItem,
  CurrentStockListResponse,
  CurrentStockMetaResponse,
  StockCenterOption,
} from "./types";
import {
  buildCurrentStockQuery,
  csvEscape,
  downloadCsvFile,
  formatDateTime,
  formatInteger,
  formatSignedInteger,
  toIsoDate,
} from "./utils";
import styles from "./CurrentStockPageView.module.css";

function movementTypeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "ENTRY") return "Entrada";
  if (normalized === "EXIT") return "Saida";
  if (normalized === "TRANSFER") return "Transferencia";
  if (normalized === "REQUISITION") return "Requisicao";
  if (normalized === "RETURN") return "Devolucao";
  if (normalized === "FIELD_RETURN") return "Retorno de campo";
  return "-";
}

function currentStockHistoryTitle(entry: CurrentStockHistoryEntry) {
  if (entry.isReversal) {
    return "Estorno";
  }
  return movementTypeLabel(entry.operationKind ?? entry.movementType);
}

function currentStockStatusLabel(entry: CurrentStockHistoryEntry) {
  if (entry.isReversal) return "Movimentacao de estorno";
  if (entry.isReversed) return "Movimentacao original estornada";
  return "Movimentacao ativa";
}

export function CurrentStockPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("estoque_atual");
  const accessToken = session?.accessToken ?? null;

  const [stockCenters, setStockCenters] = useState<StockCenterOption[]>([]);
  const [filterDraft, setFilterDraft] = useState<CurrentStockFilters>(INITIAL_FILTERS);
  const [filters, setFilters] = useState<CurrentStockFilters>(INITIAL_FILTERS);
  const [items, setItems] = useState<CurrentStockListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportCooldownActive, setIsExportCooldownActive] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [detailItem, setDetailItem] = useState<CurrentStockListItem | null>(null);
  const [historyItem, setHistoryItem] = useState<CurrentStockListItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<CurrentStockHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyFilterDraft, setHistoryFilterDraft] = useState<CurrentStockHistoryFilters>({
    operationKind: "TODOS",
    originText: "",
  });
  const [historyFilters, setHistoryFilters] = useState<CurrentStockHistoryFilters>({
    operationKind: "TODOS",
    originText: "",
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const pageBalanceTotal = items.reduce((sum, item) => sum + item.balanceQuantity, 0);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let isMounted = true;

    async function loadMeta() {
      setIsLoadingMeta(true);

      try {
        const response = await fetch("/api/stock-balance/meta", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as CurrentStockMetaResponse;
        if (!response.ok) {
          if (isMounted) {
            setFeedback({
              type: "error",
              message: data.message ?? "Falha ao carregar os centros do estoque atual.",
            });
          }

          await logError("Falha ao carregar metadados do estoque atual.", undefined, {
            responseStatus: response.status,
            responseMessage: data.message ?? null,
          });
          return;
        }

        if (isMounted) {
          setFeedback(null);
          setStockCenters(data.stockCenters ?? []);
        }
      } catch (error) {
        if (isMounted) {
          setFeedback({ type: "error", message: "Falha ao carregar os centros do estoque atual." });
        }

        await logError("Falha ao carregar metadados do estoque atual.", error);
      } finally {
        if (isMounted) {
          setIsLoadingMeta(false);
        }
      }
    }

    void loadMeta();

    return () => {
      isMounted = false;
    };
  }, [accessToken, logError]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let isMounted = true;

    async function loadList() {
      setIsLoadingList(true);

      try {
        const response = await fetch(`/api/stock-balance?${buildCurrentStockQuery(filters, page, PAGE_SIZE)}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as CurrentStockListResponse;
        if (!response.ok) {
          if (isMounted) {
            setItems([]);
            setTotal(0);
            setFeedback({
              type: "error",
              message: data.message ?? "Falha ao carregar o estoque atual.",
            });
          }

          await logError("Falha ao carregar a lista do estoque atual.", undefined, {
            responseStatus: response.status,
            responseMessage: data.message ?? null,
            filters,
            page,
          });
          return;
        }

        if (isMounted) {
          setFeedback(null);
          setItems(data.items ?? []);
          setTotal(data.pagination?.total ?? 0);
        }
      } catch (error) {
        if (isMounted) {
          setItems([]);
          setTotal(0);
          setFeedback({ type: "error", message: "Falha ao carregar o estoque atual." });
        }

        await logError("Falha ao carregar a lista do estoque atual.", error, {
          filters,
          page,
        });
      } finally {
        if (isMounted) {
          setIsLoadingList(false);
        }
      }
    }

    void loadList();

    return () => {
      isMounted = false;
    };
  }, [accessToken, filters, logError, page]);

  useEffect(() => {
    if (!historyItem) {
      return;
    }

    void loadHistory(historyItem, 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyFilters]);

  function updateFilterDraft<K extends keyof CurrentStockFilters>(key: K, value: CurrentStockFilters[K]) {
    setFilterDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setPage(1);
    setFilters({ ...filterDraft });
  }

  function handleClearFilters() {
    setFeedback(null);
    setPage(1);
    setFilterDraft(INITIAL_FILTERS);
    setFilters(INITIAL_FILTERS);
  }

  function closeHistoryModal() {
    setHistoryItem(null);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setIsLoadingHistory(false);
    setHistoryFilterDraft({ operationKind: "TODOS", originText: "" });
    setHistoryFilters({ operationKind: "TODOS", originText: "" });
  }

  function handleApplyHistoryFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHistoryPage(1);
    setHistoryFilters({
      operationKind: historyFilterDraft.operationKind,
      originText: historyFilterDraft.originText.trim(),
    });
  }

  function handleClearHistoryFilters() {
    setHistoryPage(1);
    setHistoryFilterDraft({ operationKind: "TODOS", originText: "" });
    setHistoryFilters({ operationKind: "TODOS", originText: "" });
  }

  async function loadHistory(targetItem: CurrentStockListItem, targetPage: number) {
    if (!accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para carregar o historico do estoque atual." });
      return;
    }

    setIsLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      params.set("mode", "history");
      params.set("stockCenterId", targetItem.stockCenterId);
      params.set("materialId", targetItem.materialId);
      params.set("page", String(targetPage));
      params.set("pageSize", String(HISTORY_PAGE_SIZE));
      if (historyFilters.operationKind !== "TODOS") {
        params.set("historyOperationKind", historyFilters.operationKind);
      }
      if (historyFilters.originText) {
        params.set("historyOrigin", historyFilters.originText);
      }

      const response = await fetch(`/api/stock-balance?${params.toString()}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as CurrentStockHistoryResponse;
      if (!response.ok) {
        setFeedback({
          type: "error",
          message: data.message ?? "Falha ao carregar o historico do estoque atual.",
        });
        setHistoryEntries([]);
        setHistoryTotal(0);

        await logError("Falha ao carregar o historico do estoque atual.", undefined, {
          responseStatus: response.status,
          responseMessage: data.message ?? null,
          stockCenterId: targetItem.stockCenterId,
          materialId: targetItem.materialId,
          historyFilters,
          page: targetPage,
        });
        return;
      }

      setHistoryEntries(data.history ?? []);
      setHistoryPage(data.pagination?.page ?? targetPage);
      setHistoryTotal(data.pagination?.total ?? 0);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao carregar o historico do estoque atual." });
      setHistoryEntries([]);
      setHistoryTotal(0);
      await logError("Falha ao carregar o historico do estoque atual.", error, {
        stockCenterId: targetItem.stockCenterId,
        materialId: targetItem.materialId,
        historyFilters,
        page: targetPage,
      });
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function openHistoryModal(targetItem: CurrentStockListItem) {
    setHistoryItem(targetItem);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    setHistoryFilterDraft({ operationKind: "TODOS", originText: "" });
    setHistoryFilters({ operationKind: "TODOS", originText: "" });
    await loadHistory(targetItem, 1);
  }

  async function handleExportCsv() {
    if (!accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar o estoque atual." });
      return;
    }

    if (isExportCooldownActive) {
      return;
    }

    setIsExporting(true);
    setFeedback(null);

    try {
      const exportedItems: CurrentStockListItem[] = [];
      let exportPage = 1;
      let exportTotal = 0;

      while (true) {
        const response = await fetch(
          `/api/stock-balance?${buildCurrentStockQuery(filters, exportPage, EXPORT_PAGE_SIZE)}`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );

        const data = (await response.json().catch(() => ({}))) as CurrentStockListResponse;
        if (!response.ok) {
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao exportar o estoque atual.",
          });

          await logError("Falha ao exportar o estoque atual.", undefined, {
            responseStatus: response.status,
            responseMessage: data.message ?? null,
            filters,
            exportPage,
          });
          return;
        }

        const pageItems = data.items ?? [];
        exportTotal = data.pagination?.total ?? exportTotal;
        exportedItems.push(...pageItems);

        if (
          pageItems.length === 0
          || exportedItems.length >= exportTotal
          || pageItems.length < EXPORT_PAGE_SIZE
        ) {
          break;
        }

        exportPage += 1;
      }

      if (exportedItems.length === 0) {
        setFeedback({
          type: "error",
          message: "Nao ha registros para exportar com os filtros atuais.",
        });
        return;
      }

      const lines = [
        "centro_estoque;material_codigo;descricao;umb;tipo;saldo;ultima_movimentacao",
        ...exportedItems.map((item) => [
          csvEscape(item.stockCenterName),
          csvEscape(item.materialCode),
          csvEscape(item.description),
          csvEscape(item.unit),
          csvEscape(item.materialType),
          csvEscape(item.balanceQuantity),
          csvEscape(formatDateTime(item.lastMovementAt)),
        ].join(";")),
      ];

      downloadCsvFile(
        `\uFEFF${lines.join("\n")}\n`,
        `estoque_atual_${toIsoDate(new Date())}.csv`,
      );

      setFeedback({
        type: "success",
        message: "Exportacao do estoque atual concluida.",
      });
      setIsExportCooldownActive(true);
      window.setTimeout(() => setIsExportCooldownActive(false), EXPORT_COOLDOWN_MS);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao exportar o estoque atual." });
      await logError("Falha ao exportar o estoque atual.", error, { filters });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      <article className={styles.card}>
        <h2 className={styles.cardTitle}>Filtros</h2>

        <form className={styles.filterGrid} onSubmit={handleApplyFilters}>
          <label className={styles.field}>
            <span>Centro de estoque</span>
            <select
              value={filterDraft.stockCenterId}
              onChange={(event) => updateFilterDraft("stockCenterId", event.target.value)}
              disabled={isLoadingMeta}
            >
              <option value="">Todos</option>
              {stockCenters.map((center) => (
                <option key={center.id} value={center.id}>
                  {center.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Material (codigo)</span>
            <input
              type="text"
              value={filterDraft.materialCode}
              onChange={(event) => updateFilterDraft("materialCode", event.target.value)}
              placeholder="Ex.: CABO-10"
            />
          </label>

          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Descricao</span>
            <input
              type="text"
              value={filterDraft.description}
              onChange={(event) => updateFilterDraft("description", event.target.value)}
              placeholder="Filtrar por descricao"
            />
          </label>

          <label className={styles.field}>
            <span>Saldo minimo</span>
            <input
              type="number"
              min="0"
              step="1"
              value={filterDraft.qtyMin}
              onChange={(event) => updateFilterDraft("qtyMin", event.target.value)}
              placeholder="0"
            />
          </label>

          <label className={styles.field}>
            <span>Saldo maximo</span>
            <input
              type="number"
              min="0"
              step="1"
              value={filterDraft.qtyMax}
              onChange={(event) => updateFilterDraft("qtyMax", event.target.value)}
              placeholder="9999"
            />
          </label>

          <label className={styles.field}>
            <span>Exibir saldo zero</span>
            <select
              value={filterDraft.onlyPositive}
              onChange={(event) => updateFilterDraft("onlyPositive", event.target.value as "SIM" | "TODOS")}
            >
              <option value="SIM">Nao</option>
              <option value="TODOS">Sim</option>
            </select>
          </label>

          <div className={styles.actions}>
            <button type="submit" className={styles.secondaryButton} disabled={isLoadingList}>
              Aplicar
            </button>
            <button type="button" className={styles.ghostButton} onClick={handleClearFilters} disabled={isLoadingList}>
              Limpar
            </button>
          </div>
        </form>
      </article>

      {feedback ? (
        <div className={feedback.type === "error" ? styles.feedbackError : styles.feedbackSuccess}>
          {feedback.message}
        </div>
      ) : null}

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <div>
            <h3 className={styles.cardTitle}>Lista de Estoque Atual</h3>
            <p className={styles.tableHint}>
              O saldo exibido ja vem calculado do backend e considera apenas estoques fisicos/proprios. Materiais que ja passaram pelo centro fisico continuam visiveis com saldo `0`, preservando o acesso ao historico operacional.
            </p>
          </div>

          <div className={styles.tableHeaderActions}>
            <CsvExportButton
              onClick={() => void handleExportCsv()}
              disabled={isLoadingList || isExporting || isExportCooldownActive}
              isLoading={isExporting}
              className={styles.secondaryButton}
            />
          </div>
        </div>

        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Registros filtrados</span>
            <strong className={styles.statValue}>{formatInteger(total)}</strong>
          </div>

          <div className={styles.statCard}>
            <span className={styles.statLabel}>Saldo total da pagina</span>
            <strong className={styles.statValue}>{formatInteger(pageBalanceTotal)}</strong>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Centro</th>
                <th>Material</th>
                <th>Descricao</th>
                <th>UMB</th>
                <th>Tipo</th>
                <th>Saldo</th>
                <th>Ultima movimentacao</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {items.length > 0 ? items.map((item) => (
                <tr key={`${item.stockCenterId}-${item.materialId}`}>
                  <td>{item.stockCenterName}</td>
                  <td>{item.materialCode}</td>
                  <td>{item.description}</td>
                  <td>{item.unit || "-"}</td>
                  <td>{item.materialType || "-"}</td>
                  <td className={styles.quantityCell}>{formatInteger(item.balanceQuantity)}</td>
                  <td>{formatDateTime(item.lastMovementAt)}</td>
                  <td className={styles.actionsCell}>
                    <div className={styles.tableActions}>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionView}`}
                        onClick={() => setDetailItem(item)}
                        title="Detalhes"
                        aria-label={`Detalhes do saldo ${item.materialCode} no centro ${item.stockCenterName}`}
                      >
                        <ActionIcon name="details" />
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionHistory}`}
                        onClick={() => void openHistoryModal(item)}
                        title="Historico"
                        aria-label={`Historico do saldo ${item.materialCode} no centro ${item.stockCenterName}`}
                      >
                        <ActionIcon name="history" />
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className={styles.emptyRow}>
                    {isLoadingList ? "Carregando estoque atual..." : "Nenhum saldo encontrado para os filtros aplicados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={styles.pagination}>
          <span>
            Pagina {Math.min(page, totalPages)} de {totalPages} | Total: {total}
          </span>

          <div className={styles.paginationActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || isLoadingList}
            >
              Anterior
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages || isLoadingList}
            >
              Proxima
            </button>
          </div>
        </div>
      </article>

      {detailItem ? (
        <div className={styles.modalOverlay} onClick={() => setDetailItem(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes do Estoque Atual</h4>
                <p className={styles.modalSubtitle}>
                  {detailItem.materialCode} | {detailItem.stockCenterName}
                </p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailItem(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Centro:</strong> {detailItem.stockCenterName}</div>
                <div><strong>Material:</strong> {detailItem.materialCode}</div>
                <div><strong>Descricao:</strong> {detailItem.description}</div>
                <div><strong>UMB:</strong> {detailItem.unit || "-"}</div>
                <div><strong>Tipo:</strong> {detailItem.materialType || "-"}</div>
                <div><strong>Saldo atual:</strong> {formatInteger(detailItem.balanceQuantity)}</div>
                <div><strong>Ultima movimentacao:</strong> {formatDateTime(detailItem.lastMovementAt)}</div>
                <div><strong>Chave tecnica:</strong> {detailItem.stockCenterId} | {detailItem.materialId}</div>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {historyItem ? (
        <div className={styles.modalOverlay} onClick={closeHistoryModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Historico do Estoque Atual</h4>
                <p className={styles.modalSubtitle}>
                  {historyItem.materialCode} | {historyItem.stockCenterName}
                </p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeHistoryModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <form className={styles.filterGrid} onSubmit={handleApplyHistoryFilters}>
                <label className={styles.field}>
                  <span>Operacao</span>
                  <select
                    value={historyFilterDraft.operationKind}
                    onChange={(event) => setHistoryFilterDraft((current) => ({
                      ...current,
                      operationKind: event.target.value as CurrentStockHistoryFilters["operationKind"],
                    }))}
                    disabled={isLoadingHistory}
                  >
                    <option value="TODOS">Todos</option>
                    <option value="ENTRY">Entrada</option>
                    <option value="EXIT">Saida</option>
                    <option value="TRANSFER">Transferencia</option>
                    <option value="REQUISITION">Requisicao</option>
                    <option value="RETURN">Devolucao</option>
                    <option value="FIELD_RETURN">Retorno de campo</option>
                  </select>
                </label>

                <label className={styles.field}>
                  <span>Origem</span>
                  <input
                    type="text"
                    value={historyFilterDraft.originText}
                    onChange={(event) => setHistoryFilterDraft((current) => ({
                      ...current,
                      originText: event.target.value,
                    }))}
                    placeholder="Ex.: CAMPO"
                    disabled={isLoadingHistory}
                  />
                </label>

                <div className={styles.actions}>
                  <button type="submit" className={styles.secondaryButton} disabled={isLoadingHistory}>
                    Aplicar
                  </button>
                  <button type="button" className={styles.ghostButton} onClick={handleClearHistoryFilters} disabled={isLoadingHistory}>
                    Limpar
                  </button>
                </div>
              </form>

              {isLoadingHistory ? <p>Carregando historico...</p> : null}
              {!isLoadingHistory && historyEntries.length === 0 ? <p>Nenhuma movimentacao encontrada para este material neste centro.</p> : null}

              {!isLoadingHistory && historyEntries.length > 0 ? historyEntries.map((entry) => (
                <article
                  key={entry.id}
                  className={`${styles.historyCard} ${
                    entry.isReversal
                      ? styles.historyCardReversal
                      : entry.isReversed
                        ? styles.historyCardReversed
                        : ""
                  }`.trim()}
                >
                  <header className={styles.historyCardHeader}>
                    <div className={styles.historyHeaderMain}>
                      <strong>{currentStockHistoryTitle(entry)}</strong>
                      <div className={styles.historyBadgeRow}>
                        <span className={`${styles.historyBadge} ${
                          entry.movementType === "ENTRY"
                            ? styles.historyBadgeEntry
                            : entry.movementType === "EXIT"
                              ? styles.historyBadgeExit
                              : styles.historyBadgeTransfer
                        }`}>
                        {movementTypeLabel(entry.operationKind ?? entry.movementType)}
                        </span>
                        <span className={`${styles.historyBadge} ${
                          entry.isReversal
                            ? styles.historyBadgeReversal
                            : entry.isReversed
                              ? styles.historyBadgeReversed
                              : styles.historyBadgeNeutral
                        }`}>
                          {currentStockStatusLabel(entry)}
                        </span>
                      </div>
                    </div>
                    <span>{formatDateTime(entry.changedAt)} | {entry.updatedByName} | Transferencia: {entry.transferId}</span>
                  </header>
                  <div className={styles.historyMeta}>
                    <div>
                      <strong>Saldo aplicado:</strong>{" "}
                      <span className={entry.signedQuantity >= 0 ? styles.historySignedPositive : styles.historySignedNegative}>
                        {formatSignedInteger(entry.signedQuantity)}
                      </span>
                    </div>
                    <div><strong>Operacao:</strong> {movementTypeLabel(entry.operationKind ?? entry.movementType)}</div>
                    {entry.teamName ? <div><strong>Equipe:</strong> {entry.teamName}</div> : null}
                    {entry.foremanName ? <div><strong>Encarregado:</strong> {entry.foremanName}</div> : null}
                    <div><strong>Projeto:</strong> {entry.projectCode}</div>
                    <div><strong>Centro DE:</strong> {entry.fromStockCenterName}</div>
                    <div><strong>Centro PARA:</strong> {entry.toStockCenterName}</div>
                    <div><strong>Data da movimentacao:</strong> {formatDateTime(`${entry.entryDate}T00:00:00`)}</div>
                    <div><strong>Quantidade original:</strong> {formatInteger(entry.quantity)}</div>
                    <div><strong>Serial:</strong> {entry.serialNumber || "-"}</div>
                    <div><strong>LP:</strong> {entry.lotCode || "-"}</div>
                    <div><strong>Status:</strong> {currentStockStatusLabel(entry)}</div>
                    <div><strong>Motivo do estorno:</strong> {entry.reversalReason || "-"}</div>
                    <div><strong>Observacao:</strong> {entry.notes || "-"}</div>
                  </div>
                </article>
              )) : null}

              {historyTotal > 0 ? (
                <div className={styles.pagination}>
                  <span>
                    Pagina {Math.min(historyPage, historyTotalPages)} de {historyTotalPages} | Total: {historyTotal}
                  </span>
                  <div className={styles.paginationActions}>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => {
                        const target = Math.max(1, historyPage - 1);
                        if (historyItem) void loadHistory(historyItem, target);
                      }}
                      disabled={historyPage <= 1 || isLoadingHistory}
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => {
                        const target = Math.min(historyTotalPages, historyPage + 1);
                        if (historyItem) void loadHistory(historyItem, target);
                      }}
                      disabled={historyPage >= historyTotalPages || isLoadingHistory}
                    >
                      Proxima
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
