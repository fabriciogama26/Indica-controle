"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { DEFAULT_COLUMN_COUNT, DEFAULT_LINE_COUNT, MAX_FLOORS, MAX_GRID_SIZE, MAX_POSITIONS_PER_FLOOR } from "./constants";
import { fetchWarehouseConfig, saveWarehouseConfig } from "./api";
import type { ConfiguracaoMapa, Prateleira, StockCenterOption, WarehouseConfiguracao } from "./types";
import { buildColumnLabels, buildDefaultShelf, buildLineLabels, countPositions, findShelf, shelfKey } from "./utils";
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
  const [stockCenterId, setStockCenterId] = useState("");
  const [persistedConfig, setPersistedConfig] = useState<WarehouseConfiguracao | null>(null);
  const [config, setConfig] = useState<ConfiguracaoMapa>(emptyConfig);
  const [selectedShelfKey, setSelectedShelfKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

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
        setStockCenters(centers);
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
        setPersistedConfig(nextConfig);
        setConfig(nextConfig ?? emptyConfig());
        setSelectedShelfKey(null);
        setFeedback(null);
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
    const colunas = buildColumnLabels(clamp(columnCount, 1, MAX_GRID_SIZE));
    const linhas = buildLineLabels(clamp(lineCount, 1, MAX_GRID_SIZE));
    const colunaSet = new Set(colunas);
    const linhaSet = new Set(linhas);

    setConfig((current) => ({
      colunas,
      linhas,
      prateleiras: current.prateleiras.filter((shelf) => colunaSet.has(shelf.coluna) && linhaSet.has(shelf.linha)),
    }));
    setSelectedShelfKey(null);
  }

  function toggleShelf(coluna: string, linha: number) {
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
        prateleiras: [...current.prateleiras, buildDefaultShelf(coluna, linha)],
      };
    });
    setSelectedShelfKey(currentShelf ? null : key);
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
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao salvar mapa." });
      await logError("Falha ao salvar configuracao do mapa.", error, { stockCenterId });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className={styles.wrapper}>
      {feedback ? <div className={`${styles.feedback} ${styles[feedback.type]}`}>{feedback.message}</div> : null}

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
              max={MAX_GRID_SIZE}
              value={config.colunas.length}
              onChange={(event) => resizeGrid(Number(event.target.value), config.linhas.length)}
            />
          </label>

          <label className={styles.field}>
            <span>Linhas</span>
            <input
              type="number"
              min="1"
              max={MAX_GRID_SIZE}
              value={config.linhas.length}
              onChange={(event) => resizeGrid(config.colunas.length, Number(event.target.value))}
            />
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
                      className={`${styles.gridCell} ${shelf ? styles.shelfCell : styles.floorCell} ${selectedShelfKey === key ? styles.selectedCell : ""}`}
                      onClick={() => {
                        toggleShelf(coluna, linha);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleShelf(coluna, linha);
                        }
                      }}
                      aria-label={`${shelf ? "Remover" : "Adicionar"} prateleira ${coluna}${linha}`}
                    >
                      <strong>{coluna}{linha}</strong>
                      <span>{shelf ? "Prateleira" : "Chao"}</span>
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
            </div>
          ) : (
            <p className={styles.muted}>Clique em uma prateleira para configurar andares e posicoes.</p>
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
