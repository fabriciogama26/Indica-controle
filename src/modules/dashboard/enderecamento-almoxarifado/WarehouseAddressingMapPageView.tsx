"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { ActionIcon } from "@/components/ui/ActionIcon";
import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";
import { parseCsvLine } from "@/lib/utils/parsers";
import { MAX_BULK_ASSIGNMENTS } from "./constants";
import { assignWarehouseAddress, assignWarehouseAddressBatch, clearWarehouseAddress, clearWarehouseCellAddresses, fetchWarehouseMap } from "./api";
import type { Prateleira, StockCenterOption, StorageTypeOption, WarehouseAddressEntry, WarehouseConfiguracao, WarehouseMaterial } from "./types";
import {
  clamp,
  DEFAULT_STORAGE_TYPE_OPTIONS,
  floorOccupancyCounts,
  formatQuantity,
  materialStatus,
  positionCode,
  storageTypeLabel,
  storageTypeUsesFloors,
} from "./utils";
import styles from "./WarehouseAddressing.module.css";

type AssignmentDraft = {
  materialId: string;
  addressId: string | null;
  coluna: string;
  linha: number;
  andar: number;
  posicao: number;
  expectedUpdatedAt: string | null;
};

type BulkAssignmentItem = {
  material: WarehouseMaterial;
  coluna: string;
  linha: number;
  andar: number;
  posicao: number;
};

type BulkImportResult = {
  status: "success" | "error";
  message: string;
  rows: number;
};

function statusLabel(status: ReturnType<typeof materialStatus>) {
  if (status === "vago") return "Vago";
  if (status === "baixo") return "Baixo";
  if (status === "lotado") return "Lotado";
  return "OK";
}

function normalizeImportValue(value: string) {
  return value.trim().replace(/^\uFEFF/, "");
}

