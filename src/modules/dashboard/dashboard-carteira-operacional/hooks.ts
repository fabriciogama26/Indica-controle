"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useErrorLogger } from "@/hooks/useErrorLogger";
import {
  fetchDashboardPortfolio,
  fetchDashboardPortfolioForecastGaps,
  fetchDashboardPortfolioProjectActivities,
} from "./api";
import { EMPTY_DASHBOARD_PORTFOLIO_FILTERS } from "./constants";
import type {
  DashboardPortfolioAgeBucket,
  DashboardPortfolioCycle,
  DashboardPortfolioDiagnostic,
  DashboardPortfolioFilters,
  DashboardPortfolioFinancialSummary,
  DashboardPortfolioFlowRow,
  DashboardPortfolioForecastGaps,
  DashboardPortfolioGoalCoverage,
  DashboardPortfolioOption,
  DashboardPortfolioProject,
  DashboardPortfolioQuantitySummary,
  DashboardPortfolioRenewalRow,
} from "./types";

export function useDashboardPortfolio() {
  const { session } = useAuth();
  const logError = useErrorLogger("dashboard_carteira_operacional");
  const [filters, setFilters] = useState<DashboardPortfolioFilters>({ ...EMPTY_DASHBOARD_PORTFOLIO_FILTERS });
  const [draftFilters, setDraftFilters] = useState<DashboardPortfolioFilters>({ ...EMPTY_DASHBOARD_PORTFOLIO_FILTERS });
  const [cycles, setCycles] = useState<DashboardPortfolioCycle[]>([]);
  const [projects, setProjects] = useState<DashboardPortfolioOption[]>([]);
  const [serviceCenters, setServiceCenters] = useState<DashboardPortfolioOption[]>([]);
  const [diagnostic, setDiagnostic] = useState<DashboardPortfolioDiagnostic | null>(null);
  const [quantitySummary, setQuantitySummary] = useState<DashboardPortfolioQuantitySummary | null>(null);
  const [financialSummary, setFinancialSummary] = useState<DashboardPortfolioFinancialSummary | null>(null);
  const [goalCoverage, setGoalCoverage] = useState<DashboardPortfolioGoalCoverage | null>(null);
  const [forecastGaps, setForecastGaps] = useState<DashboardPortfolioForecastGaps | null>(null);
  const [flow, setFlow] = useState<DashboardPortfolioFlowRow[]>([]);
  const [renewalChart, setRenewalChart] = useState<DashboardPortfolioRenewalRow[]>([]);
  const [ageBuckets, setAgeBuckets] = useState<DashboardPortfolioAgeBucket[]>([]);
  const [projectRows, setProjectRows] = useState<DashboardPortfolioProject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const suppressNextAutoLoadRef = useRef(false);

  const load = useCallback(async () => {
    if (!session?.accessToken) return;

    setIsLoading(true);
    try {
      const data = await fetchDashboardPortfolio({
        accessToken: session.accessToken,
        filters,
      });
      const nextCycleStart = filters.cycleStart || data.selectedCycleStart || "";
      setCycles(data.cycles ?? []);
      setProjects(data.filters?.projects ?? []);
      setServiceCenters(data.filters?.serviceCenters ?? []);
      setDiagnostic(data.diagnostic ?? null);
      setQuantitySummary(data.quantitySummary ?? null);
      setFinancialSummary(data.financialSummary ?? null);
      setGoalCoverage(data.goalCoverage ?? null);
      setForecastGaps(data.forecastGaps ?? null);
      setFlow(data.flow ?? []);
      setRenewalChart(data.renewalChart ?? []);
      setAgeBuckets(data.ageBuckets ?? []);
      setProjectRows(data.projects ?? []);
      if (nextCycleStart && !filters.cycleStart) {
        suppressNextAutoLoadRef.current = true;
        setFilters((current) => current.cycleStart ? current : { ...current, cycleStart: nextCycleStart });
        setDraftFilters((current) => current.cycleStart ? current : { ...current, cycleStart: nextCycleStart });
      }
      setErrorMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar Dashboard Carteira Operacional.";
      await logError("Falha ao carregar Dashboard Carteira Operacional", error, {
        cycleStart: filters.cycleStart || null,
        project: filters.project || null,
      });
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [filters, logError, session?.accessToken]);

  const loadForecastGaps = useCallback(async () => {
    if (!session?.accessToken) {
      throw new Error("Sessao invalida para carregar projetos sem atividade prevista.");
    }

    try {
      const data = await fetchDashboardPortfolioForecastGaps({
        accessToken: session.accessToken,
        cycleStart: filters.cycleStart,
        serviceCenterId: filters.serviceCenterId,
      });
      return data.items ?? [];
    } catch (error) {
      await logError("Falha ao carregar projetos sem atividade prevista no Dashboard Carteira Operacional", error, {
        cycleStart: filters.cycleStart || null,
        serviceCenterId: filters.serviceCenterId || null,
      });
      throw error;
    }
  }, [filters.cycleStart, filters.serviceCenterId, logError, session?.accessToken]);

  const loadProjectActivities = useCallback(async (projectId: string) => {
    if (!session?.accessToken) {
      throw new Error("Sessao invalida para carregar atividades previstas.");
    }

    try {
      const data = await fetchDashboardPortfolioProjectActivities({
        accessToken: session.accessToken,
        projectId,
      });
      return data.items ?? [];
    } catch (error) {
      await logError("Falha ao carregar atividades previstas no Dashboard Carteira Operacional", error, {
        projectId,
      });
      throw error;
    }
  }, [logError, session?.accessToken]);

  useEffect(() => {
    if (suppressNextAutoLoadRef.current) {
      suppressNextAutoLoadRef.current = false;
      return;
    }
    void load();
  }, [load]);

  return {
    filters,
    draftFilters,
    setDraftFilters,
    applyFilters: () => setFilters({ ...draftFilters }),
    cycles,
    projects,
    serviceCenters,
    diagnostic,
    quantitySummary,
    financialSummary,
    goalCoverage,
    forecastGaps,
    flow,
    renewalChart,
    ageBuckets,
    projectRows,
    loadForecastGaps,
    loadProjectActivities,
    isLoading,
    errorMessage,
  };
}
