"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { serialTrackingLabel } from "@/lib/materialSerialTracking";
import { EXPORT_COOLDOWN_MS, EXPORT_PAGE_SIZE, HISTORY_PAGE_SIZE, INITIAL_FILTERS, PAGE_SIZE } from "./constants";
import type {
  StockCenterOption,
  TrafoPositionFilters,
  TrafoPositionHistoryEntry,
  TrafoPositionHistoryResponse,
  TrafoPositionListItem,
  TrafoPositionListResponse,
  TrafoPositionMetaResponse,
} from "./types";
import {
  buildTrafoPositionQuery,
  csvEscape,
  downloadCsvFile,
  formatDate,
  formatDateTime,
  normalizeText,
  toIsoDate,
} from "./utils";
import styles from "./TrafoPositionPageView.module.css";

function movementTypeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "ENTRY") return "Entrada";
  if (normalized === "EXIT") return "Saida";
  if (normalized === "TRANSFER") return "Transferencia";
  if (normalized === "REQUISITION") return "Requisicao";
  if (normalized === "RETURN") return "Devolucao";
  if (normalized === "FIELD_RETURN") return "Retorno de campo";
  if (normalized === "RET") return "RET";
  return "-";
}

function movementChipClass(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "ENTRY" || normalized === "RETURN" || normalized === "FIELD_RETURN") {
    return `${styles.movementChip} ${styles.movementChipEntry}`;
  }
  if (normalized === "EXIT" || normalized === "REQUISITION") {
    return `${styles.movementChip} ${styles.movementChipExit}`;
  }
  if (normalized === "RET") {
    return `${styles.movementChip} ${styles.movementChipRet}`;
  }
  return `${styles.movementChip} ${styles.movementChipTransfer}`;
}

function historyBadgeClass(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "ENTRY" || normalized === "RETURN" || normalized === "FIELD_RETURN") return `${styles.historyBadge} ${styles.historyBadgeEntry}`;
  if (normalized === "EXIT") return `${styles.historyBadge} ${styles.historyBadgeExit}`;
  if (normalized === "REQUISITION") return `${styles.historyBadge} ${styles.historyBadgeTeam}`;
  if (normalized === "RET") return `${styles.historyBadge} ${styles.historyBadgeRet}`;
  return `${styles.historyBadge} ${styles.historyBadgeTransfer}`;
}

function currentStatusLabel(value: TrafoPositionListItem["currentStatus"]) {
  if (value === "EM_ESTOQUE") return "Em estoque proprio";
  if (value === "COM_EQUIPE") return "Com equipe";
  if (value === "RET") return "RET / sucateado";
  return "Fora do estoque proprio";
}

function currentStatusChipClass(value: TrafoPositionListItem["currentStatus"]) {
  if (value === "EM_ESTOQUE") return `${styles.statusChip} ${styles.statusChipOwn}`;
  if (value === "COM_EQUIPE") return `${styles.statusChip} ${styles.statusChipTeam}`;
  if (value === "RET") return `${styles.statusChip} ${styles.statusChipRet}`;
  return `${styles.statusChip} ${styles.statusChipExternal}`;
}

function historyStatusLabel(entry: TrafoPositionHistoryEntry) {
  if (entry.isRetirement) return "RET aplicado";
  if (entry.isReversal) return "Movimentacao de estorno";
  if (entry.isReversed) return "Movimentacao original estornada";
  return "Movimentacao ativa";
}

function historyStatusBadgeClass(entry: TrafoPositionHistoryEntry) {
  if (entry.isRetirement) return `${styles.historyBadge} ${styles.historyBadgeRet}`;
  if (entry.isReversal) return `${styles.historyBadge} ${styles.historyBadgeReversal}`;
  if (entry.isReversed) return `${styles.historyBadge} ${styles.historyBadgeReversed}`;
  return `${styles.historyBadge} ${styles.historyBadgeNeutral}`;
}

