"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { assignWarehouseAddress, clearWarehouseAddress, fetchWarehouseMap } from "./api";
import type { Prateleira, StockCenterOption, WarehouseConfiguracao, WarehouseMaterial } from "./types";
import {
  floorOccupancyStatus,
  formatQuantity,
  materialStatus,
  positionCode,
} from "./utils";
import styles from "./WarehouseAddressing.module.css";

type AssignmentDraft = {
  materialId: string;
  coluna: string;
  linha: number;
  andar: number;
  posicao: number;
  expectedUpdatedAt: string | null;
};

function statusLabel(status: ReturnType<typeof materialStatus>) {
  if (status === "vago") return "Vago";
  if (status === "baixo") return "Baixo";
  if (status === "lotado") return "Lotado";
  return "OK";
}

export function WarehouseAddressingMapPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("mapa_almoxarifado");
  const accessToken = session?.accessToken ?? null;

  const [stockCenters, setStockCenters] = useState<StockCenterOption[]>([]);
  const [stockCenterId, setStockCenterId] = useState("");
  const [config, setConfig] = useState<WarehouseConfiguracao | null>(null);
  const [materials, setMaterials] = useState<WarehouseMaterial[]>([]);
  const [selectedShelf, setSelectedShelf] = useState<Prateleira | null>(null);
  const [selectedFloor, setSelectedFloor] = useState(1);
  const [selectedMaterial, setSelectedMaterial] = useState<WarehouseMaterial | null>(null);
  const [search, setSearch] = useState("");
  const [assignmentDraft, setAssignmentDraft] = useState<AssignmentDraft | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const materialByPosition = useMemo(() => {
    const map = new Map<string, WarehouseMaterial>();
    for (const material of materials) {
      if (material.coluna && material.linha && material.andar && material.posicao) {
        map.set(positionCode(material.coluna, material.linha, material.andar, material.posicao), material);
      }
    }
    return map;
  }, [materials]);

  const unaddressedMaterials = useMemo(
    () => materials.filter((material) => !material.coluna && material.quantidade > 0),
    [materials],
  );

  const highlightedMaterialIds = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return new Set<string>();
    return new Set(
      materials
        .filter((material) =>
          material.codigo.toLowerCase().includes(normalized)
          || material.nome.toLowerCase().includes(normalized),
        )
        .map((material) => material.id),
    );
  }, [materials, search]);

  async function loadMap(nextStockCenterId = stockCenterId) {
    if (!accessToken) return;

    setIsLoading(true);
    try {
      const data = await fetchWarehouseMap({ accessToken, stockCenterId: nextStockCenterId || null });
      const centers = data.stockCenters ?? [];
      setStockCenters(centers);
      const resolvedCenterId = nextStockCenterId || centers[0]?.id || "";
      setStockCenterId(resolvedCenterId);

      if (resolvedCenterId && !nextStockCenterId) {
        const secondLoad = await fetchWarehouseMap({ accessToken, stockCenterId: resolvedCenterId });
        setConfig(secondLoad.configuracao ?? null);
        setMaterials(secondLoad.materiais ?? []);
      } else {
        setConfig(data.configuracao ?? null);
        setMaterials(data.materiais ?? []);
      }
      setFeedback(null);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar mapa." });
      await logError("Falha ao carregar mapa do almoxarifado.", error, { stockCenterId: nextStockCenterId });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadMap("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  function openAssignment(material: WarehouseMaterial, shelf?: Prateleira, floor?: number, position?: number) {
    const targetShelf = shelf ?? selectedShelf ?? config?.prateleiras[0] ?? null;
    const targetFloor = floor ?? targetShelf?.andares[0]?.numero ?? 1;
    setAssignmentDraft({
      materialId: material.id,
      coluna: targetShelf?.coluna ?? material.coluna ?? "",
      linha: targetShelf?.linha ?? material.linha ?? 1,
      andar: targetFloor,
      posicao: position ?? material.posicao ?? 1,
      expectedUpdatedAt: material.enderecoUpdatedAt,
    });
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !config || !assignmentDraft) return;

    setIsSaving(true);
    try {
      const response = await assignWarehouseAddress({
        accessToken,
        mapId: config.id,
        ...assignmentDraft,
      });
      setFeedback({ type: "success", message: response.message ?? "Endereco atribuido com sucesso." });
      setAssignmentDraft(null);
      await loadMap(stockCenterId);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao atribuir endereco." });
      await logError("Falha ao atribuir endereco no mapa.", error, assignmentDraft);
    } finally {
      setIsSaving(false);
    }
  }

  async function removeAddress(material: WarehouseMaterial) {
    if (!accessToken || !config || !material.enderecoUpdatedAt) return;

    setIsSaving(true);
    try {
      const response = await clearWarehouseAddress({
        accessToken,
        mapId: config.id,
        materialId: material.id,
        expectedUpdatedAt: material.enderecoUpdatedAt,
      });
      setFeedback({ type: "success", message: response.message ?? "Endereco removido com sucesso." });
      setSelectedMaterial(null);
      await loadMap(stockCenterId);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao remover endereco." });
      await logError("Falha ao remover endereco do mapa.", error, { materialId: material.id });
    } finally {
      setIsSaving(false);
    }
  }

  function renderShelfContent(shelf: Prateleira) {
    const floor = shelf.andares.find((item) => item.numero === selectedFloor) ?? shelf.andares[0];
    if (!floor || selectedShelf?.id !== shelf.id) {
      return <strong>{shelf.coluna}{shelf.linha}</strong>;
    }

    return (
      <div className={styles.positionList}>
        {Array.from({ length: floor.qtdPosicoes }, (_, index) => {
          const posicao = index + 1;
          const code = positionCode(shelf.coluna, shelf.linha, floor.numero, posicao);
          const material = materialByPosition.get(code) ?? null;
          return (
            <button
              type="button"
              key={code}
              className={`${styles.positionButton} ${styles[materialStatus(material)]}`}
              onClick={(event) => {
                event.stopPropagation();
                if (material) {
                  setSelectedMaterial(material);
                } else if (assignmentDraft) {
                  setAssignmentDraft((current) => current ? {
                    ...current,
                    coluna: shelf.coluna,
                    linha: shelf.linha,
                    andar: floor.numero,
                    posicao,
                  } : current);
                }
              }}
            >
              <span>{code}</span>
              <strong>{material ? material.codigo : "Vaga"}</strong>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? <div className={`${styles.feedback} ${styles[feedback.type]}`}>{feedback.message}</div> : null}

      <article className={styles.card}>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Centro de estoque</span>
            <select
              value={stockCenterId}
              onChange={(event) => {
                setStockCenterId(event.target.value);
                void loadMap(event.target.value);
              }}
              disabled={isLoading || isSaving}
            >
              <option value="">Selecione</option>
              {stockCenters.map((center) => (
                <option key={center.id} value={center.id}>{center.name}</option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Busca</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Codigo ou nome" />
          </label>
        </div>
      </article>

      {!config ? (
        <article className={styles.card}>
          <p className={styles.muted}>{isLoading ? "Carregando mapa..." : "Nenhum mapa configurado para este centro de estoque."}</p>
        </article>
      ) : (
        <div className={styles.mapLayout}>
          <article className={styles.card}>
            <div className={styles.legend}>
              <span><i className={styles.dotEmpty} /> Vago</span>
              <span><i className={styles.dotPartial} /> Parcial</span>
              <span><i className={styles.dotFull} /> Ocupado</span>
              <span><i className={styles.floorLegend} /> Chao</span>
            </div>

            <div className={styles.gridScroll}>
              <div className={styles.addressGrid} style={{ gridTemplateColumns: `repeat(${config.colunas.length}, minmax(128px, 1fr))` }}>
                {config.linhas.flatMap((linha) =>
                  config.colunas.map((coluna) => {
                    const shelf = config.prateleiras.find((item) => item.coluna === coluna && item.linha === linha) ?? null;
                    if (!shelf) {
                      return (
                        <div key={`${coluna}-${linha}`} className={`${styles.gridCell} ${styles.floorCell}`}>
                          <strong>{coluna}{linha}</strong>
                          <span>Chao</span>
                        </div>
                      );
                    }

                    const isHighlighted = materials.some(
                      (material) => highlightedMaterialIds.has(material.id) && material.coluna === coluna && material.linha === linha,
                    );

                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        key={shelf.id}
                        className={`${styles.gridCell} ${styles.shelfCell} ${selectedShelf?.id === shelf.id ? styles.selectedCell : ""} ${isHighlighted ? styles.highlightCell : ""}`}
                        onClick={() => {
                          setSelectedShelf(shelf);
                          setSelectedFloor(shelf.andares[0]?.numero ?? 1);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedShelf(shelf);
                            setSelectedFloor(shelf.andares[0]?.numero ?? 1);
                          }
                        }}
                      >
                        <div className={styles.floorDots}>
                          {shelf.andares.map((floor) => (
                            <button
                              type="button"
                              key={floor.numero}
                              className={`${styles.floorDot} ${styles[floorOccupancyStatus(shelf, floor.numero, materials)]}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedShelf(shelf);
                                setSelectedFloor(floor.numero);
                              }}
                              aria-label={`Andar ${floor.numero} da prateleira ${shelf.coluna}${shelf.linha}`}
                            />
                          ))}
                        </div>
                        {renderShelfContent(shelf)}
                      </div>
                    );
                  }),
                )}
              </div>
            </div>
          </article>

          <aside className={styles.card}>
            <h3 className={styles.cardTitle}>Detalhe</h3>
            {selectedMaterial ? (
              <div className={styles.sidePanel}>
                <strong>{selectedMaterial.codigo}</strong>
                <span>{selectedMaterial.nome}</span>
                <span>{formatQuantity(selectedMaterial.quantidade, selectedMaterial.unidade)}</span>
                <span>Minimo: {formatQuantity(selectedMaterial.estoqueMinimo, selectedMaterial.unidade)}</span>
                <span>Maximo: {selectedMaterial.estoqueMaximo === null ? "-" : formatQuantity(selectedMaterial.estoqueMaximo, selectedMaterial.unidade)}</span>
                <span>Status: {statusLabel(materialStatus(selectedMaterial))}</span>
                {selectedMaterial.coluna && selectedMaterial.linha && selectedMaterial.andar && selectedMaterial.posicao ? (
                  <span>{positionCode(selectedMaterial.coluna, selectedMaterial.linha, selectedMaterial.andar, selectedMaterial.posicao)}</span>
                ) : null}
                <div className={styles.actions}>
                  <button type="button" className={styles.secondaryButton} onClick={() => openAssignment(selectedMaterial)} disabled={isSaving}>
                    Realocar
                  </button>
                  {selectedMaterial.enderecoUpdatedAt ? (
                    <button type="button" className={styles.dangerButton} onClick={() => void removeAddress(selectedMaterial)} disabled={isSaving}>
                      Remover endereco
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className={styles.muted}>Selecione uma posicao ocupada para ver detalhes.</p>
            )}

            <h3 className={styles.cardTitle}>Sem endereco</h3>
            <div className={styles.unaddressedList}>
              {unaddressedMaterials.map((material) => (
                <button key={material.id} type="button" className={styles.materialListItem} onClick={() => openAssignment(material)}>
                  <strong>{material.codigo}</strong>
                  <span>{material.nome}</span>
                  <small>{formatQuantity(material.quantidade, material.unidade)}</small>
                </button>
              ))}
              {unaddressedMaterials.length === 0 ? <p className={styles.muted}>Nenhum material com saldo sem endereco.</p> : null}
            </div>
          </aside>
        </div>
      )}

      {assignmentDraft && config ? (
        <div className={styles.modalOverlay}>
          <form className={styles.modalCard} onSubmit={submitAssignment}>
            <header className={styles.modalHeader}>
              <h3>Atribuir endereco</h3>
              <button type="button" className={styles.ghostButton} onClick={() => setAssignmentDraft(null)}>Fechar</button>
            </header>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Prateleira</span>
                <select
                  value={`${assignmentDraft.coluna}-${assignmentDraft.linha}`}
                  onChange={(event) => {
                    const shelf = config.prateleiras.find((item) => `${item.coluna}-${item.linha}` === event.target.value);
                    if (!shelf) return;
                    setAssignmentDraft((current) => current ? {
                      ...current,
                      coluna: shelf.coluna,
                      linha: shelf.linha,
                      andar: shelf.andares[0]?.numero ?? 1,
                      posicao: 1,
                    } : current);
                  }}
                >
                  {config.prateleiras.map((shelf) => (
                    <option key={shelf.id} value={`${shelf.coluna}-${shelf.linha}`}>{shelf.coluna}{shelf.linha}</option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Andar</span>
                <input
                  type="number"
                  min="1"
                  value={assignmentDraft.andar}
                  onChange={(event) => setAssignmentDraft((current) => current ? { ...current, andar: Number(event.target.value) } : current)}
                />
              </label>

              <label className={styles.field}>
                <span>Posicao</span>
                <input
                  type="number"
                  min="1"
                  value={assignmentDraft.posicao}
                  onChange={(event) => setAssignmentDraft((current) => current ? { ...current, posicao: Number(event.target.value) } : current)}
                />
              </label>
            </div>

            <div className={styles.actions}>
              <button type="submit" className={styles.primaryButton} disabled={isSaving}>
                {isSaving ? "Salvando..." : "Salvar endereco"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
