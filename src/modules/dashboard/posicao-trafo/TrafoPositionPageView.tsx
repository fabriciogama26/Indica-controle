"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { CsvExportButton } from "@/components/ui/CsvExportButton";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { EXPORT_COOLDOWN_MS, EXPORT_PAGE_SIZE, INITIAL_FILTERS, PAGE_SIZE } from "./constants";
import type {
  StockCenterOption,
  TrafoPositionFilters,
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
  return "-";
}

function currentStatusLabel(value: "EM_ESTOQUE" | "FORA_ESTOQUE") {
  if (value === "EM_ESTOQUE") return "Em estoque proprio";
  return "Fora do estoque proprio";
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
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [detailItem, setDetailItem] = useState<TrafoPositionListItem | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentInOwnCount = items.filter((item) => item.currentStatus === "EM_ESTOQUE").length;
  const currentOutsideCount = items.filter((item) => item.currentStatus === "FORA_ESTOQUE").length;

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
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as TrafoPositionMetaResponse;
        if (!response.ok) {
          if (isMounted) {
            setFeedback({
              type: "error",
              message: data.message ?? "Falha ao carregar os centros da posicao de TRAFO.",
            });
          }

          await logError("Falha ao carregar metadados da posicao de TRAFO.", undefined, {
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
          setFeedback({ type: "error", message: "Falha ao carregar os centros da posicao de TRAFO." });
        }

        await logError("Falha ao carregar metadados da posicao de TRAFO.", error);
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
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const data = (await response.json().catch(() => ({}))) as TrafoPositionListResponse;
        if (!response.ok) {
          if (isMounted) {
            setItems([]);
            setTotal(0);
            setFeedback({
              type: "error",
              message: data.message ?? "Falha ao carregar a posicao de TRAFO.",
            });
          }

          await logError("Falha ao carregar a lista de posicao de TRAFO.", undefined, {
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
          setFeedback({ type: "error", message: "Falha ao carregar a posicao de TRAFO." });
        }

        await logError("Falha ao carregar a lista de posicao de TRAFO.", error, {
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

  function updateFilterDraft<K extends keyof TrafoPositionFilters>(key: K, value: TrafoPositionFilters[K]) {
    setFilterDraft((current) => ({
      ...current,
      [key]: value,
    }));
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

  function openTransferPrefill(item: TrafoPositionListItem) {
    if (!item.currentStockCenterId) {
      return;
    }

    const params = new URLSearchParams();
    params.set("prefillMode", "transformer-transfer");
    params.set("fromStockCenterId", item.currentStockCenterId);
    params.set("materialId", item.materialId);
    params.set("materialCode", item.materialCode);
    params.set("serialNumber", item.serialNumber);
    params.set("lotCode", item.lotCode);

    router.push(`/entrada?${params.toString()}`);
  }

  async function handleExportCsv() {
    if (!accessToken) {
      setFeedback({ type: "error", message: "Sessao invalida para exportar a posicao de TRAFO." });
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
        const response = await fetch(
          `/api/trafo-positions?${buildTrafoPositionQuery(filters, exportPage, EXPORT_PAGE_SIZE)}`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );

        const data = (await response.json().catch(() => ({}))) as TrafoPositionListResponse;
        if (!response.ok) {
          setFeedback({
            type: "error",
            message: data.message ?? "Falha ao exportar a posicao de TRAFO.",
          });

          await logError("Falha ao exportar a posicao de TRAFO.", undefined, {
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
        "centro_atual;situacao;projeto_ultimo;material_codigo;descricao;serial;lp;ultima_operacao;data_ultima_movimentacao;atualizado_em;ultima_transferencia",
        ...exportedItems.map((item) => [
          csvEscape(item.currentStockCenterName ?? "Fora do estoque proprio"),
          csvEscape(currentStatusLabel(item.currentStatus)),
          csvEscape(item.lastProjectCode ?? "-"),
          csvEscape(item.materialCode),
          csvEscape(item.description),
          csvEscape(item.serialNumber),
          csvEscape(item.lotCode),
          csvEscape(movementTypeLabel(item.lastMovementType)),
          csvEscape(formatDate(item.lastEntryDate)),
          csvEscape(formatDateTime(item.updatedAt)),
          csvEscape(item.lastTransferId ?? "-"),
        ].join(";")),
      ];

      downloadCsvFile(
        `\uFEFF${lines.join("\n")}\n`,
        `posicao_unitaria_trafo_${toIsoDate(new Date())}.csv`,
      );

      setFeedback({
        type: "success",
        message: "Exportacao da posicao de TRAFO concluida.",
      });
      setIsExportCooldownActive(true);
      window.setTimeout(() => setIsExportCooldownActive(false), EXPORT_COOLDOWN_MS);
    } catch (error) {
      setFeedback({ type: "error", message: "Falha ao exportar a posicao de TRAFO." });
      await logError("Falha ao exportar a posicao de TRAFO.", error, { filters });
    } finally {
      setIsExporting(false);
    }
  }

  const detailMovementChipClass = useMemo(() => {
    if (!detailItem) return styles.movementChip;
    if (detailItem.lastMovementType === "ENTRY") return `${styles.movementChip} ${styles.movementChipEntry}`;
    if (detailItem.lastMovementType === "EXIT") return `${styles.movementChip} ${styles.movementChipExit}`;
    return `${styles.movementChip} ${styles.movementChipTransfer}`;
  }, [detailItem]);

  return (
    <section className={styles.wrapper}>
      <article className={styles.card}>
        <h2 className={styles.cardTitle}>Filtros</h2>

        <form className={styles.filterGrid} onSubmit={handleApplyFilters}>
          <label className={styles.field}>
            <span>Centro atual</span>
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
            <h3 className={styles.cardTitle}>Posicao Unitaria de TRAFO</h3>
            <p className={styles.tableHint}>
              Fonte atual: `trafo_instances`. O botao de movimentacao pre-preenche o formulario do `/entrada` com o mesmo material, Serial e LP.
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
            <span className={styles.statLabel}>Fora do estoque proprio</span>
            <strong className={styles.statValue}>{currentOutsideCount}</strong>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Centro atual</th>
                <th>Situacao</th>
                <th>Projeto ultimo</th>
                <th>Material (codigo)</th>
                <th>Descricao</th>
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
                  <td>{item.currentStockCenterName ?? "Fora do estoque proprio"}</td>
                  <td className={styles.statusCell}>
                    <span className={`${styles.statusChip} ${item.currentStatus === "EM_ESTOQUE" ? styles.statusChipOwn : styles.statusChipExternal}`}>
                      {currentStatusLabel(item.currentStatus)}
                    </span>
                  </td>
                  <td>{item.lastProjectCode ?? "-"}</td>
                  <td>{item.materialCode}</td>
                  <td className={styles.descriptionCell}>{item.description}</td>
                  <td>{item.serialNumber}</td>
                  <td>{item.lotCode}</td>
                  <td>
                    <span className={`${styles.movementChip} ${
                      item.lastMovementType === "ENTRY"
                        ? styles.movementChipEntry
                        : item.lastMovementType === "EXIT"
                          ? styles.movementChipExit
                          : styles.movementChipTransfer
                    }`}>
                      {movementTypeLabel(item.lastMovementType)}
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
                        aria-label={`Detalhes da posicao do TRAFO ${item.materialCode} serial ${item.serialNumber}`}
                      >
                        <ActionIcon name="details" />
                      </button>
                      <button
                        type="button"
                        className={`${styles.actionButton} ${styles.actionTransfer}`}
                        onClick={() => openTransferPrefill(item)}
                        title={item.currentStockCenterId ? "Movimentar este TRAFO" : "TRAFO fora do estoque proprio"}
                        aria-label={`Movimentar o TRAFO ${item.materialCode} serial ${item.serialNumber}`}
                        disabled={!item.currentStockCenterId}
                      >
                        <ActionIcon name="transfer" />
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={11} className={styles.emptyRow}>
                    {isLoadingList ? "Carregando posicao de TRAFO..." : "Nenhuma unidade encontrada para os filtros aplicados."}
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
                <h4>Detalhes da Posicao Unitaria</h4>
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
                <div><strong>Centro atual:</strong> {detailItem.currentStockCenterName ?? "Fora do estoque proprio"}</div>
                <div><strong>Situacao:</strong> {currentStatusLabel(detailItem.currentStatus)}</div>
                <div><strong>Projeto ultimo:</strong> {detailItem.lastProjectCode ?? "-"}</div>
                <div><strong>Material:</strong> {detailItem.materialCode}</div>
                <div className={styles.detailWide}><strong>Descricao:</strong> {detailItem.description}</div>
                <div><strong>Tipo:</strong> {detailItem.materialType || "-"}</div>
                <div><strong>Serial:</strong> {detailItem.serialNumber}</div>
                <div><strong>LP:</strong> {detailItem.lotCode}</div>
                <div><strong>Ultima operacao:</strong> <span className={detailMovementChipClass}>{movementTypeLabel(detailItem.lastMovementType)}</span></div>
                <div><strong>Data ultima movimentacao:</strong> {formatDate(detailItem.lastEntryDate)}</div>
                <div><strong>Atualizado em:</strong> {formatDateTime(detailItem.updatedAt)}</div>
                <div><strong>Atualizado por:</strong> {detailItem.updatedByName}</div>
                <div className={styles.detailWide}><strong>Ultima transferencia:</strong> {detailItem.lastTransferId ?? "-"}</div>
              </div>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
