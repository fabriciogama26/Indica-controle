"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import {
  DEFAULT_COLUMN_COUNT,
  DEFAULT_LINE_COUNT,
  MAX_COLUMN_COUNT,
  MAX_FLOORS,
  MAX_LINE_COUNT,
  MAX_POSITIONS_PER_FLOOR,
} from "./constants";
import { fetchWarehouseConfig, saveWarehouseConfig, WarehouseMapConflictError } from "./api";
import type { ConfiguracaoMapa, Prateleira, StockCenterOption, StorageType, StorageTypeOption, WarehouseConfiguracao, WarehouseConflict } from "./types";
import {
  buildColumnLabels,
  buildDefaultShelf,
  buildLineLabels,
  countPositions,
  DEFAULT_STORAGE_TYPE_OPTIONS,
  findShelf,
  normalizeStorageFloors,
  shelfKey,
  storageTypeLabel,
  storageTypeUsesFloors,
} from "./utils";
import styles from "./WarehouseAddressing.module.css";

function emptyConfig(): ConfiguracaoMapa {
  return {
    colunas: buildColumnLabels(DEFAULT_COLUMN_COUNT),
    linhas: buildLineLabels(DEFAULT_LINE_COUNT),
    prateleiras: [],
  };
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function WarehouseMapConfigPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("configuracao_mapa_almoxarifado");
  const accessToken = session?.accessToken ?? null;

  const [stockCenters, setStockCenters] = useState<StockCenterOption[]>([]);
  const [storageTypes, setStorageTypes] = useState<StorageTypeOption[]>(DEFAULT_STORAGE_TYPE_OPTIONS);
  const [stockCenterId, setStockCenterId] = useState("");
  const [persistedConfig, setPersistedConfig] = useState<WarehouseConfiguracao | null>(null);
  const [config, setConfig] = useState<ConfiguracaoMapa>(emptyConfig);
  const [selectedShelfKey, setSelectedShelfKey] = useState<string | null>(null);
  const [selectedStorageType, setSelectedStorageType] = useState<StorageType>("SHELF");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [conflicts, setConflicts] = useState<WarehouseConflict[]>([]);

  const selectedShelf = useMemo(() => {
    if (!selectedShelfKey) return null;
    return config.prateleiras.find((shelf) => shelfKey(shelf.coluna, shelf.linha) === selectedShelfKey) ?? null;
  }, [config.prateleiras, selectedShelfKey]);

  useEffect(() => {
    const token = accessToken;
    if (!token) return;

    let active = true;
    async function loadInitial(tokenValue: string) {
      setIsLoading(true);
      try {
        const data = await fetchWarehouseConfig({ accessToken: tokenValue });
        if (!active) return;
        const centers = data.stockCenters ?? [];
        const nextStorageTypes = data.storageTypes?.length ? data.storageTypes : DEFAULT_STORAGE_TYPE_OPTIONS;
        setStockCenters(centers);
        setStorageTypes(nextStorageTypes);
        setSelectedStorageType((current) => nextStorageTypes.some((option) => option.code === current) ? current : nextStorageTypes[0]?.code ?? "SHELF");
        const firstCenterId = centers[0]?.id ?? "";
        setStockCenterId((current) => current || firstCenterId);
      } catch (error) {
        if (active) setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar centros." });
        await logError("Falha ao carregar centros para configuracao do mapa.", error);
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadInitial(token);
    return () => {
      active = false;
    };
  }, [accessToken, logError]);

  useEffect(() => {
    const token = accessToken;
    if (!token || !stockCenterId) return;

    let active = true;
    async function loadConfig(tokenValue: string) {
      setIsLoading(true);
      try {
        const data = await fetchWarehouseConfig({ accessToken: tokenValue, stockCenterId });
        if (!active) return;
        const nextConfig = data.configuracao ?? null;
        const nextStorageTypes = data.storageTypes?.length ? data.storageTypes : DEFAULT_STORAGE_TYPE_OPTIONS;
        setStorageTypes(nextStorageTypes);
        setSelectedStorageType((current) => nextStorageTypes.some((option) => option.code === current) ? current : nextStorageTypes[0]?.code ?? "SHELF");
        setPersistedConfig(nextConfig);
        setConfig(nextConfig ?? emptyConfig());
        setSelectedShelfKey(null);
        setFeedback(null);
        setConflicts([]);
      } catch (error) {
        if (active) setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar mapa." });
        await logError("Falha ao carregar configuracao do mapa.", error, { stockCenterId });
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadConfig(token);
    return () => {
      active = false;
    };
  }, [accessToken, logError, stockCenterId]);

  function resizeGrid(columnCount: number, lineCount: number) {
    const colunas = buildColumnLabels(clamp(columnCount, 1, MAX_COLUMN_COUNT));
    const linhas = buildLineLabels(clamp(lineCount, 1, MAX_LINE_COUNT));
    const colunaSet = new Set(colunas);
    const linhaSet = new Set(linhas);

    setConfig((current) => ({
      colunas,
      linhas,
      prateleiras: current.prateleiras.filter((shelf) => colunaSet.has(shelf.coluna) && linhaSet.has(shelf.linha)),
    }));
    setSelectedShelfKey(null);
  }

  function toggleStorage(coluna: string, linha: number) {
    const key = shelfKey(coluna, linha);
    const currentShelf = findShelf(config, coluna, linha);
    if (currentShelf && selectedShelfKey !== key) {
      setSelectedShelfKey(key);
      return;
    }

    setConfig((current) => {
      const exists = findShelf(current, coluna, linha);
      if (exists) {
        return {
          ...current,
          prateleiras: current.prateleiras.filter((shelf) => shelfKey(shelf.coluna, shelf.linha) !== shelfKey(coluna, linha)),
        };
      }
      return {
        ...current,
        prateleiras: [...current.prateleiras, buildDefaultShelf(coluna, linha, selectedStorageType)],
      };
    });
    setSelectedShelfKey(currentShelf ? null : key);
  }

  function updateStorageType(shelf: Prateleira, tipo: StorageType) {
    setConfig((current) => ({
      ...current,
      prateleiras: current.prateleiras.map((item) => {
        if (item.id !== shelf.id) return item;
        return {
          ...item,
          tipo,
          andares: normalizeStorageFloors(tipo, item.andares, storageTypes),
        };
      }),
    }));
  }

  function updateShelfFloors(shelf: Prateleira, floorCount: number) {
    const nextCount = clamp(floorCount, 1, MAX_FLOORS);
    setConfig((current) => ({
      ...current,
      prateleiras: current.prateleiras.map((item) => {
        if (item.id !== shelf.id) return item;
        return {
          ...item,
          andares: Array.from({ length: nextCount }, (_, index) => {
            const numero = index + 1;
            return item.andares.find((floor) => floor.numero === numero) ?? { numero, qtdPosicoes: 1 };
          }),
        };
      }),
    }));
  }

  function updateFloorPositions(shelf: Prateleira, floorNumber: number, qtdPosicoes: number) {
    setConfig((current) => ({
      ...current,
      prateleiras: current.prateleiras.map((item) => {
        if (item.id !== shelf.id) return item;
        return {
          ...item,
          andares: item.andares.map((floor) =>
            floor.numero === floorNumber
              ? { ...floor, qtdPosicoes: clamp(qtdPosicoes, 1, MAX_POSITIONS_PER_FLOOR) }
              : floor,
          ),
        };
      }),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !stockCenterId) {
      setFeedback({ type: "error", message: "Sessao ou centro de estoque invalido." });
      return;
    }

    setIsSaving(true);
    setConflicts([]);
    try {
      const result = await saveWarehouseConfig({
        accessToken,
        stockCenterId,
        config,
        expectedUpdatedAt: persistedConfig?.updatedAt ?? null,
      });
      setPersistedConfig({
        id: result.mapId ?? persistedConfig?.id ?? "",
        stockCenterId,
        updatedAt: result.updatedAt ?? persistedConfig?.updatedAt ?? "",
        ...config,
      });
      setFeedback({ type: "success", message: result.message ?? "Configuracao salva com sucesso." });
    } catch (error) {
      if (error instanceof WarehouseMapConflictError) {
        setConflicts(error.conflicts);
      }
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao salvar mapa." });
      await logError("Falha ao salvar configuracao do mapa.", error, { stockCenterId });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? <div className={`${styles.feedback} ${styles[feedback.type]}`}>{feedback.message}</div> : null}

      {conflicts.length > 0 ? (
        <article className={styles.card}>
          <h3 className={styles.cardTitle}>Materiais bloqueando o novo layout</h3>
          <p className={styles.muted}>
            Estes materiais ficariam sem posicao valida com o layout atual. Va em &quot;Mapa do Almoxarifado&quot; e use
            &quot;Limpar posicao&quot; na celula correspondente (ou realoque o material) antes de salvar novamente.
          </p>
          <ul>
            {conflicts.map((conflict) => (
              <li key={`${conflict.materialId}-${conflict.coluna}-${conflict.linha}-${conflict.andar}-${conflict.posicao}`}>
                {conflict.codigo} — posicao {conflict.coluna}{conflict.linha}.{conflict.andar}.{conflict.posicao}
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      <article className={styles.card}>
        <h3 className={styles.cardTitle}>Configuracao do mapa</h3>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Centro de estoque</span>
            <select value={stockCenterId} onChange={(event) => setStockCenterId(event.target.value)} disabled={isLoading || isSaving}>
              <option value="">Selecione</option>
              {stockCenters.map((center) => (
                <option key={center.id} value={center.id}>{center.name}</option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>Colunas</span>
            <input
              type="number"
              min="1"
              max={MAX_COLUMN_COUNT}
              value={config.colunas.length}
              onChange={(event) => resizeGrid(Number(event.target.value), config.linhas.length)}
            />
          </label>

          <label className={styles.field}>
            <span>Linhas</span>
            <input
              type="number"
              min="1"
              max={MAX_LINE_COUNT}
              value={config.linhas.length}
              onChange={(event) => resizeGrid(config.colunas.length, Number(event.target.value))}
            />
          </label>

          <label className={styles.field}>
            <span>Tipo ao adicionar</span>
            <select value={selectedStorageType} onChange={(event) => setSelectedStorageType(event.target.value as StorageType)}>
              {storageTypes.map((type) => (
                <option key={type.code} value={type.code}>{type.label}</option>
              ))}
            </select>
          </label>
        </div>
      </article>

      <form className={styles.mapLayout} onSubmit={handleSubmit}>
        <article className={styles.card}>
          <div className={styles.summaryBar}>
            <strong>{config.prateleiras.length} prateleira(s)</strong>
            <strong>{countPositions(config)} posicao(oes)</strong>
          </div>

          <div className={styles.gridScroll}>
            <div className={styles.addressGrid} style={{ gridTemplateColumns: `repeat(${config.colunas.length}, minmax(96px, 1fr))` }}>
              {config.linhas.flatMap((linha) =>
                config.colunas.map((coluna) => {
                  const shelf = findShelf(config, coluna, linha);
                  const key = shelfKey(coluna, linha);
                  return (
                    <button
                      type="button"
                      key={key}
                      className={`${styles.gridCell} ${shelf ? styles.shelfCell : styles.floorCell} ${shelf?.tipo === "PALLET" ? styles.palletCell : ""} ${shelf?.tipo === "BAIA" ? styles.bayCell : ""} ${selectedShelfKey === key ? styles.selectedCell : ""}`}
                      onClick={() => {
                        toggleStorage(coluna, linha);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleStorage(coluna, linha);
                        }
                      }}
                      aria-label={`${shelf ? "Remover" : "Adicionar"} ${shelf ? storageTypeLabel(shelf.tipo, storageTypes).toLowerCase() : storageTypeLabel(selectedStorageType, storageTypes).toLowerCase()} ${coluna}${linha}`}
                    >
                      <strong>{coluna}{linha}</strong>
                      <span>{shelf ? storageTypeLabel(shelf.tipo, storageTypes) : "Chao"}</span>
                    </button>
                  );
                }),
              )}
            </div>
          </div>
        </article>

        <aside className={styles.card}>
          <h3 className={styles.cardTitle}>Prateleira selecionada</h3>
          {selectedShelf ? (
            <div className={styles.sidePanel}>
              <strong>{selectedShelf.coluna}{selectedShelf.linha}</strong>
              <label className={styles.field}>
                <span>Tipo</span>
                <select value={selectedShelf.tipo} onChange={(event) => updateStorageType(selectedShelf, event.target.value as StorageType)}>
                  {storageTypes.map((type) => (
                    <option key={type.code} value={type.code}>{type.label}</option>
                  ))}
                </select>
              </label>

              {!storageTypeUsesFloors(selectedShelf.tipo, storageTypes) ? (
                <label className={styles.field}>
                  <span>Quantidade de posicoes</span>
                  <input
                    type="number"
                    min="1"
                    max={MAX_POSITIONS_PER_FLOOR}
                    value={selectedShelf.andares[0]?.qtdPosicoes ?? 1}
                    onChange={(event) => updateFloorPositions(selectedShelf, 1, Number(event.target.value))}
                  />
                </label>
              ) : (
                <>
              <label className={styles.field}>
                <span>Quantidade de andares</span>
                <input
                  type="number"
                  min="1"
                  max={MAX_FLOORS}
                  value={selectedShelf.andares.length}
                  onChange={(event) => updateShelfFloors(selectedShelf, Number(event.target.value))}
                />
              </label>

              {selectedShelf.andares.map((floor) => (
                <label key={floor.numero} className={styles.field}>
                  <span>Andar {floor.numero} - posicoes</span>
                  <input
                    type="number"
                    min="1"
                    max={MAX_POSITIONS_PER_FLOOR}
                    value={floor.qtdPosicoes}
                    onChange={(event) => updateFloorPositions(selectedShelf, floor.numero, Number(event.target.value))}
                  />
                </label>
              ))}
                </>
              )}
            </div>
          ) : (
            <p className={styles.muted}>Clique em uma prateleira ou pallet para configurar o endereco.</p>
          )}

          <div className={styles.actions}>
            <button type="submit" className={styles.primaryButton} disabled={isSaving || !stockCenterId}>
              {isSaving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </aside>
      </form>
    </section>
  );
}
