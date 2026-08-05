"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import { buildCsvContent, downloadCsvFile } from "@/lib/utils/csv";

import {
  formatCurrency,
  formatDate,
  formatDecimal,
  formatExportDate,
  formatFileNamePart,
  formatPercent,
  getCurrentYearPeriod,
  operationLabels,
} from "./helpers";
import type {
  AbcMode,
  AbcRow,
  CriticalMaterial,
  DashboardFilterValues,
  DashboardResponse,
  EvolutionRow,
  FeedbackState,
  IdleBucket,
  MaterialModalState,
  Option,
  ScatterOperation,
  ScatterPoint,
  ScatterScale,
  ScatterUnitSummary,
  StockCenterOption,
  Summary,
  TopBalanceMaterial,
  UnitSummary,
} from "./types";

export function useStockDashboard() {
  const { session } = useAuth();
  const logError = useErrorLogger("dash_estoque");
  const hasLoadedInitialDashboard = useRef(false);
  const currentPeriod = useMemo(() => getCurrentYearPeriod(), []);
  const [startDate, setStartDate] = useState(currentPeriod.start);
  const [endDate, setEndDate] = useState(currentPeriod.end);
  const [stockCenterId, setStockCenterId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [materialCode, setMaterialCode] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [criticalQty, setCriticalQty] = useState("5");
  const [scatterOperation, setScatterOperation] = useState<ScatterOperation>("REQUISITION");
  const [scatterScale, setScatterScale] = useState<ScatterScale>("sqrt");
  const [scatterUnit, setScatterUnit] = useState("");
  const [abcMode, setAbcMode] = useState<AbcMode>("value");
  const [isScatterExpanded, setIsScatterExpanded] = useState(false);
  const [selectedScatterMaterialId, setSelectedScatterMaterialId] = useState<string | null>(null);
  const [materialModal, setMaterialModal] = useState<MaterialModalState>(null);
  const [isExportingMaterialModal, setIsExportingMaterialModal] = useState(false);
  const [stockCenters, setStockCenters] = useState<StockCenterOption[]>([]);
  const [teams, setTeams] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryByUnit, setSummaryByUnit] = useState<UnitSummary[]>([]);
  const [criticalMaterials, setCriticalMaterials] = useState<CriticalMaterial[]>([]);
  const [topBalanceMaterials, setTopBalanceMaterials] = useState<TopBalanceMaterial[]>([]);
  const [idleBuckets, setIdleBuckets] = useState<IdleBucket[]>([]);
  const [abcRows, setAbcRows] = useState<AbcRow[]>([]);
  const [abcQuantityRows, setAbcQuantityRows] = useState<AbcRow[]>([]);
  const [movementEvolution, setMovementEvolution] = useState<EvolutionRow[]>([]);
  const [scatterSummaryByUnit, setScatterSummaryByUnit] = useState<ScatterUnitSummary[]>([]);
  const [scatter, setScatter] = useState<ScatterPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isExportingScatter, setIsExportingScatter] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const loadDashboard = useCallback(async () => {
    if (!session?.accessToken) return;

    const params = new URLSearchParams();
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    params.set("criticalQty", criticalQty || "5");
    if (stockCenterId) params.set("stockCenterId", stockCenterId);
    if (teamId) params.set("teamId", teamId);
    if (projectId) params.set("projectId", projectId);
    if (materialCode.trim()) params.set("materialCode", materialCode.trim());
    if (materialType) params.set("materialType", materialType);

    setIsLoading(true);
    try {
      const response = await fetch(`/api/dash-estoque?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as DashboardResponse;

      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar Dashboard Estoque.");
      }

      setStockCenters(payload.filters?.stockCenters ?? []);
      setTeams(payload.filters?.teams ?? []);
      setProjects(payload.filters?.projects ?? []);
      setSummary(payload.summary ?? null);
      setSummaryByUnit(payload.summaryByUnit ?? []);
      setCriticalMaterials(payload.criticalMaterials ?? []);
      setTopBalanceMaterials(payload.topBalanceMaterials ?? []);
      setIdleBuckets(payload.idleBuckets ?? []);
      setAbcRows(payload.abcRows ?? []);
      setAbcQuantityRows(payload.abcQuantityRows ?? []);
      setMovementEvolution(payload.movementEvolution ?? []);
      setScatterSummaryByUnit(payload.scatterSummaryByUnit ?? []);
      setScatter(payload.scatter ?? []);
      setMaterialModal(null);
      setIsExportingMaterialModal(false);
      setFeedback({ type: "success", message: "Dashboard Estoque atualizado." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar Dashboard Estoque.";
      setFeedback({ type: "error", message });
      await logError("Falha ao carregar Dashboard Estoque", error, {
        startDate,
        endDate,
        stockCenterId,
        teamId,
        projectId,
        materialCode,
        materialType,
      });
    } finally {
      setIsLoading(false);
    }
  }, [criticalQty, endDate, logError, materialCode, materialType, projectId, session?.accessToken, startDate, stockCenterId, teamId]);

  const selectedScatterPoint = useMemo(
    () => scatter.find((row) => row.operationKind === scatterOperation && row.materialId === selectedScatterMaterialId) ?? null,
    [scatter, scatterOperation, selectedScatterMaterialId],
  );

  const activeScatterRows = useMemo(
    () =>
      scatter.filter(
        (row) => row.operationKind === scatterOperation && (!scatterUnit || row.unit === scatterUnit),
      ),
    [scatter, scatterOperation, scatterUnit],
  );

  const activeScatterUnitSummary = useMemo(
    () => {
      const operationRows = scatterSummaryByUnit.filter((row) => row.operationKind === scatterOperation);
      const operationByUnit = new Map(operationRows.map((row) => [row.unit, row]));
      const displayUnits = Array.from(
        new Set([
          ...summaryByUnit.map((row) => row.unit),
          ...operationRows.map((row) => row.unit),
        ]),
      );

      return displayUnits.map(
        (unit) =>
          operationByUnit.get(unit) ?? {
            operationKind: scatterOperation,
            unit,
            quantity: 0,
            materialCount: 0,
            operationCount: 0,
          },
      );
    },
    [scatterOperation, scatterSummaryByUnit, summaryByUnit],
  );

  const filterValues: DashboardFilterValues = {
    startDate,
    endDate,
    stockCenterId,
    teamId,
    projectId,
    materialCode,
    materialType,
    criticalQty,
  };

  const filterSetters: { [K in keyof DashboardFilterValues]: (value: DashboardFilterValues[K]) => void } = {
    startDate: setStartDate,
    endDate: setEndDate,
    stockCenterId: setStockCenterId,
    teamId: setTeamId,
    projectId: setProjectId,
    materialCode: setMaterialCode,
    materialType: setMaterialType,
    criticalQty: setCriticalQty,
  };

  const handleFilterChange = <K extends keyof DashboardFilterValues>(field: K, value: DashboardFilterValues[K]) => {
    filterSetters[field](value);
  };

  const handleScatterOperationChange = (nextOperation: ScatterOperation) => {
    setScatterOperation(nextOperation);
    setSelectedScatterMaterialId(null);
  };

  const handleScatterUnitChange = (nextUnit: string) => {
    setScatterUnit((current) => (current === nextUnit ? "" : nextUnit));
    setSelectedScatterMaterialId(null);
  };

  const openIdleMaterials = (row: IdleBucket) => {
    setMaterialModal({
      title: `Materiais sem giro | ${row.label}`,
      subtitle: `${row.materialCount} materiais | saldo ${formatDecimal(row.balanceQuantity)}`,
      rows: row.materials,
    });
  };

  const openAbcMaterials = (row: AbcRow) => {
    const metricLabel = abcMode === "value" ? formatCurrency(row.estimatedValue) : formatDecimal(row.balanceQuantity);
    setMaterialModal({
      title: `Curva ABC | Classe ${row.className}`,
      subtitle: `${row.materialCount} materiais | ${metricLabel} | ${formatPercent(row.percentage)}`,
      rows: row.materials,
      showAbcPercentage: true,
    });
  };

  const exportScatterRows = async () => {
    if (!activeScatterRows.length || isExportingScatter) return;

    setIsExportingScatter(true);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const csv = buildCsvContent(
        ["Operacao", "Material", "Descricao", "UMB", "Quantidade", "Operacoes", "Projetos", "Saldo atual"],
        activeScatterRows.map((row) => [
          operationLabels[row.operationKind],
          row.materialCode,
          row.description,
          row.unit,
          formatDecimal(row.quantity),
          row.operationCount,
          row.projectCount,
          formatDecimal(row.currentBalance),
        ]),
      );

      const unitPart = scatterUnit ? `${formatFileNamePart(scatterUnit)}_` : "";
      downloadCsvFile(
        csv,
        `dispersao_materiais_${scatterOperation.toLowerCase()}_${unitPart}${formatExportDate()}.csv`,
      );
    } finally {
      setIsExportingScatter(false);
    }
  };

  const exportMaterialModalRows = async () => {
    if (!materialModal?.rows.length || isExportingMaterialModal) return;

    setIsExportingMaterialModal(true);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const headers = [
        "Material",
        "Descricao",
        "Tipo",
        "UMB",
        "Saldo",
        "Preco unitario",
        "Valor estimado",
        ...(materialModal.showAbcPercentage ? ["% ABC"] : []),
        "Ultima movimentacao",
        "Dias sem giro",
      ];
      const csv = buildCsvContent(
        headers,
        materialModal.rows.map((row) => [
          row.materialCode,
          row.description,
          row.materialType,
          row.unit,
          formatDecimal(row.balanceQuantity),
          formatDecimal(row.unitPrice),
          formatDecimal(row.estimatedValue),
          ...(materialModal.showAbcPercentage ? [formatPercent(row.abcPercentage ?? 0)] : []),
          formatDate(row.lastMovementAt),
          row.idleDays == null ? "" : formatDecimal(row.idleDays),
        ]),
      );

      downloadCsvFile(csv, `${formatFileNamePart(materialModal.title)}_${formatExportDate()}.csv`);
    } finally {
      setIsExportingMaterialModal(false);
    }
  };

  useEffect(() => {
    if (!session?.accessToken) {
      hasLoadedInitialDashboard.current = false;
      return;
    }
    if (hasLoadedInitialDashboard.current) return;
    hasLoadedInitialDashboard.current = true;
    void loadDashboard();
  }, [loadDashboard, session?.accessToken]);

  useEffect(() => {
    setSelectedScatterMaterialId(null);
    setScatterUnit("");
  }, [scatter]);

  return {
    filterValues,
    handleFilterChange,
    loadDashboard,
    isLoading,
    feedback,

    stockCenters,
    teams,
    projects,

    summary,
    summaryByUnit,
    criticalMaterials,
    topBalanceMaterials,
    idleBuckets,
    movementEvolution,

    abcMode,
    setAbcMode,
    abcRows,
    abcQuantityRows,

    scatter,
    scatterOperation,
    scatterScale,
    setScatterScale,
    scatterUnit,
    activeScatterRows,
    activeScatterUnitSummary,
    selectedScatterPoint,
    selectedScatterMaterialId,
    setSelectedScatterMaterialId,
    handleScatterOperationChange,
    handleScatterUnitChange,
    isScatterExpanded,
    setIsScatterExpanded,
    isExportingScatter,
    exportScatterRows,

    materialModal,
    setMaterialModal,
    isExportingMaterialModal,
    exportMaterialModalRows,
    openIdleMaterials,
    openAbcMaterials,
  };
}