function normalizeImportHeader(value: string) {
  return normalizeImportValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parsePositiveInteger(value: string) {
  const parsed = Number.parseInt(normalizeImportValue(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function WarehouseAddressingMapPageView() {
  const { session } = useAuth();
  const logError = useErrorLogger("mapa_almoxarifado");
  const accessToken = session?.accessToken ?? null;

  const [stockCenters, setStockCenters] = useState<StockCenterOption[]>([]);
  const [storageTypes, setStorageTypes] = useState<StorageTypeOption[]>(DEFAULT_STORAGE_TYPE_OPTIONS);
  const [stockCenterId, setStockCenterId] = useState("");
  const [config, setConfig] = useState<WarehouseConfiguracao | null>(null);
  const [materials, setMaterials] = useState<WarehouseMaterial[]>([]);
  const [selectedShelf, setSelectedShelf] = useState<Prateleira | null>(null);
  const [selectedFloor, setSelectedFloor] = useState(1);
  const [selectedMaterial, setSelectedMaterial] = useState<WarehouseMaterial | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<WarehouseAddressEntry | null>(null);
  const [search, setSearch] = useState("");
  const [unaddressedSearch, setUnaddressedSearch] = useState("");
  const [assignmentDraft, setAssignmentDraft] = useState<AssignmentDraft | null>(null);
  const [bulkDraft, setBulkDraft] = useState<BulkAssignmentItem[] | null>(null);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [bulkImportFile, setBulkImportFile] = useState<File | null>(null);
  const [bulkImportResult, setBulkImportResult] = useState<BulkImportResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [clearCellConfirm, setClearCellConfirm] = useState<Prateleira | null>(null);

  const materialByPosition = useMemo(() => {
    const map = new Map<string, { material: WarehouseMaterial; address: WarehouseAddressEntry }>();
    for (const material of materials) {
      for (const address of material.enderecos) {
        map.set(positionCode(address.coluna, address.linha, address.andar, address.posicao), { material, address });
      }
    }
    return map;
  }, [materials]);

  const addressesInSelectedShelf = useMemo(() => {
    if (!selectedShelf) return [];
    return materials.flatMap((material) =>
      material.enderecos
        .filter((address) => address.coluna === selectedShelf.coluna && address.linha === selectedShelf.linha)
        .map((address) => ({ material, address })),
    );
  }, [materials, selectedShelf]);

  const addressableMaterials = useMemo(
    () => materials.filter((material) => material.quantidade > 0),
    [materials],
  );

  const filteredAddressableMaterials = useMemo(() => {
    const normalized = unaddressedSearch.trim().toLowerCase();
    if (!normalized) return addressableMaterials;

    return addressableMaterials.filter((material) =>
      material.codigo.toLowerCase().includes(normalized)
      || material.nome.toLowerCase().includes(normalized)
      || material.unidade.toLowerCase().includes(normalized),
    );
  }, [addressableMaterials, unaddressedSearch]);

  const availablePositions = useMemo(() => {
    if (!config) return [];

    return config.prateleiras
      .flatMap((shelf) =>
        shelf.andares.flatMap((floor) =>
          Array.from({ length: floor.qtdPosicoes }, (_, index) => ({
            coluna: shelf.coluna,
            linha: shelf.linha,
            andar: floor.numero,
            posicao: index + 1,
            tipo: shelf.tipo,
            code: positionCode(shelf.coluna, shelf.linha, floor.numero, index + 1),
          })),
        ),
      )
      .filter((position) => !materialByPosition.has(position.code));
  }, [config, materialByPosition]);

  const availablePositionByCode = useMemo(
    () => new Map(availablePositions.map((position) => [position.code, position])),
    [availablePositions],
  );

  const addressableMaterialByCode = useMemo(
    () => new Map(addressableMaterials.map((material) => [material.codigo.trim().toUpperCase(), material])),
    [addressableMaterials],
  );

  const assignmentShelf = useMemo(() => {
    if (!assignmentDraft || !config) return null;
    return config.prateleiras.find((shelf) => shelf.coluna === assignmentDraft.coluna && shelf.linha === assignmentDraft.linha) ?? null;
  }, [assignmentDraft, config]);

  const assignmentUsesFloors = assignmentShelf ? storageTypeUsesFloors(assignmentShelf.tipo, storageTypes) : true;

  const assignmentFloorPositions = assignmentDraft && assignmentShelf
    ? assignmentShelf.andares.find((floor) => floor.numero === assignmentDraft.andar)?.qtdPosicoes ?? 1
    : 1;

  const hasActiveSearch = search.trim().length > 0;

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
      setStorageTypes(data.storageTypes?.length ? data.storageTypes : DEFAULT_STORAGE_TYPE_OPTIONS);
      setStockCenters(centers);
      const resolvedCenterId = nextStockCenterId || centers[0]?.id || "";
      setStockCenterId(resolvedCenterId);

      if (resolvedCenterId && !nextStockCenterId) {
        const secondLoad = await fetchWarehouseMap({ accessToken, stockCenterId: resolvedCenterId });
        setStorageTypes(secondLoad.storageTypes?.length ? secondLoad.storageTypes : DEFAULT_STORAGE_TYPE_OPTIONS);
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

  function openAssignment(material: WarehouseMaterial, address?: WarehouseAddressEntry, shelf?: Prateleira, floor?: number, position?: number) {
    const targetShelf = shelf ?? selectedShelf ?? config?.prateleiras[0] ?? null;
    const targetFloor = targetShelf && !storageTypeUsesFloors(targetShelf.tipo, storageTypes)
      ? 1
      : floor ?? targetShelf?.andares[0]?.numero ?? 1;
    const targetFloorConfig = targetShelf?.andares.find((item) => item.numero === targetFloor);
    const maxPosicao = targetFloorConfig?.qtdPosicoes ?? 1;
    setAssignmentDraft({
      materialId: material.id,
      addressId: address?.id ?? null,
      coluna: targetShelf?.coluna ?? address?.coluna ?? "",
      linha: targetShelf?.linha ?? address?.linha ?? 1,
      andar: targetFloor,
      posicao: clamp(position ?? address?.posicao ?? 1, 1, maxPosicao),
      expectedUpdatedAt: address?.updatedAt ?? null,
    });
  }

  function openRealocar(material: WarehouseMaterial, address: WarehouseAddressEntry) {
    const shelf = config?.prateleiras.find((item) => item.coluna === address.coluna && item.linha === address.linha);
    openAssignment(material, address, shelf, address.andar, address.posicao);
  }

  function openBulkAssignment() {
    setBulkDraft(null);
    setBulkImportFile(null);
    setBulkImportResult(null);
    setIsBulkImportOpen(true);
  }

  function closeBulkImport() {
    if (isSaving) return;
    setIsBulkImportOpen(false);
    setBulkDraft(null);
    setBulkImportFile(null);
    setBulkImportResult(null);
  }

  function downloadBulkTemplate() {
    const quantity = Math.min(filteredAddressableMaterials.length, availablePositions.length, MAX_BULK_ASSIGNMENTS);
    const rows = Array.from({ length: quantity }, (_, index) => {
      const material = filteredAddressableMaterials[index];
      const position = availablePositions[index];
      return [
        material.codigo,
        material.nome,
        material.unidade || "SEM UMB",
        formatQuantity(material.quantidade, material.unidade),
        position.coluna,
        position.linha,
        position.andar,
        position.posicao,
      ];
    });

    const csv = buildCsvContent(["codigo", "descricao", "umb", "quantidade", "coluna", "linha", "andar", "posicao"], rows);
    downloadCsvFile(csv, "modelo_enderecamento_massa_almoxarifado.csv");
  }

  async function prepareBulkImport() {
    if (!bulkImportFile) return;

    setBulkImportResult(null);
    try {
      const content = await bulkImportFile.text();
      const lines = content.split(/\r?\n/).filter((line) => normalizeImportValue(line));
      if (lines.length < 2) {
        setBulkImportResult({ status: "error", message: "Arquivo CSV sem linhas de dados.", rows: 0 });
        return;
      }

      const headers = parseCsvLine(lines[0] ?? "").map(normalizeImportHeader);
      const requiredHeaders = ["codigo", "coluna", "linha", "posicao"];
      const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
      if (missingHeaders.length) {
        setBulkImportResult({ status: "error", message: `Coluna(s) obrigatoria(s) ausente(s): ${missingHeaders.join(", ")}.`, rows: 0 });
        return;
      }

      const nextDraft: BulkAssignmentItem[] = [];
      const seenPositions = new Set<string>();
      const issues: string[] = [];

      for (let index = 1; index < lines.length; index += 1) {
        const rowNumber = index + 1;
        const values = parseCsvLine(lines[index]);
        const row = headers.reduce<Record<string, string>>((accumulator, header, headerIndex) => {
          accumulator[header] = normalizeImportValue(values[headerIndex] ?? "");
          return accumulator;
        }, {});

        const codigo = row.codigo.trim().toUpperCase();
        const coluna = row.coluna.trim().toUpperCase();
        const linha = parsePositiveInteger(row.linha ?? "");
        const andar = parsePositiveInteger(row.andar ?? "1");
        const posicao = parsePositiveInteger(row.posicao ?? "");

        if (!codigo || !coluna || !linha || !andar || !posicao) {
          issues.push(`Linha ${rowNumber}: codigo, coluna, linha, posicao e andar valido quando informado sao obrigatorios.`);
          continue;
        }

        const material = addressableMaterialByCode.get(codigo);
        if (!material) {
          issues.push(`Linha ${rowNumber}: material ${codigo} nao tem saldo disponivel neste centro.`);
          continue;
        }

        const code = positionCode(coluna, linha, andar, posicao);
        if (!availablePositionByCode.has(code)) {
          issues.push(`Linha ${rowNumber}: endereco ${code} nao existe ou ja esta ocupado.`);
          continue;
        }

        if (seenPositions.has(code)) {
          issues.push(`Linha ${rowNumber}: endereco ${code} duplicado no arquivo.`);
          continue;
        }

        seenPositions.add(code);
        nextDraft.push({ material, coluna, linha, andar, posicao });
      }

      if (issues.length) {
        setBulkDraft(null);
        setBulkImportResult({
          status: "error",
          message: issues.slice(0, 4).join(" "),
          rows: nextDraft.length,
        });
        return;
      }

      if (!nextDraft.length) {
        setBulkDraft(null);
        setBulkImportResult({ status: "error", message: "Nenhum material valido foi encontrado para importar.", rows: 0 });
        return;
      }

      if (nextDraft.length > MAX_BULK_ASSIGNMENTS) {
        setBulkDraft(null);
        setBulkImportResult({ status: "error", message: `O lote pode ter no maximo ${MAX_BULK_ASSIGNMENTS} materiais.`, rows: nextDraft.length });
        return;
      }

      setBulkDraft(nextDraft);
      setBulkImportResult({ status: "success", message: "Planilha validada. Confira a pre-visualizacao antes de confirmar.", rows: nextDraft.length });
    } catch (error) {
      setBulkDraft(null);
      setBulkImportResult({ status: "error", message: "Falha ao ler o arquivo CSV.", rows: 0 });
      await logError("Falha ao preparar enderecamento em massa.", error, { fileName: bulkImportFile.name });
    }
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

  async function submitBulkAssignment() {
    if (!accessToken || !config || !bulkDraft?.length) return;

    setIsSaving(true);
    try {
      const response = await assignWarehouseAddressBatch({
        accessToken,
        mapId: config.id,
        assignments: bulkDraft.map((item) => ({
          materialId: item.material.id,
          coluna: item.coluna,
          linha: item.linha,
          andar: item.andar,
          posicao: item.posicao,
        })),
      });
      setFeedback({
        type: "success",
        message: response.message ?? `${response.assignedCount ?? bulkDraft.length} material(is) enderecado(s) com sucesso.`,
      });
      setBulkDraft(null);
      setIsBulkImportOpen(false);
      setBulkImportFile(null);
      setBulkImportResult(null);
      await loadMap(stockCenterId);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao enderecar materiais em massa." });
      await logError("Falha ao enderecar materiais em massa.", error, { count: bulkDraft.length });
    } finally {
      setIsSaving(false);
    }
  }

  async function clearCellAddresses(shelf: Prateleira) {
    if (!accessToken || !config) return;

    setClearCellConfirm(null);
    setIsSaving(true);
    try {
      const response = await clearWarehouseCellAddresses({
        accessToken,
        mapId: config.id,
        coluna: shelf.coluna,
        linha: shelf.linha,
      });
      setFeedback({ type: "success", message: response.message ?? "Posicao limpa com sucesso." });
      setSelectedMaterial(null);
      setSelectedAddress(null);
      await loadMap(stockCenterId);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao limpar materiais da posicao." });
      await logError("Falha ao limpar materiais da posicao no mapa.", error, { coluna: shelf.coluna, linha: shelf.linha });
    } finally {
      setIsSaving(false);
    }
  }

  async function removeAddress(material: WarehouseMaterial, address: WarehouseAddressEntry) {
    if (!accessToken || !config) return;

    setIsSaving(true);
    try {
      const response = await clearWarehouseAddress({
        accessToken,
        mapId: config.id,
        addressId: address.id,
        expectedUpdatedAt: address.updatedAt,
      });
      setFeedback({ type: "success", message: response.message ?? "Endereco removido com sucesso." });
      setSelectedMaterial(null);
      setSelectedAddress(null);
      await loadMap(stockCenterId);
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao remover endereco." });
      await logError("Falha ao remover endereco do mapa.", error, { materialId: material.id, addressId: address.id });
    } finally {
      setIsSaving(false);
    }
  }

  function renderShelfContent(shelf: Prateleira) {
    const floor = shelf.andares.find((item) => item.numero === selectedFloor) ?? shelf.andares[0];
    if (!floor || selectedShelf?.id !== shelf.id) {
      return (
        <>
          <strong>{shelf.coluna}{shelf.linha}</strong>
          <span>{storageTypeLabel(shelf.tipo, storageTypes)}</span>
        </>
      );
    }

    return (
      <div className={styles.positionList}>
        {Array.from({ length: floor.qtdPosicoes }, (_, index) => {
          const posicao = index + 1;
          const code = positionCode(shelf.coluna, shelf.linha, floor.numero, posicao);
          const entry = materialByPosition.get(code) ?? null;
          return (
            <button
              type="button"
              key={code}
              className={`${styles.positionButton} ${styles[materialStatus(entry?.material ?? null)]}`}
              onClick={(event) => {
                event.stopPropagation();
                if (entry) {
                  setSelectedMaterial(entry.material);
                  setSelectedAddress(entry.address);
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
              <strong>{entry ? entry.material.codigo : "Vaga"}</strong>
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
                        <div
                          key={`${coluna}-${linha}`}
                          className={`${styles.gridCell} ${styles.floorCell} ${hasActiveSearch ? styles.dimmedCell : ""}`}
                        >
                          <strong>{coluna}{linha}</strong>
                          <span>Chao</span>
                        </div>
                      );
                    }

                    const isHighlighted = materials.some(
                      (material) =>
                        highlightedMaterialIds.has(material.id)
                        && material.enderecos.some((address) => address.coluna === coluna && address.linha === linha),
                    );

                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        key={shelf.id}
                        className={`${styles.gridCell} ${styles.shelfCell} ${shelf.tipo === "PALLET" ? styles.palletCell : ""} ${shelf.tipo === "BAIA" ? styles.bayCell : ""} ${selectedShelf?.id === shelf.id ? styles.selectedCell : ""} ${isHighlighted ? styles.highlightCell : ""} ${hasActiveSearch && !isHighlighted ? styles.dimmedCell : ""}`}
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
                          {shelf.andares.map((floor) => {
                            const { occupied, total } = floorOccupancyCounts(shelf, floor.numero, materials);
                            const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
                            return (
                              <button
                                type="button"
                                key={floor.numero}
                                className={styles.floorBadge}
                                style={{
                                  background: `color-mix(in srgb, #2b74d6 ${pct}%, #e3e8f5)`,
                                  color: pct > 55 ? "#ffffff" : "#17347a",
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedShelf(shelf);
                                  setSelectedFloor(floor.numero);
                                }}
                                aria-label={`Andar ${floor.numero} da prateleira ${shelf.coluna}${shelf.linha}: ${occupied} de ${total} posicoes ocupadas`}
                              >
                                {occupied}/{total}
                              </button>
                            );
                          })}
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
            {selectedMaterial && selectedAddress ? (
              <div className={styles.sidePanel}>
                <strong>{selectedMaterial.codigo}</strong>
                <span>{selectedMaterial.nome}</span>
                <span>{formatQuantity(selectedMaterial.quantidade, selectedMaterial.unidade)}</span>
                <span>Minimo: {formatQuantity(selectedMaterial.estoqueMinimo, selectedMaterial.unidade)}</span>
                <span>Maximo: {selectedMaterial.estoqueMaximo === null ? "-" : formatQuantity(selectedMaterial.estoqueMaximo, selectedMaterial.unidade)}</span>
                <span>Status: {statusLabel(materialStatus(selectedMaterial))}</span>
                <span>{positionCode(selectedAddress.coluna, selectedAddress.linha, selectedAddress.andar, selectedAddress.posicao)}</span>
                {selectedMaterial.enderecos.length > 1 ? (
                  <span className={styles.muted}>Tambem enderecado em mais {selectedMaterial.enderecos.length - 1} posicao(oes).</span>
                ) : null}
                <div className={styles.actions}>
                  <button type="button" className={styles.secondaryButton} onClick={() => openRealocar(selectedMaterial, selectedAddress)} disabled={isSaving}>
                    Realocar
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => openAssignment(selectedMaterial)} disabled={isSaving}>
                    Adicionar outro endereco
                  </button>
                  <button type="button" className={styles.dangerButton} onClick={() => void removeAddress(selectedMaterial, selectedAddress)} disabled={isSaving}>
                    Remover endereco
                  </button>
                </div>
              </div>
            ) : (
              <p className={styles.muted}>Selecione uma posicao ocupada para ver detalhes.</p>
            )}

            {selectedShelf ? (
              <div className={styles.sidePanel}>
                <strong>Posicao {selectedShelf.coluna}{selectedShelf.linha}</strong>
                <span>{storageTypeLabel(selectedShelf.tipo, storageTypes)}</span>
                <span>{addressesInSelectedShelf.length} material(is) enderecado(s) nesta posicao</span>
                {addressesInSelectedShelf.length > 0 ? (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => setClearCellConfirm(selectedShelf)}
                      disabled={isSaving}
                    >
                      Limpar posicao
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <h3 className={styles.cardTitle}>Materiais para enderecar</h3>
            <div className={styles.tableHeader}>
              <span className={styles.tableHint}>
                {filteredAddressableMaterials.length} de {addressableMaterials.length} materiais
              </span>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={openBulkAssignment}
                disabled={isSaving || !config || filteredAddressableMaterials.length === 0 || availablePositions.length === 0}
              >
                Enderecar em massa
              </button>
            </div>
            <label className={styles.compactField}>
              <span>Filtro</span>
              <input
                value={unaddressedSearch}
                onChange={(event) => setUnaddressedSearch(event.target.value)}
                placeholder="Codigo, nome ou UMB"
              />
            </label>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>UMB</th>
                    <th>Quantidade</th>
                    <th>Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAddressableMaterials.map((material) => (
                    <tr key={material.id}>
                      <td>
                        <button type="button" className={styles.tableRowButton} onClick={() => openAssignment(material)}>
                          {material.codigo}
                        </button>
                        <small>{material.nome}</small>
                        {material.enderecos.length > 0 ? (
                          <small>Ja enderecado em {material.enderecos.length} posicao(oes)</small>
                        ) : null}
                      </td>
                      <td>{material.unidade || "SEM UMB"}</td>
                      <td>{formatQuantity(material.quantidade, material.unidade)}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.tableActionButton}
                          onClick={() => openAssignment(material)}
                          disabled={isSaving}
                          title="Enderecar"
                          aria-label={`Enderecar material ${material.codigo}`}
                        >
                          <ActionIcon name="address" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredAddressableMaterials.length === 0 ? (
                    <tr>
                      <td colSpan={4} className={styles.emptyRow}>Sem dados.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      )}

      {clearCellConfirm ? (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <header className={styles.modalHeader}>
              <h3>Limpar posicao</h3>
              <button type="button" className={styles.ghostButton} onClick={() => setClearCellConfirm(null)}>Fechar</button>
            </header>
            <p>
              Remover o endereco de {materials.reduce((count, material) => count + material.enderecos.filter((address) => address.coluna === clearCellConfirm.coluna && address.linha === clearCellConfirm.linha).length, 0)} material(is) da posicao {clearCellConfirm.coluna}{clearCellConfirm.linha}?
              Os materiais ficarao sem endereco ate serem realocados.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.ghostButton} onClick={() => setClearCellConfirm(null)} disabled={isSaving}>
                Cancelar
              </button>
              <button type="button" className={styles.dangerButton} onClick={() => void clearCellAddresses(clearCellConfirm)} disabled={isSaving}>
                {isSaving ? "Removendo..." : "Remover endereco"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                      andar: storageTypeUsesFloors(shelf.tipo, storageTypes) ? shelf.andares[0]?.numero ?? 1 : 1,
                      posicao: 1,
                    } : current);
                  }}
                >
                  {config.prateleiras.map((shelf) => (
                    <option key={shelf.id} value={`${shelf.coluna}-${shelf.linha}`}>{shelf.coluna}{shelf.linha}</option>
                  ))}
                </select>
              </label>

              {assignmentUsesFloors ? (
                <label className={styles.field}>
                  <span>Andar</span>
                  <select
                    value={assignmentDraft.andar}
                    onChange={(event) => {
                      const nextAndar = Number(event.target.value);
                      const nextFloor = assignmentShelf?.andares.find((floor) => floor.numero === nextAndar);
                      setAssignmentDraft((current) => current ? {
                        ...current,
                        andar: nextAndar,
                        posicao: clamp(current.posicao, 1, nextFloor?.qtdPosicoes ?? 1),
                      } : current);
                    }}
                  >
                    {(assignmentShelf?.andares ?? []).map((floor) => (
                      <option key={floor.numero} value={floor.numero}>{floor.numero}</option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className={styles.field}>
                <span>Posicao</span>
                <select
                  value={assignmentDraft.posicao}
                  onChange={(event) => setAssignmentDraft((current) => current ? { ...current, posicao: Number(event.target.value) } : current)}
                >
                  {Array.from({ length: assignmentFloorPositions }, (_, index) => index + 1).map((position) => (
                    <option key={position} value={position}>{position}</option>
                  ))}
                </select>
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

      {isBulkImportOpen && config ? (
        <div className={styles.modalOverlay}>
          <section className={styles.modalCard}>
            <header className={styles.modalHeader}>
              <div>
                <h3>Cadastro em massa</h3>
                <p>Importe um CSV para enderecar materiais em lote.</p>
              </div>
              <button type="button" className={styles.ghostButton} onClick={closeBulkImport}>Fechar</button>
            </header>

            <div className={styles.importStep}>
              <div className={styles.importStepHeader}>
                <span className={styles.importStepNumber}>1</span>
                <div>
                  <strong>Baixe o modelo</strong>
                  <p>O modelo usa os materiais com saldo do filtro atual e sugere as primeiras posicoes vagas.</p>
                </div>
              </div>
              <button type="button" className={styles.secondaryButton} onClick={downloadBulkTemplate} disabled={!filteredAddressableMaterials.length || !availablePositions.length}>
                Baixar modelo CSV
              </button>
            </div>

            <div className={styles.importStep}>
              <div className={styles.importStepHeader}>
                <span className={styles.importStepNumber}>2</span>
                <div>
                  <strong>Preencha a planilha</strong>
                  <p>Colunas obrigatorias: codigo, coluna, linha e posicao. Andar e usado para prateleira; Pallet e Baia usam 1.</p>
                  <p>
                    Exemplo (codigo;coluna;linha;andar;posicao): <code>330991;D;2;1;3</code>. O mesmo material pode
                    repetir em outra linha com posicao diferente para dividir o estoque, ex.: <code>330991;D;2;2;1</code>.
                  </p>
                </div>
              </div>
            </div>

            <div className={styles.importStep}>
              <div className={styles.importStepHeader}>
                <span className={styles.importStepNumber}>3</span>
                <div>
                  <strong>Envie o arquivo</strong>
                  <p>Somente arquivo CSV separado por ponto e virgula.</p>
                </div>
              </div>
              <label className={styles.importDropzone}>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    setBulkImportFile(event.target.files?.[0] ?? null);
                    setBulkDraft(null);
                    setBulkImportResult(null);
                  }}
                />
                <span>{bulkImportFile ? bulkImportFile.name : "Clique para selecionar o arquivo CSV"}</span>
              </label>
              <div className={styles.actions}>
                <button type="button" className={styles.primaryButton} onClick={() => void prepareBulkImport()} disabled={!bulkImportFile || isSaving}>
                  Importar planilha
                </button>
              </div>
            </div>

            {bulkImportResult ? (
              <div className={`${styles.feedback} ${bulkImportResult.status === "success" ? styles.success : styles.error}`}>
                {bulkImportResult.message}
              </div>
            ) : null}

            {bulkDraft?.length ? (
              <>
                <div className={styles.tableHeader}>
                  <span className={styles.tableHint}>{bulkDraft.length} material(is) preparados para gravacao</span>
                  <span className={styles.tableHint}>{availablePositions.length} posicao(oes) vagas no mapa</span>
                </div>

                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>UMB</th>
                        <th>Quantidade</th>
                        <th>Endereco</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkDraft.map((item) => (
                        <tr key={item.material.id}>
                          <td>
                            <strong>{item.material.codigo}</strong>
                            <small>{item.material.nome}</small>
                          </td>
                          <td>{item.material.unidade || "SEM UMB"}</td>
                          <td>{formatQuantity(item.material.quantidade, item.material.unidade)}</td>
                          <td><strong>{positionCode(item.coluna, item.linha, item.andar, item.posicao)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            <div className={styles.actions}>
              <button type="button" className={styles.primaryButton} onClick={() => void submitBulkAssignment()} disabled={isSaving || !bulkDraft?.length}>
                {isSaving ? "Salvando..." : "Confirmar lote"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