export function TrafoPositionPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("posicao_trafo");
  const router = useRouter();
  const accessToken = session?.accessToken ?? null;

  const [stockCenters, setStockCenters] = useState<StockCenterOption[]>([]);
  const [filterDraft, setFilterDraft] = useState<TrafoPositionFilters>(INITIAL_FILTERS);
  const [filters, setFilters] = useState<TrafoPositionFilters>(INITIAL_FILTERS);
  const [items, setItems] = useState<TrafoPositionListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoadingMeta, setIsLoadingMeta] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportCooldownActive, setIsExportCooldownActive] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [detailItem, setDetailItem] = useState<TrafoPositionListItem | null>(null);
  const [historyItem, setHistoryItem] = useState<TrafoPositionListItem | null>(null);
  const [retItem, setRetItem] = useState<TrafoPositionListItem | null>(null);
  const [retReason, setRetReason] = useState("");
  const [isApplyingRet, setIsApplyingRet] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<TrafoPositionHistoryEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const currentInOwnCount = items.filter((item) => item.currentStatus === "EM_ESTOQUE").length;
  const currentWithTeamCount = items.filter((item) => item.currentStatus === "COM_EQUIPE").length;
  const currentOutsideCount = items.filter((item) => item.currentStatus === "FORA_ESTOQUE").length;
  const currentRetCount = items.filter((item) => item.currentStatus === "RET").length;

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let isMounted = true;

    async function loadMeta() {
      setIsLoadingMeta(true);

      try {
        const response = await fetch("/api/trafo-positions/meta", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        const data = (await response.json().catch(() => ({}))) as TrafoPositionMetaResponse;
        if (!response.ok) {
          if (isMounted) {
            setFeedback({ type: "error", message: data.message ?? "Falha ao carregar os centros do rastreio de serial." });
          }

          await logError("Falha ao carregar metadados do rastreio de serial.", undefined, {
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
          setFeedback({ type: "error", message: "Falha ao carregar os centros do rastreio de serial." });
        }

        await logError("Falha ao carregar metadados do rastreio de serial.", error);
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
        const response = await fetch(`/api/trafo-positions?${buildTrafoPositionQuery(filters, page, PAGE_SIZE)}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        const data = (await response.json().catch(() => ({}))) as TrafoPositionListResponse;
        if (!response.ok) {
          if (isMounted) {
            setItems([]);
            setTotal(0);
            setFeedback({ type: "error", message: data.message ?? "Falha ao carregar o rastreio de serial." });
          }

          await logError("Falha ao carregar a lista de rastreio de serial.", undefined, {
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
          setFeedback({ type: "error", message: "Falha ao carregar o rastreio de serial." });
        }

        await logError("Falha ao carregar a lista de rastreio de serial.", error, { filters, page });
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

  function updateFilterDraft<K extends keyof TrafoPositionFilters>(key: K, value: TrafoPositionFilters[K]) {
    setFilterDraft((current) => ({ ...current, [key]: value }));
  }

  function handleApplyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setPage(1);
    setFilters({
      stockCenterId: filterDraft.stockCenterId,
      materialCode: normalizeText(filterDraft.materialCode).toUpperCase(),
      serialNumber: normalizeText(filterDraft.serialNumber),
      lotCode: normalizeText(filterDraft.lotCode),
      currentStatus: filterDraft.currentStatus,
    });
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
  }

  async function loadHistory(targetItem: TrafoPositionListItem, targetPage: number) {
    if (!accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para carregar o historico da unidade." });
      return;
    }

    setIsLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      params.set("mode", "history");
      params.set("trafoInstanceId", targetItem.id);
      params.set("page", String(targetPage));
      params.set("pageSize", String(HISTORY_PAGE_SIZE));

      const response = await fetch(`/api/trafo-positions?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const data = (await response.json().catch(() => ({}))) as TrafoPositionHistoryResponse;
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao carregar o historico da unidade." });
        setHistoryEntries([]);
        setHistoryTotal(0);

        await logError("Falha ao carregar o historico do rastreio de serial.", undefined, {
          responseStatus: response.status,
          responseMessage: data.message ?? null,
          trafoInstanceId: targetItem.id,
          page: targetPage,
        });
        return;
      }

      setHistoryEntries(data.history ?? []);
      setHistoryPage(data.pagination?.page ?? targetPage);
      setHistoryTotal(data.pagination?.total ?? 0);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao carregar o historico da unidade." });
      setHistoryEntries([]);
      setHistoryTotal(0);

      await logError("Falha ao carregar o historico do rastreio de serial.", error, {
        trafoInstanceId: targetItem.id,
        page: targetPage,
      });
    } finally {
      setIsLoadingHistory(false);
    }
  }

  async function openHistoryModal(targetItem: TrafoPositionListItem) {
    setHistoryItem(targetItem);
    setHistoryEntries([]);
    setHistoryPage(1);
    setHistoryTotal(0);
    await loadHistory(targetItem, 1);
  }

  function openTransferPrefill(item: TrafoPositionListItem) {
    if (!item.canMove || !item.currentStockCenterId) {
      return;
    }

    const params = new URLSearchParams();
    params.set("prefillMode", "serial-transfer");
    params.set("fromStockCenterId", item.currentStockCenterId);
    params.set("materialId", item.materialId);
    params.set("materialCode", item.materialCode);
    params.set("serialNumber", item.serialNumber);
    params.set("lotCode", item.lotCode);

    router.push(`/entrada?${params.toString()}`);
  }

  function openRetModal(item: TrafoPositionListItem) {
    if (!item.canRetire) {
      return;
    }

    setRetItem(item);
    setRetReason("");
    setFeedback(null);
  }

  function closeRetModal() {
    if (isApplyingRet) {
      return;
    }

    setRetItem(null);
    setRetReason("");
  }

  async function handleApplyRet() {
    if (!accessToken || !retItem) {
      setFeedback({ type: "error", message: "Sessao invalida para aplicar RET." });
      return;
    }

    setIsApplyingRet(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/trafo-positions", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "RET",
          trafoInstanceId: retItem.id,
          reason: normalizeText(retReason),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setFeedback({ type: "error", message: data.message ?? "Falha ao aplicar RET na unidade." });

        await logError("Falha ao aplicar RET no rastreio de serial.", undefined, {
          responseStatus: response.status,
          responseMessage: data.message ?? null,
          trafoInstanceId: retItem.id,
        });
        return;
      }

      setRetItem(null);
      setRetReason("");
      setFeedback({ type: "success", message: data.message ?? "RET aplicado com sucesso." });
      setPage(1);
      setFilters((current) => ({ ...current }));
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao aplicar RET na unidade." });
      await logError("Falha ao aplicar RET no rastreio de serial.", error, { trafoInstanceId: retItem.id });
    } finally {
      setIsApplyingRet(false);
    }
  }

  async function handleExportCsv() {
    if (!accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar o rastreio de serial." });
      return;
    }

    if (isExportCooldownActive) {
      return;
    }

    setIsExporting(true);
    setFeedback(null);

    try {
      const exportedItems: TrafoPositionListItem[] = [];
      let exportPage = 1;
      let exportTotal = 0;

      while (true) {
        const response = await fetch(`/api/trafo-positions?${buildTrafoPositionQuery(filters, exportPage, EXPORT_PAGE_SIZE)}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        const data = (await response.json().catch(() => ({}))) as TrafoPositionListResponse;
        if (!response.ok) {
          setFeedback({ type: "error", message: data.message ?? "Falha ao exportar o rastreio de serial." });

          await logError("Falha ao exportar o rastreio de serial.", undefined, {
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

        if (pageItems.length === 0 || exportedItems.length >= exportTotal || pageItems.length < EXPORT_PAGE_SIZE) {
          break;
        }

        exportPage += 1;
      }

      if (exportedItems.length === 0) {
        setFeedback({ type: "error", message: "Nao ha registros para exportar com os filtros atuais." });
        return;
      }

      const lines = [
        "centro_fisico;situacao;equipe_atual;encarregado_atual;projeto_ultimo;material_codigo;descricao;rastreio;serial;lp;ultima_operacao;data_ultima_movimentacao;atualizado_em;ultima_transferencia;ret_em;ret_por;ret_motivo",
        ...exportedItems.map((item) => [
          csvEscape(item.currentStockCenterName ?? "-"),
          csvEscape(currentStatusLabel(item.currentStatus)),
          csvEscape(item.currentTeamName ?? "-"),
          csvEscape(item.currentForemanName ?? "-"),
          csvEscape(item.lastProjectCode ?? "-"),
          csvEscape(item.materialCode),
          csvEscape(item.description),
          csvEscape(serialTrackingLabel(item.serialTrackingType)),
          csvEscape(item.serialNumber),
          csvEscape(item.lotCode),
          csvEscape(movementTypeLabel(item.lastOperationKind)),
          csvEscape(formatDate(item.lastEntryDate)),
          csvEscape(formatDateTime(item.updatedAt)),
          csvEscape(item.lastTransferId ?? "-"),
          csvEscape(formatDateTime(item.retiredAt)),
          csvEscape(item.retiredByName ?? "-"),
          csvEscape(item.retiredReason ?? "-"),
        ].join(";")),
      ];

      downloadCsvFile(`\uFEFF${lines.join("\n")}\n`, `rastreio_serial_${toIsoDate(new Date())}.csv`);

      setFeedback({ type: "success", message: "Exportacao do rastreio de serial concluida." });
      setIsExportCooldownActive(true);
      window.setTimeout(() => setIsExportCooldownActive(false), EXPORT_COOLDOWN_MS);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao exportar o rastreio de serial." });
      await logError("Falha ao exportar o rastreio de serial.", error, { filters });
    } finally {
      setIsExporting(false);
    }
  }

  const detailMovementChipClass = useMemo(() => movementChipClass(detailItem?.lastOperationKind), [detailItem]);

  return (
    <section className={styles.wrapper}>
      <article className={styles.card}>
        <h2 className={styles.cardTitle}>Filtros</h2>

        <form className={styles.filterGrid} onSubmit={handleApplyFilters}>
          <label className={styles.field}>
            <span>Centro fisico</span>
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
            <span>Situacao</span>
            <select
              value={filterDraft.currentStatus}
              onChange={(event) => updateFilterDraft("currentStatus", event.target.value as TrafoPositionFilters["currentStatus"])}
            >
              <option value="TODOS">Todos</option>
              <option value="EM_ESTOQUE">Em estoque proprio</option>
              <option value="COM_EQUIPE">Com equipe</option>
              <option value="RET">RET / sucateado</option>
              <option value="FORA_ESTOQUE">Fora do estoque proprio</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>Material (codigo)</span>
            <input
              type="text"
              value={filterDraft.materialCode}
              onChange={(event) => updateFilterDraft("materialCode", event.target.value)}
              placeholder="Ex.: 111306"
            />
          </label>

          <label className={styles.field}>
            <span>Serial</span>
            <input
              type="text"
              value={filterDraft.serialNumber}
              onChange={(event) => updateFilterDraft("serialNumber", event.target.value)}
              placeholder="Ex.: 2323232"
            />
          </label>

          <label className={styles.field}>
            <span>LP</span>
            <input
              type="text"
              value={filterDraft.lotCode}
              onChange={(event) => updateFilterDraft("lotCode", event.target.value)}
              placeholder="Ex.: 232323"
            />
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
        <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
      ) : null}

      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <div>
            <h3 className={styles.cardTitle}>Rastreio de SERIAL</h3>
            <p className={styles.tableHint}>
              A lista mantem uma linha por unidade e mostra o centro fisico de referencia. RET baixa o saldo disponivel, mantem a unidade fisica no rastreio e permite movimentacao fisica sem reabrir disponibilidade.
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
            <strong className={styles.statValue}>{total}</strong>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Em estoque proprio</span>
            <strong className={styles.statValue}>{currentInOwnCount}</strong>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Com equipe</span>
            <strong className={styles.statValue}>{currentWithTeamCount}</strong>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>RET</span>
            <strong className={styles.statValue}>{currentRetCount}</strong>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Fora do estoque proprio</span>
            <strong className={styles.statValue}>{currentOutsideCount}</strong>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Centro fisico</th>
                <th>Situacao</th>
                <th>Equipe atual</th>
                <th>Projeto ultimo</th>
                <th>Material (codigo)</th>
                <th>Descricao</th>
                <th>Rastreio</th>
                <th>Serial</th>
                <th>LP</th>
                <th>Ultima operacao</th>
                <th>Data ultima movimentacao</th>
                <th>Atualizado em</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {items.length > 0 ? items.map((item) => (
                <tr key={item.id}>
                  <td>{item.currentStockCenterName ?? "-"}</td>
                  <td className={styles.statusCell}>
                    <span className={currentStatusChipClass(item.currentStatus)}>
                      {currentStatusLabel(item.currentStatus)}
                    </span>
                  </td>
                  <td>{item.currentTeamName ?? "-"}</td>
                  <td>{item.lastProjectCode ?? "-"}</td>
                  <td>{item.materialCode}</td>
                  <td className={styles.descriptionCell}>{item.description}</td>
                  <td>{serialTrackingLabel(item.serialTrackingType)}</td>
                  <td>{item.serialNumber}</td>
                  <td>{item.lotCode}</td>
                  <td>
                    <span className={movementChipClass(item.lastOperationKind)}>
                      {movementTypeLabel(item.lastOperationKind)}
                    </span>
                  </td>
                  <td>{formatDate(item.lastEntryDate)}</td>
                  <td>{formatDateTime(item.updatedAt)}</td>
                  <td className={styles.actionsCell}>
                    <div className={styles.tableActions}>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionView}`}
                        onClick={() => setDetailItem(item)}
                        title="Detalhes"
                        aria-label={`Detalhes da unidade ${item.materialCode} serial ${item.serialNumber}`}
                      >
                        <ActionIcon name="details" />
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionHistory}`}
                        onClick={() => void openHistoryModal(item)}
                        title="Historico"
                        aria-label={`Historico da unidade ${item.materialCode} serial ${item.serialNumber}`}
                      >
                        <ActionIcon name="history" />
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionTransfer}`}
                        onClick={() => openTransferPrefill(item)}
                        title={item.canMove ? "Movimentar esta unidade" : "Unidade indisponivel para movimentacao a partir do estoque proprio"}
                        aria-label={`Movimentar a unidade ${item.materialCode} serial ${item.serialNumber}`}
                        disabled={!item.canMove}
                      >
                        <ActionIcon name="transfer" />
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionRet}`}
                        onClick={() => openRetModal(item)}
                        title={item.canRetire ? "Aplicar RET" : "RET indisponivel para esta unidade"}
                        aria-label={`Aplicar RET na unidade ${item.materialCode} serial ${item.serialNumber}`}
                        disabled={!item.canRetire}
                      >
                        RET
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={13} className={styles.emptyRow}>
                    {isLoadingList ? "Carregando rastreio de serial..." : "Nenhuma unidade encontrada para os filtros aplicados."}
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
                <h4>Detalhes do Rastreio</h4>
                <p className={styles.modalSubtitle}>
                  {detailItem.materialCode} | Serial {detailItem.serialNumber} | LP {detailItem.lotCode}
                </p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailItem(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.detailGrid}>
                <div><strong>Centro fisico:</strong> {detailItem.currentStockCenterName ?? "-"}</div>
                <div><strong>Situacao:</strong> {currentStatusLabel(detailItem.currentStatus)}</div>
                <div><strong>Equipe atual:</strong> {detailItem.currentTeamName ?? "-"}</div>
                <div><strong>Encarregado atual:</strong> {detailItem.currentForemanName ?? "-"}</div>
                <div><strong>Projeto ultimo:</strong> {detailItem.lastProjectCode ?? "-"}</div>
                <div><strong>Material:</strong> {detailItem.materialCode}</div>
                <div className={styles.detailWide}><strong>Descricao:</strong> {detailItem.description}</div>
                <div><strong>Tipo:</strong> {detailItem.materialType || "-"}</div>
                <div><strong>Rastreio:</strong> {serialTrackingLabel(detailItem.serialTrackingType)}</div>
                <div><strong>Serial:</strong> {detailItem.serialNumber}</div>
                <div><strong>LP:</strong> {detailItem.lotCode}</div>
                <div><strong>Ultima operacao:</strong> <span className={detailMovementChipClass}>{movementTypeLabel(detailItem.lastOperationKind)}</span></div>
                <div><strong>Data ultima movimentacao:</strong> {formatDate(detailItem.lastEntryDate)}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailItem.updatedAt)}</div>
                <div><strong>Atualizado por:</strong> {detailItem.updatedByName}</div>
                <div><strong>Movimentacao fisica permitida:</strong> {detailItem.canMove ? "Sim" : "Nao"}</div>
                <div><strong>RET aplicado em:</strong> {formatDateTime(detailItem.retiredAt)}</div>
                <div><strong>RET aplicado por:</strong> {detailItem.retiredByName ?? "-"}</div>
                <div className={styles.detailWide}><strong>Motivo RET:</strong> {detailItem.retiredReason ?? "-"}</div>
                <div className={styles.detailWide}><strong>Ultima transferencia:</strong> {detailItem.lastTransferId ?? "-"}</div>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {retItem ? (
        <div className={styles.modalOverlay} onClick={closeRetModal}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Aplicar RET</h4>
                <p className={styles.modalSubtitle}>
                  {retItem.materialCode} | Serial {retItem.serialNumber} | LP {retItem.lotCode}
                </p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeRetModal} disabled={isApplyingRet}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              <div className={styles.retWarning}>
                <strong>Impacto no estoque:</strong> baixa 1 do saldo disponivel, mantem a unidade no centro fisico do rastreio e permite movimentacao fisica sem voltar para saldo disponivel.
              </div>

              <div className={styles.detailGrid}>
                <div><strong>Centro fisico:</strong> {retItem.currentStockCenterName ?? "-"}</div>
                <div><strong>Situacao atual:</strong> {currentStatusLabel(retItem.currentStatus)}</div>
                <div><strong>Material:</strong> {retItem.materialCode}</div>
                <div><strong>Rastreio:</strong> {serialTrackingLabel(retItem.serialTrackingType)}</div>
              </div>

              <label className={styles.field}>
                <span>Observacao RET</span>
                <textarea
                  value={retReason}
                  onChange={(event) => setRetReason(event.target.value)}
                  placeholder="Ex.: material sucateado fisicamente no galpao"
                  disabled={isApplyingRet}
                />
              </label>

              <div className={styles.modalActions}>
                <button type="button" className={styles.ghostButton} onClick={closeRetModal} disabled={isApplyingRet}>
                  Cancelar
                </button>
                <button type="button" className={styles.dangerButton} onClick={() => void handleApplyRet()} disabled={isApplyingRet}>
                  {isApplyingRet ? "Aplicando..." : "Confirmar RET"}
                </button>
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
                <h4>Historico da Unidade</h4>
                <p className={styles.modalSubtitle}>
                  {historyItem.materialCode} | Serial {historyItem.serialNumber} | LP {historyItem.lotCode}
                </p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={closeHistoryModal}>
                Fechar
              </button>
            </header>

            <div className={styles.modalBody}>
              {isLoadingHistory ? <p>Carregando historico...</p> : null}
              {!isLoadingHistory && historyEntries.length === 0 ? <p>Nenhuma movimentacao encontrada para esta unidade.</p> : null}

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
                      <strong>{movementTypeLabel(entry.operationKind)}</strong>
                      <div className={styles.historyBadgeRow}>
                        <span className={historyBadgeClass(entry.operationKind)}>
                          {movementTypeLabel(entry.operationKind)}
                        </span>
                        <span className={historyStatusBadgeClass(entry)}>
                          {historyStatusLabel(entry)}
                        </span>
                      </div>
                    </div>
                    <span className={styles.historyHeaderMeta}>
                      {formatDateTime(entry.changedAt)} | {entry.updatedByName} | Transferencia: {entry.transferId}
                    </span>
                  </header>

                  <div className={styles.historyMeta}>
                    <div><strong>Quantidade:</strong> {entry.quantity}</div>
                    <div><strong>Projeto:</strong> {entry.projectCode}</div>
                    <div><strong>Centro DE:</strong> {entry.fromStockCenterName}</div>
                    <div><strong>Centro PARA:</strong> {entry.toStockCenterName}</div>
                    <div><strong>Equipe:</strong> {entry.teamName || "-"}</div>
                    <div><strong>Encarregado:</strong> {entry.foremanName || "-"}</div>
                    <div><strong>Data da movimentacao:</strong> {formatDate(entry.entryDate)}</div>
                    <div><strong>Tipo tecnico:</strong> {movementTypeLabel(entry.movementType)}</div>
                    <div className={styles.detailWide}><strong>Motivo do estorno:</strong> {entry.reversalReason || "-"}</div>
                    <div className={styles.detailWide}><strong>Observacao:</strong> {entry.notes || "-"}</div>
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
