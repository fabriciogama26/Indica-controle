"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import styles from "./LocationPageView.module.css";

type ProjectOption = {
  id: string;
  sob: string;
  city: string;
};

type LocationOverviewStatus = "LOCADO" | "NAO_LOCADO" | "INATIVO";

type LocationOverviewItem = {
  id: string;
  sob: string;
  city: string;
  isActive: boolean;
  hasLocacao: boolean;
  status: LocationOverviewStatus;
  planId?: string | null;
  recordedAt?: string | null;
  recordedByName?: string | null;
};

type LocationState = {
  project?: { id: string; sob: string; city: string };
  plan?: {
    id: string;
    notes: string;
    feeder?: string | null;
    sgdTypeId?: string | null;
    cutElement?: number | null;
    questionnaireAnswers?: QuestionnaireAnswers;
    createdAt: string;
    updatedAt: string;
  } | null;
  supportItems?: Array<{
    id: string;
    description: string;
    isIncluded: boolean;
  }>;
  risks?: Array<{
    id: string;
    description: string;
    isActive: boolean;
  }>;
  materials?: Array<{
    id: string;
    code: string;
    description: string;
    type: string | null;
    originalQty: number;
    plannedQty: number;
    observation: string | null;
    updatedAt: string;
  }>;
  activities?: Array<{
    id: string;
    code: string;
    description: string;
    teamTypeName: string;
    unit: string;
    unitValue: number;
    plannedQty: number;
    observation: string | null;
    updatedAt: string;
  }>;
  summary?: {
    materialsPlannedTotal: number;
    activitiesPlannedTotal: number;
  };
  message?: string;
  initialization?: {
    seededMaterials: number;
  };
};

type Draft = {
  quantity: string;
  observation: string;
  updatedAt?: string;
};

type ListFilterState = {
  code: string;
  description: string;
  type: string;
};

type LocationOverviewFilterState = {
  sob: string;
  city: string;
  status: "" | LocationOverviewStatus;
};

type QuestionnaireAnswers = {
  planning?: {
    needsProjectReview?: boolean | null;
    withShutdown?: boolean | null;
    feeder?: string;
    sgdTypeId?: string | null;
    cutElement?: number | null;
  };
  executionTeams?: {
    cestoQty?: number;
    linhaMortaQty?: number;
    linhaVivaQty?: number;
    podaLinhaMortaQty?: number;
    podaLinhaVivaQty?: number;
  };
  executionForecast?: {
    stepsPlannedQty?: number;
    observation?: string;
    removedSupportItemIds?: string[];
  };
  preApr?: {
    observation?: string;
  };
};

type CatalogItem = {
  id: string;
  code: string;
  description: string;
  unit?: string;
};

type SgdTypeOption = {
  id: string;
  description: string;
};

type FeedbackScope = "page" | "location" | "activities" | "materials";

type FeedbackState = {
  type: "success" | "error";
  message: string;
  scope: FeedbackScope;
};

type LocationValidationState = {
  needsProjectReview: boolean;
  withShutdown: boolean;
  notes: boolean;
  executionTeams: boolean;
  executionSteps: boolean;
};

function formatQuantity(value: number) {
  return Number(value ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(value ?? 0);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("pt-BR");
}

function formatLocationStatus(status: LocationOverviewStatus) {
  if (status === "LOCADO") {
    return "Locado";
  }
  if (status === "INATIVO") {
    return "Projeto inativo";
  }
  return "Nao locado";
}

function optionLabel(item: CatalogItem) {
  return `${item.code} - ${item.description}`;
}

function getObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value as Record<string, unknown>;
}

function getNonNegativeIntegerInput(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "0";
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return "0";
  }

  return String(Math.trunc(numeric));
}

function parseNonNegativeInteger(value: string) {
  const numeric = Number(String(value ?? "").trim());
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  return Math.trunc(numeric);
}

function scrollDashboardContentToTop() {
  if (typeof window === "undefined") {
    return;
  }

  const content = document.querySelector<HTMLElement>('[data-main-content-scroll="true"]');
  if (content) {
    content.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

const INITIAL_LIST_FILTERS: ListFilterState = {
  code: "",
  description: "",
  type: "",
};

const INITIAL_OVERVIEW_FILTERS: LocationOverviewFilterState = {
  sob: "",
  city: "",
  status: "",
};

const INITIAL_LOCATION_VALIDATION: LocationValidationState = {
  needsProjectReview: false,
  withShutdown: false,
  notes: false,
  executionTeams: false,
  executionSteps: false,
};

const LOCATION_TEAM_QTY_LIMIT = 50;
const LOCATION_STEPS_LIMIT = 1000;
const LOCATION_ITEM_QTY_LIMIT = 100000;
const OVERVIEW_PAGE_SIZE = 10;

export function LocationPageView() {
  const { session } = useAuth();
  const [cities, setCities] = useState<string[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [overviewItems, setOverviewItems] = useState<LocationOverviewItem[]>([]);
  const [selectedCity, setSelectedCity] = useState("");
  const [sobSearch, setSobSearch] = useState("");
  const [overviewFilterDraft, setOverviewFilterDraft] = useState<LocationOverviewFilterState>(INITIAL_OVERVIEW_FILTERS);
  const [activeOverviewFilter, setActiveOverviewFilter] = useState<LocationOverviewFilterState>(INITIAL_OVERVIEW_FILTERS);
  const [overviewPage, setOverviewPage] = useState(1);
  const [state, setState] = useState<LocationState | null>(null);
  const [detailLocation, setDetailLocation] = useState<{ item: LocationOverviewItem; data: LocationState | null } | null>(null);
  const [notes, setNotes] = useState("");
  const [needsProjectReview, setNeedsProjectReview] = useState<boolean | null>(null);
  const [withShutdown, setWithShutdown] = useState<boolean | null>(null);
  const [feeder, setFeeder] = useState("");
  const [sgdTypeId, setSgdTypeId] = useState("");
  const [cutElement, setCutElement] = useState("0");
  const [teamCestoQty, setTeamCestoQty] = useState("0");
  const [teamLinhaMortaQty, setTeamLinhaMortaQty] = useState("0");
  const [teamLinhaVivaQty, setTeamLinhaVivaQty] = useState("0");
  const [teamPodaLinhaMortaQty, setTeamPodaLinhaMortaQty] = useState("0");
  const [teamPodaLinhaVivaQty, setTeamPodaLinhaVivaQty] = useState("0");
  const [executionStepsQty, setExecutionStepsQty] = useState("0");
  const [executionObservation, setExecutionObservation] = useState("");
  const [preAprObservation, setPreAprObservation] = useState("");
  const [supportItemsDraft, setSupportItemsDraft] = useState<Array<{ id: string; description: string; isIncluded: boolean }>>([]);
  const [riskDraft, setRiskDraft] = useState<Array<{ id: string; description: string; isActive: boolean }>>([]);
  const [materialFilterDraft, setMaterialFilterDraft] = useState<ListFilterState>(INITIAL_LIST_FILTERS);
  const [activityFilterDraft, setActivityFilterDraft] = useState<ListFilterState>(INITIAL_LIST_FILTERS);
  const [activeMaterialFilter, setActiveMaterialFilter] = useState<ListFilterState>(INITIAL_LIST_FILTERS);
  const [activeActivityFilter, setActiveActivityFilter] = useState<ListFilterState>(INITIAL_LIST_FILTERS);
  const [materialSearch, setMaterialSearch] = useState("");
  const [activitySearch, setActivitySearch] = useState("");
  const [materialQty, setMaterialQty] = useState("");
  const [activityQty, setActivityQty] = useState("");
  const [materialOptions, setMaterialOptions] = useState<CatalogItem[]>([]);
  const [activityOptions, setActivityOptions] = useState<CatalogItem[]>([]);
  const [sgdTypes, setSgdTypes] = useState<SgdTypeOption[]>([]);
  const [materialDrafts, setMaterialDrafts] = useState<Record<string, Draft>>({});
  const [activityDrafts, setActivityDrafts] = useState<Record<string, Draft>>({});
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"location" | "activities" | "materials">("location");
  const [locationValidation, setLocationValidation] = useState<LocationValidationState>(INITIAL_LOCATION_VALIDATION);

  const deferredMaterialSearch = useDeferredValue(materialSearch);
  const deferredActivitySearch = useDeferredValue(activitySearch);
  const selectedProject = state?.project ?? null;

  const filteredProjects = useMemo(
    () => projects.filter((item) => !selectedCity || item.city === selectedCity),
    [projects, selectedCity],
  );

  const filteredOverviewItems = useMemo(() => {
    return overviewItems.filter((item) => {
      const sobFilter = activeOverviewFilter.sob.trim().toLowerCase();
      if (sobFilter && !item.sob.toLowerCase().includes(sobFilter)) {
        return false;
      }

      if (activeOverviewFilter.city && item.city !== activeOverviewFilter.city) {
        return false;
      }

      if (activeOverviewFilter.status && item.status !== activeOverviewFilter.status) {
        return false;
      }

      return true;
    });
  }, [activeOverviewFilter, overviewItems]);

  const totalOverviewPages = useMemo(
    () => Math.max(1, Math.ceil(filteredOverviewItems.length / OVERVIEW_PAGE_SIZE)),
    [filteredOverviewItems.length],
  );

  const paginatedOverviewItems = useMemo(() => {
    const start = (overviewPage - 1) * OVERVIEW_PAGE_SIZE;
    return filteredOverviewItems.slice(start, start + OVERVIEW_PAGE_SIZE);
  }, [filteredOverviewItems, overviewPage]);

  const detailQuestionnaireSnapshot = useMemo(() => {
    if (!detailLocation) {
      return null;
    }

    const answers = getObjectRecord(detailLocation.data?.plan?.questionnaireAnswers) as QuestionnaireAnswers;
    return {
      planning: getObjectRecord(answers.planning),
      executionTeams: getObjectRecord(answers.executionTeams),
      executionForecast: getObjectRecord(answers.executionForecast),
      preApr: getObjectRecord(answers.preApr),
      supportItems: detailLocation.data?.supportItems ?? [],
      risks: detailLocation.data?.risks ?? [],
    };
  }, [detailLocation]);

  const sgdTypeLabelById = useMemo(
    () => new Map(sgdTypes.map((item) => [item.id, item.description])),
    [sgdTypes],
  );

  const detailPlanningSgdLabel = useMemo(() => {
    const sgdId = String(detailQuestionnaireSnapshot?.planning.sgdTypeId ?? "").trim();
    if (!sgdId) {
      return "-";
    }

    return sgdTypeLabelById.get(sgdId) ?? sgdId;
  }, [detailQuestionnaireSnapshot, sgdTypeLabelById]);

  const filteredMaterials = useMemo(() => {
    return (state?.materials ?? []).filter((item) => {
      const codeFilter = activeMaterialFilter.code.trim().toLowerCase();
      if (codeFilter && !item.code.toLowerCase().includes(codeFilter)) {
        return false;
      }

      const descriptionFilter = activeMaterialFilter.description.trim().toLowerCase();
      if (descriptionFilter && !item.description.toLowerCase().includes(descriptionFilter)) {
        return false;
      }

      const typeFilter = activeMaterialFilter.type.trim().toLowerCase();
      if (typeFilter && !(item.type ?? "").toLowerCase().includes(typeFilter)) {
        return false;
      }

      return true;
    });
  }, [activeMaterialFilter, state?.materials]);

  const filteredActivities = useMemo(() => {
    return (state?.activities ?? []).filter((item) => {
      const codeFilter = activeActivityFilter.code.trim().toLowerCase();
      if (codeFilter && !item.code.toLowerCase().includes(codeFilter)) {
        return false;
      }

      const descriptionFilter = activeActivityFilter.description.trim().toLowerCase();
      if (descriptionFilter && !item.description.toLowerCase().includes(descriptionFilter)) {
        return false;
      }

      const typeFilter = activeActivityFilter.type.trim().toLowerCase();
      if (typeFilter && !item.teamTypeName.toLowerCase().includes(typeFilter)) {
        return false;
      }

      return true;
    });
  }, [activeActivityFilter, state?.activities]);

  useEffect(() => {
    const questionnaireAnswers = getObjectRecord(state?.plan?.questionnaireAnswers) as QuestionnaireAnswers;
    const planning = getObjectRecord(questionnaireAnswers.planning) as QuestionnaireAnswers["planning"];
    const executionTeams = getObjectRecord(questionnaireAnswers.executionTeams) as QuestionnaireAnswers["executionTeams"];
    const executionForecast = getObjectRecord(questionnaireAnswers.executionForecast) as QuestionnaireAnswers["executionForecast"];
    const preApr = getObjectRecord(questionnaireAnswers.preApr) as QuestionnaireAnswers["preApr"];

    setNotes(state?.plan?.notes ?? "");
    setNeedsProjectReview(typeof planning?.needsProjectReview === "boolean" ? planning.needsProjectReview : null);
    setWithShutdown(typeof planning?.withShutdown === "boolean" ? planning.withShutdown : null);
    setFeeder(String(planning?.feeder ?? ""));
    setSgdTypeId(String(planning?.sgdTypeId ?? ""));
    setCutElement(getNonNegativeIntegerInput(planning?.cutElement));
    setTeamCestoQty(getNonNegativeIntegerInput(executionTeams?.cestoQty));
    setTeamLinhaMortaQty(getNonNegativeIntegerInput(executionTeams?.linhaMortaQty));
    setTeamLinhaVivaQty(getNonNegativeIntegerInput(executionTeams?.linhaVivaQty));
    setTeamPodaLinhaMortaQty(getNonNegativeIntegerInput(executionTeams?.podaLinhaMortaQty));
    setTeamPodaLinhaVivaQty(getNonNegativeIntegerInput(executionTeams?.podaLinhaVivaQty));
    setExecutionStepsQty(getNonNegativeIntegerInput(executionForecast?.stepsPlannedQty));
    setExecutionObservation(String(executionForecast?.observation ?? ""));
    setPreAprObservation(String(preApr?.observation ?? ""));
    setSupportItemsDraft(state?.supportItems ?? []);
    setRiskDraft(state?.risks ?? []);
    setLocationValidation(INITIAL_LOCATION_VALIDATION);
    setMaterialDrafts(
      Object.fromEntries(
        (state?.materials ?? []).map((item) => [
          item.id,
          { quantity: String(item.plannedQty), observation: item.observation ?? "", updatedAt: item.updatedAt },
        ]),
      ),
    );
    setActivityDrafts(
      Object.fromEntries(
        (state?.activities ?? []).map((item) => [
          item.id,
          { quantity: String(item.plannedQty), observation: item.observation ?? "", updatedAt: item.updatedAt },
        ]),
      ),
    );
  }, [state]);

  useEffect(() => {
    if (selectedProject?.id) {
      setActiveTab("location");
    }
  }, [selectedProject?.id]);

  useEffect(() => {
    setMaterialFilterDraft(INITIAL_LIST_FILTERS);
    setActivityFilterDraft(INITIAL_LIST_FILTERS);
    setActiveMaterialFilter(INITIAL_LIST_FILTERS);
    setActiveActivityFilter(INITIAL_LIST_FILTERS);
  }, [selectedProject?.id]);

  useEffect(() => {
    setOverviewPage((current) => Math.min(current, totalOverviewPages));
  }, [totalOverviewPages]);

  useEffect(() => {
    if (!session?.accessToken) {
      return;
    }

    fetch("/api/locacao/meta", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          throw new Error(data?.message ?? "Falha ao carregar metadados de locacao.");
        }

        const projectsPayloadRaw = Array.isArray(data?.projects) ? data.projects : [];
        const projectsPayload = projectsPayloadRaw as Array<{ id?: unknown; sob?: unknown; city?: unknown }>;
        const locationProjectsPayload = Array.isArray(data?.locationProjects) ? data.locationProjects : [];
        const citiesPayload = (Array.isArray(data?.cities) ? data.cities : []) as string[];
        const sgdTypesPayload = Array.isArray(data?.sgdTypes) ? data.sgdTypes : [];
        const fallbackCities =
          citiesPayload.length > 0
            ? citiesPayload
            : Array.from(
                new Set(
                  projectsPayload
                    .map((item) => String(item?.city ?? "").trim())
                    .filter((value: string) => Boolean(value)),
                ),
              ).sort((left, right) => left.localeCompare(right, "pt-BR"));

        const fallbackOverviewItems: LocationOverviewItem[] = projectsPayload
          .map((item) => ({
            id: String(item?.id ?? "").trim(),
            sob: String(item?.sob ?? "").trim(),
            city: String(item?.city ?? "").trim(),
            isActive: true,
            hasLocacao: false,
            status: "NAO_LOCADO" as LocationOverviewStatus,
            planId: null,
            recordedAt: null,
            recordedByName: null,
          }))
          .filter((item) => item.id && item.sob);

        const nextOverviewItems =
          locationProjectsPayload.length > 0
            ? (locationProjectsPayload as LocationOverviewItem[])
            : fallbackOverviewItems;
        const nextSgdTypes = (sgdTypesPayload as Array<{ id?: unknown; description?: unknown }>)
          .map((item) => ({
            id: String(item?.id ?? "").trim(),
            description: String(item?.description ?? "").trim(),
          }))
          .filter((item) => item.id && item.description);

        setCities(fallbackCities);
        setProjects(projectsPayload as ProjectOption[]);
        setOverviewItems(nextOverviewItems);
        setSgdTypes(nextSgdTypes);
      })
      .catch((error) => {
        setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao carregar locacao.", scope: "page" });
      });
  }, [session?.accessToken]);

  useEffect(() => {
    if (!session?.accessToken || !selectedProject || deferredMaterialSearch.trim().length < 2) {
      setMaterialOptions([]);
      return;
    }

    fetch(`/api/locacao/materials/catalog?q=${encodeURIComponent(deferredMaterialSearch.trim())}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          throw new Error(data?.message ?? "Falha ao pesquisar materiais.");
        }
        setMaterialOptions(data?.items ?? []);
      })
      .catch(() => setMaterialOptions([]));
  }, [deferredMaterialSearch, selectedProject, session?.accessToken]);

  useEffect(() => {
    if (!session?.accessToken || !selectedProject || deferredActivitySearch.trim().length < 2) {
      setActivityOptions([]);
      return;
    }

    fetch(`/api/locacao/activities/catalog?q=${encodeURIComponent(deferredActivitySearch.trim())}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: "no-store",
    })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          throw new Error(data?.message ?? "Falha ao pesquisar atividades.");
        }
        setActivityOptions(data?.items ?? []);
      })
      .catch(() => setActivityOptions([]));
  }, [deferredActivitySearch, selectedProject, session?.accessToken]);

  async function requestLocation(url: string, init: RequestInit, successMessage: string, feedbackScope: FeedbackScope = "page") {
    if (!session?.accessToken) {
      return null;
    }

    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });

    const data = (await response.json().catch(() => null)) as LocationState | null;
    if (!response.ok) {
      throw new Error(data?.message ?? "Falha ao processar locacao.");
    }

    setState(data);
    setFeedback({ type: "success", message: data?.message ?? successMessage, scope: feedbackScope });
    return data;
  }

  async function openLocation(projectId: string) {
    setBusy("open");
    setFeedback(null);
    try {
      const data = await requestLocation("/api/locacao", {
        method: "POST",
        body: JSON.stringify({ projectId }),
      }, "Locacao carregada com sucesso.", "page");

      if (data?.project?.sob) {
        setSobSearch(data.project.sob);
      }
      const seeded = Number(data?.initialization?.seededMaterials ?? 0);
      if (seeded > 0) {
        setFeedback({ type: "success", message: `${seeded} material(is) iniciais carregados do previsto do projeto.`, scope: "page" });
      }
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao abrir locacao.", scope: "page" });
    } finally {
      setBusy(null);
    }
  }

  async function openLocationFromOverview(item: LocationOverviewItem) {
    setSelectedCity(item.city);
    setSobSearch(item.sob);
    await openLocation(item.id);
  }

  async function openLocationDetails(item: LocationOverviewItem) {
    if (!session?.accessToken) {
      return;
    }

    setBusy(`detail-${item.id}`);
    setFeedback(null);
    try {
      const response = await fetch(`/api/locacao?projectId=${encodeURIComponent(item.id)}`, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
        cache: "no-store",
      });

      const data = (await response.json().catch(() => null)) as LocationState | null;
      if (!response.ok) {
        throw new Error(data?.message ?? "Falha ao carregar detalhes da locacao.");
      }

      setDetailLocation({ item, data });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Falha ao carregar detalhes da locacao.",
        scope: "page",
      });
    } finally {
      setBusy(null);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const project = filteredProjects.find((item) => item.sob === sobSearch);
    if (!project) {
      setFeedback({ type: "error", message: "Selecione um SOB valido da lista filtrada pelo municipio.", scope: "page" });
      return;
    }
    void openLocation(project.id);
  }

  function handleNonNegativeIntegerChange(setter: (value: string) => void, value: string) {
    if (!value.trim()) {
      setter("");
      return;
    }

    setter(getNonNegativeIntegerInput(value));
  }

  function normalizeLocationIntegerFields() {
    const normalized = {
      cestoQty: getNonNegativeIntegerInput(teamCestoQty),
      linhaMortaQty: getNonNegativeIntegerInput(teamLinhaMortaQty),
      linhaVivaQty: getNonNegativeIntegerInput(teamLinhaVivaQty),
      podaLinhaMortaQty: getNonNegativeIntegerInput(teamPodaLinhaMortaQty),
      podaLinhaVivaQty: getNonNegativeIntegerInput(teamPodaLinhaVivaQty),
      stepsPlannedQty: getNonNegativeIntegerInput(executionStepsQty),
    };

    setTeamCestoQty(normalized.cestoQty);
    setTeamLinhaMortaQty(normalized.linhaMortaQty);
    setTeamLinhaVivaQty(normalized.linhaVivaQty);
    setTeamPodaLinhaMortaQty(normalized.podaLinhaMortaQty);
    setTeamPodaLinhaVivaQty(normalized.podaLinhaVivaQty);
    setExecutionStepsQty(normalized.stepsPlannedQty);

    return normalized;
  }

  function validateLocationBeforeSave() {
    const normalizedIntegers = {
      cestoQty: parseNonNegativeInteger(getNonNegativeIntegerInput(teamCestoQty)),
      linhaMortaQty: parseNonNegativeInteger(getNonNegativeIntegerInput(teamLinhaMortaQty)),
      linhaVivaQty: parseNonNegativeInteger(getNonNegativeIntegerInput(teamLinhaVivaQty)),
      podaLinhaMortaQty: parseNonNegativeInteger(getNonNegativeIntegerInput(teamPodaLinhaMortaQty)),
      podaLinhaVivaQty: parseNonNegativeInteger(getNonNegativeIntegerInput(teamPodaLinhaVivaQty)),
      stepsPlannedQty: parseNonNegativeInteger(getNonNegativeIntegerInput(executionStepsQty)),
    };

    const hasExecutionTeam =
      normalizedIntegers.cestoQty > 0 ||
      normalizedIntegers.linhaMortaQty > 0 ||
      normalizedIntegers.linhaVivaQty > 0 ||
      normalizedIntegers.podaLinhaMortaQty > 0 ||
      normalizedIntegers.podaLinhaVivaQty > 0;

    const requiresNotes = needsProjectReview === true || withShutdown === true;
    const notesMissing = requiresNotes && !notes.trim();
    const teamsAboveLimit =
      normalizedIntegers.cestoQty > LOCATION_TEAM_QTY_LIMIT ||
      normalizedIntegers.linhaMortaQty > LOCATION_TEAM_QTY_LIMIT ||
      normalizedIntegers.linhaVivaQty > LOCATION_TEAM_QTY_LIMIT ||
      normalizedIntegers.podaLinhaMortaQty > LOCATION_TEAM_QTY_LIMIT ||
      normalizedIntegers.podaLinhaVivaQty > LOCATION_TEAM_QTY_LIMIT;
    const stepsAboveLimit = normalizedIntegers.stepsPlannedQty > LOCATION_STEPS_LIMIT;

    const nextValidation: LocationValidationState = {
      needsProjectReview: typeof needsProjectReview !== "boolean",
      withShutdown: typeof withShutdown !== "boolean",
      notes: notesMissing,
      executionTeams: !hasExecutionTeam,
      executionSteps: normalizedIntegers.stepsPlannedQty <= 0,
    };

    setLocationValidation(nextValidation);

    if (nextValidation.needsProjectReview || nextValidation.withShutdown) {
      setFeedback({
        type: "error",
        message: "Preencha os campos obrigatorios de Locacao antes de salvar.",
        scope: "location",
      });
      return false;
    }

    if (nextValidation.notes) {
      setFeedback({
        type: "error",
        message: "Informe observacoes da locacao quando houver revisao de projeto ou desligamento.",
        scope: "location",
      });
      return false;
    }

    if (teamsAboveLimit) {
      setFeedback({
        type: "error",
        message: `As equipes da locacao nao podem ultrapassar ${LOCATION_TEAM_QTY_LIMIT}.`,
        scope: "location",
      });
      return false;
    }

    if (nextValidation.executionTeams) {
      setFeedback({
        type: "error",
        message: "Informe pelo menos uma equipe com quantidade maior que zero antes de salvar a locacao.",
        scope: "location",
      });
      return false;
    }

    if (nextValidation.executionSteps) {
      setFeedback({
        type: "error",
        message: "ETAPAS PREVISTAS deve ser maior que zero antes de salvar a locacao.",
        scope: "location",
      });
      return false;
    }

    if (stepsAboveLimit) {
      setFeedback({
        type: "error",
        message: `ETAPAS PREVISTAS nao pode ultrapassar ${LOCATION_STEPS_LIMIT}.`,
        scope: "location",
      });
      return false;
    }

    return true;
  }

  async function saveLocation() {
    if (!selectedProject) {
      return;
    }

    const normalizedIntegers = normalizeLocationIntegerFields();
    if (!validateLocationBeforeSave()) {
      return;
    }

    const expectedUpdatedAt = String(state?.plan?.updatedAt ?? "").trim();
    if (!expectedUpdatedAt) {
      setFeedback({
        type: "error",
        message: "Reabra a locacao antes de salvar para evitar sobreposicao com outro usuario.",
        scope: "location",
      });
      return;
    }

    const questionnaireAnswers: QuestionnaireAnswers = {
      planning: {
        needsProjectReview,
        withShutdown,
        feeder: feeder.trim(),
        sgdTypeId: sgdTypeId || null,
        cutElement: String(cutElement).trim() ? parseNonNegativeInteger(getNonNegativeIntegerInput(cutElement)) : null,
      },
      executionTeams: {
        cestoQty: parseNonNegativeInteger(normalizedIntegers.cestoQty),
        linhaMortaQty: parseNonNegativeInteger(normalizedIntegers.linhaMortaQty),
        linhaVivaQty: parseNonNegativeInteger(normalizedIntegers.linhaVivaQty),
        podaLinhaMortaQty: parseNonNegativeInteger(normalizedIntegers.podaLinhaMortaQty),
        podaLinhaVivaQty: parseNonNegativeInteger(normalizedIntegers.podaLinhaVivaQty),
      },
      executionForecast: {
        stepsPlannedQty: parseNonNegativeInteger(normalizedIntegers.stepsPlannedQty),
        observation: executionObservation.trim(),
        removedSupportItemIds: supportItemsDraft.filter((item) => !item.isIncluded).map((item) => item.id),
      },
      preApr: {
        observation: preAprObservation.trim(),
      },
    };

    setBusy("notes");
    setFeedback(null);
    try {
      await requestLocation(
        "/api/locacao",
        {
          method: "PUT",
          body: JSON.stringify({
            projectId: selectedProject.id,
            notes,
            questionnaireAnswers,
            risks: riskDraft.map((item) => ({ id: item.id, isActive: item.isActive })),
            expectedUpdatedAt,
          }),
        },
        "Locacao atualizada com sucesso.",
        "page",
      );
      scrollDashboardContentToTop();
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Falha ao salvar locacao.", scope: "location" });
    } finally {
      setBusy(null);
    }
  }

  async function addCatalogItem(kind: "materials" | "activities") {
    if (!selectedProject) {
      return;
    }

    const isMaterial = kind === "materials";
    const selectedLabel = isMaterial ? materialSearch : activitySearch;
    const quantity = isMaterial ? materialQty : activityQty;
    const options = isMaterial ? materialOptions : activityOptions;
    const item = options.find((entry) => optionLabel(entry) === selectedLabel);

    if (!item || !quantity.trim()) {
      setFeedback({
        type: "error",
        message: isMaterial ? "Selecione um material valido e informe a quantidade." : "Selecione uma atividade valida e informe a quantidade.",
        scope: isMaterial ? "materials" : "activities",
      });
      return;
    }

    const numericQuantity = Number(String(quantity).replace(",", "."));
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0 || numericQuantity > LOCATION_ITEM_QTY_LIMIT) {
      setFeedback({
        type: "error",
        message: isMaterial
          ? `A quantidade do material deve ser maior que zero e nao pode ultrapassar ${LOCATION_ITEM_QTY_LIMIT}.`
          : `A quantidade da atividade deve ser maior que zero e nao pode ultrapassar ${LOCATION_ITEM_QTY_LIMIT}.`,
        scope: isMaterial ? "materials" : "activities",
      });
      return;
    }

    setBusy(kind);
    setFeedback(null);
    try {
      await requestLocation(
        `/api/locacao/${kind}`,
        {
          method: "POST",
          body: JSON.stringify(
            isMaterial
              ? { projectId: selectedProject.id, materialId: item.id, quantity }
              : { projectId: selectedProject.id, activityId: item.id, quantity },
          ),
        },
        isMaterial ? "Material adicionado com sucesso." : "Atividade adicionada com sucesso.",
        isMaterial ? "materials" : "activities",
      );
      if (isMaterial) {
        setMaterialSearch("");
        setMaterialQty("");
        setMaterialOptions([]);
      } else {
        setActivitySearch("");
        setActivityQty("");
        setActivityOptions([]);
      }
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : isMaterial ? "Falha ao adicionar material." : "Falha ao adicionar atividade.",
        scope: isMaterial ? "materials" : "activities",
      });
    } finally {
      setBusy(null);
    }
  }

  async function saveRow(kind: "materials" | "activities", id: string) {
    if (!selectedProject) {
      return;
    }

    const draft = kind === "materials" ? materialDrafts[id] : activityDrafts[id];
    if (!draft?.quantity.trim()) {
      setFeedback({ type: "error", message: "Informe a quantidade antes de salvar.", scope: kind });
      return;
    }

    const numericQuantity = Number(String(draft.quantity).replace(",", "."));
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0 || numericQuantity > LOCATION_ITEM_QTY_LIMIT) {
      setFeedback({
        type: "error",
        message:
          kind === "materials"
            ? `A quantidade do material deve ser maior que zero e nao pode ultrapassar ${LOCATION_ITEM_QTY_LIMIT}.`
            : `A quantidade da atividade deve ser maior que zero e nao pode ultrapassar ${LOCATION_ITEM_QTY_LIMIT}.`,
        scope: kind,
      });
      return;
    }

    setBusy(`${kind}-${id}`);
    setFeedback(null);
    try {
      await requestLocation(
        `/api/locacao/${kind}`,
        {
          method: "PUT",
          body: JSON.stringify({
            projectId: selectedProject.id,
            id,
            quantity: draft.quantity,
            observation: draft.observation,
            expectedUpdatedAt: draft.updatedAt ?? null,
          }),
        },
        kind === "materials" ? "Material atualizado com sucesso." : "Atividade atualizada com sucesso.",
        kind,
      );
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : kind === "materials" ? "Falha ao salvar material." : "Falha ao salvar atividade.",
        scope: kind,
      });
    } finally {
      setBusy(null);
    }
  }

  const selectedActivityOption = activityOptions.find((entry) => optionLabel(entry) === activitySearch) ?? null;

  function updateActivityFilterField(field: keyof ListFilterState, value: string) {
    setActivityFilterDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateMaterialFilterField(field: keyof ListFilterState, value: string) {
    setMaterialFilterDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function toggleSupportItem(itemId: string) {
    setSupportItemsDraft((current) =>
      current.map((item) =>
        item.id === itemId
          ? { ...item, isIncluded: !item.isIncluded }
          : item,
      ),
    );
  }

  function toggleRisk(itemId: string) {
    setRiskDraft((current) =>
      current.map((item) =>
        item.id === itemId
          ? { ...item, isActive: !item.isActive }
          : item,
      ),
    );
  }

  function renderFeedback(scope: FeedbackScope) {
    if (!feedback || feedback.scope !== scope) {
      return null;
    }

    return (
      <div className={feedback.type === "success" ? styles.feedbackSuccess : styles.feedbackError}>{feedback.message}</div>
    );
  }

  return (
    <section className={styles.wrapper}>
      <article className={styles.card}>
        <div className={styles.tableHeader}>
          <div>
            <h3 className={styles.cardTitle}>Locacao</h3>
            <p className={styles.tableHint}>
              Filtre o municipio, selecione o projeto por SOB e monte as previsoes sem sobrescrever o previsto original
              do projeto.
            </p>
          </div>
          <div className={styles.tableHeaderActions}>
            {selectedProject ? (
              <div className={styles.headerSelectionGroup}>
                <div className={styles.selectedProjectHint}>
                  {`Projeto selecionado: ${selectedProject.sob} ${selectedProject.city ? `- ${selectedProject.city}` : ""}`}
                </div>
                <div className={styles.summaryHighlight}>
                  Materiais atuais: {formatQuantity(state?.summary?.materialsPlannedTotal ?? 0)} | Atividades atuais:{" "}
                  {formatCurrency(state?.summary?.activitiesPlannedTotal ?? 0)}
                </div>
              </div>
            ) : (
              <div className={styles.emptySelectionHint}>Nenhum projeto selecionado.</div>
            )}
          </div>
        </div>

        <form className={styles.filterGrid} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>Municipio</span>
            <select
              value={selectedCity}
              onChange={(event) => {
                setSelectedCity(event.target.value);
                setSobSearch("");
                setState(null);
              }}
            >
              <option value="">Todos</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span>SOB</span>
            <input list="location-project-list" value={sobSearch} onChange={(event) => setSobSearch(event.target.value)} placeholder="Digite o SOB do projeto" />
            <datalist id="location-project-list">
              {filteredProjects.map((item) => (
                <option key={item.id} value={item.sob}>
                  {item.city}
                </option>
              ))}
            </datalist>
          </label>

          <div className={`${styles.actions} ${styles.formActions}`}>
            <div className={styles.tableHint}>{filteredProjects.length} projeto(s) disponivel(is) com o filtro atual.</div>
            <button type="submit" className={styles.primaryButton} disabled={busy === "open" || !sobSearch.trim() || !session?.accessToken}>
              {busy === "open" ? "Carregando..." : "Abrir locacao"}
            </button>
          </div>
        </form>
      </article>

      {!selectedProject ? (
        <>
          <article className={styles.card}>
            <div className={styles.tableHeader}>
              <div>
                <h3 className={styles.cardTitle}>Filtros</h3>
                <p className={styles.tableHint}>Use a lista abaixo para localizar projetos com ou sem locacao registrada.</p>
              </div>
            </div>

            <div className={styles.filterGrid}>
              <label className={styles.field}>
                <span>Projeto (SOB)</span>
                <input
                  value={overviewFilterDraft.sob}
                  onChange={(event) => setOverviewFilterDraft((current) => ({ ...current, sob: event.target.value }))}
                  placeholder="Filtrar por SOB"
                />
              </label>

              <label className={styles.field}>
                <span>Municipio</span>
                <select
                  value={overviewFilterDraft.city}
                  onChange={(event) => setOverviewFilterDraft((current) => ({ ...current, city: event.target.value }))}
                >
                  <option value="">Todos</option>
                  {cities.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Status</span>
                <select
                  value={overviewFilterDraft.status}
                  onChange={(event) =>
                    setOverviewFilterDraft((current) => ({
                      ...current,
                      status: event.target.value as LocationOverviewFilterState["status"],
                    }))
                  }
                >
                  <option value="">Todos</option>
                  <option value="LOCADO">Locado</option>
                  <option value="NAO_LOCADO">Nao locado</option>
                  <option value="INATIVO">Projeto inativo</option>
                </select>
              </label>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  setActiveOverviewFilter({ ...overviewFilterDraft });
                  setOverviewPage(1);
                }}
              >
                Aplicar
              </button>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => {
                  setOverviewFilterDraft(INITIAL_OVERVIEW_FILTERS);
                  setActiveOverviewFilter(INITIAL_OVERVIEW_FILTERS);
                  setOverviewPage(1);
                }}
              >
                Limpar
              </button>
            </div>
          </article>

          <article className={styles.card}>
            <div className={styles.tableHeader}>
              <div>
                <h3 className={styles.cardTitle}>Lista de Locacoes</h3>
                <p className={styles.tableHint}>
                  {filteredOverviewItems.length} projeto(s) encontrado(s) com o filtro atual. Exibindo ate {OVERVIEW_PAGE_SIZE} por pagina.
                </p>
              </div>
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Projeto (SOB)</th>
                    <th>Municipio</th>
                    <th>Status</th>
                    <th>Locado por</th>
                    <th>Registrado em</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOverviewItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className={styles.emptyRow}>
                        Nenhum projeto encontrado para o filtro informado.
                      </td>
                    </tr>
                  ) : null}
                  {paginatedOverviewItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.sob}</td>
                      <td>{item.city || "-"}</td>
                      <td>
                        <span
                          className={`${styles.statusBadge} ${
                            item.status === "LOCADO"
                              ? styles.statusBadgeSuccess
                              : item.status === "INATIVO"
                                ? styles.statusBadgeMuted
                                : styles.statusBadgeWarning
                          }`}
                        >
                          {formatLocationStatus(item.status)}
                        </span>
                      </td>
                      <td>{item.recordedByName || "-"}</td>
                      <td>{formatDateTime(item.recordedAt)}</td>
                      <td className={styles.actionsCell}>
                        <div className={styles.tableActions}>
                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.actionEdit}`}
                            onClick={() => void openLocationFromOverview(item)}
                            disabled={!item.isActive || busy === "open"}
                            aria-label={item.isActive ? `Editar locacao do projeto ${item.sob}` : `Projeto ${item.sob} inativo`}
                            title={!item.isActive ? "Projeto inativo" : "Editar locacao"}
                          >
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M4.5 19.5h4l9-9a1.4 1.4 0 0 0 0-2l-2-2a1.4 1.4 0 0 0-2 0l-9 9v4Z"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path d="M12.5 7.5l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className={`${styles.actionButton} ${styles.actionView}`}
                            onClick={() => void openLocationDetails(item)}
                            disabled={busy === `detail-${item.id}`}
                            aria-label={`Ver detalhes da locacao do projeto ${item.sob}`}
                            title={busy === `detail-${item.id}` ? "Carregando detalhes" : "Ver detalhes"}
                          >
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.paginationBar}>
              <span className={styles.tableHint}>
                Pagina {overviewPage} de {totalOverviewPages}
              </span>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setOverviewPage((current) => Math.max(1, current - 1))}
                  disabled={overviewPage <= 1}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setOverviewPage((current) => Math.min(totalOverviewPages, current + 1))}
                  disabled={overviewPage >= totalOverviewPages}
                >
                  Proxima
                </button>
              </div>
            </div>
          </article>
        </>
      ) : null}

      {renderFeedback("page")}

      {selectedProject ? (
        <>
          <article className={styles.card}>
            <div className={styles.tabHeader}>
              <button
                type="button"
                className={`${styles.tabButton} ${activeTab === "location" ? styles.tabButtonActive : ""}`}
                onClick={() => setActiveTab("location")}
              >
                {"Loca\u00E7\u00E3o"}
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeTab === "activities" ? styles.tabButtonActive : ""}`}
                onClick={() => setActiveTab("activities")}
              >
                Atividades previstas
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeTab === "materials" ? styles.tabButtonActive : ""}`}
                onClick={() => setActiveTab("materials")}
              >
                Materiais previstos
              </button>
            </div>
          </article>

          {activeTab === "location" ? (
            <>
              <article className={styles.card}>
                <div className={styles.tableHeader}>
                  <div>
                    <h3 className={styles.cardTitle}>Planejamento / Vistoria</h3>
                    <p className={styles.tableHint}>Registre as observacoes gerais e defina as validacoes iniciais da locacao.</p>
                  </div>
                </div>

                <label className={`${styles.field} ${locationValidation.notes ? styles.fieldInvalid : ""}`}>
                  <span>Observacoes</span>
                  <textarea
                    value={notes}
                    onChange={(event) => {
                      setNotes(event.target.value);
                      if (locationValidation.notes && event.target.value.trim()) {
                        setLocationValidation((current) => ({ ...current, notes: false }));
                      }
                    }}
                    placeholder="Registre observacoes operacionais."
                    disabled={!selectedProject}
                  />
                </label>

                <div className={styles.formGrid}>
                  <div className={styles.field}>
                    <span>Necessario revisao de projeto? <strong className={styles.requiredMark}>*</strong></span>
                    <div className={`${styles.radioGroup} ${locationValidation.needsProjectReview ? styles.fieldInvalid : ""}`}>
                      <label className={styles.radioOption}>
                        <input type="radio" name="needsProjectReview" checked={needsProjectReview === true} onChange={() => {
                          setNeedsProjectReview(true);
                          setLocationValidation((current) => ({ ...current, needsProjectReview: false }));
                        }} />
                        <span>Sim</span>
                      </label>
                      <label className={styles.radioOption}>
                        <input type="radio" name="needsProjectReview" checked={needsProjectReview === false} onChange={() => {
                          setNeedsProjectReview(false);
                          setLocationValidation((current) => ({ ...current, needsProjectReview: false }));
                        }} />
                        <span>Nao</span>
                      </label>
                    </div>
                  </div>

                  <div className={styles.field}>
                    <span>Com desligamento? <strong className={styles.requiredMark}>*</strong></span>
                    <div className={`${styles.radioGroup} ${locationValidation.withShutdown ? styles.fieldInvalid : ""}`}>
                      <label className={styles.radioOption}>
                        <input type="radio" name="withShutdown" checked={withShutdown === true} onChange={() => {
                          setWithShutdown(true);
                          setLocationValidation((current) => ({ ...current, withShutdown: false }));
                        }} />
                        <span>Sim</span>
                      </label>
                      <label className={styles.radioOption}>
                        <input type="radio" name="withShutdown" checked={withShutdown === false} onChange={() => {
                          setWithShutdown(false);
                          setLocationValidation((current) => ({ ...current, withShutdown: false }));
                        }} />
                        <span>Nao</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span>Alimentador</span>
                    <input
                      value={feeder}
                      onChange={(event) => setFeeder(event.target.value)}
                      placeholder="Informe o alimentador"
                      disabled={!selectedProject}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Tipo de SGD</span>
                    <select
                      value={sgdTypeId}
                      onChange={(event) => setSgdTypeId(event.target.value)}
                      disabled={!selectedProject}
                    >
                      <option value="">Selecione</option>
                      {sgdTypes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.description}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className={styles.field}>
                    <span>Elemento de corte</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={cutElement}
                      onChange={(event) => handleNonNegativeIntegerChange(setCutElement, event.target.value)}
                      onBlur={() => setCutElement(getNonNegativeIntegerInput(cutElement))}
                      placeholder="0"
                      disabled={!selectedProject}
                    />
                  </label>
                </div>
              </article>

              <article className={styles.card}>
                <div className={styles.tableHeader}>
                  <h3 className={styles.cardTitle}>Equipes para execucao</h3>
                </div>

                <div className={`${styles.formGrid} ${locationValidation.executionTeams ? styles.groupInvalid : ""}`}>
                  <label className={styles.field}>
                    <span>CESTO <strong className={styles.requiredMark}>*</strong></span>
                    <input type="number" min="0" max={LOCATION_TEAM_QTY_LIMIT} step="1" value={teamCestoQty} onChange={(event) => handleNonNegativeIntegerChange(setTeamCestoQty, event.target.value)} onBlur={() => setTeamCestoQty(getNonNegativeIntegerInput(teamCestoQty))} />
                  </label>
                  <label className={styles.field}>
                    <span>LINHA MORTA <strong className={styles.requiredMark}>*</strong></span>
                    <input type="number" min="0" max={LOCATION_TEAM_QTY_LIMIT} step="1" value={teamLinhaMortaQty} onChange={(event) => handleNonNegativeIntegerChange(setTeamLinhaMortaQty, event.target.value)} onBlur={() => setTeamLinhaMortaQty(getNonNegativeIntegerInput(teamLinhaMortaQty))} />
                  </label>
                  <label className={styles.field}>
                    <span>LINHA VIVA <strong className={styles.requiredMark}>*</strong></span>
                    <input type="number" min="0" max={LOCATION_TEAM_QTY_LIMIT} step="1" value={teamLinhaVivaQty} onChange={(event) => handleNonNegativeIntegerChange(setTeamLinhaVivaQty, event.target.value)} onBlur={() => setTeamLinhaVivaQty(getNonNegativeIntegerInput(teamLinhaVivaQty))} />
                  </label>
                  <label className={styles.field}>
                    <span>PODA LINHA MORTA <strong className={styles.requiredMark}>*</strong></span>
                    <input type="number" min="0" max={LOCATION_TEAM_QTY_LIMIT} step="1" value={teamPodaLinhaMortaQty} onChange={(event) => handleNonNegativeIntegerChange(setTeamPodaLinhaMortaQty, event.target.value)} onBlur={() => setTeamPodaLinhaMortaQty(getNonNegativeIntegerInput(teamPodaLinhaMortaQty))} />
                  </label>
                  <label className={styles.field}>
                    <span>PODA LINHA VIVA <strong className={styles.requiredMark}>*</strong></span>
                    <input type="number" min="0" max={LOCATION_TEAM_QTY_LIMIT} step="1" value={teamPodaLinhaVivaQty} onChange={(event) => handleNonNegativeIntegerChange(setTeamPodaLinhaVivaQty, event.target.value)} onBlur={() => setTeamPodaLinhaVivaQty(getNonNegativeIntegerInput(teamPodaLinhaVivaQty))} />
                  </label>
                </div>
              </article>

              <article className={styles.card}>
                <div className={styles.tableHeader}>
                  <h3 className={styles.cardTitle}>Previsao de execucao</h3>
                </div>

                <div className={`${styles.formGrid} ${locationValidation.executionSteps ? styles.groupInvalid : ""}`}>
                  <label className={styles.field}>
                    <span>ETAPAS PREVISTAS <strong className={styles.requiredMark}>*</strong></span>
                    <input type="number" min="0" max={LOCATION_STEPS_LIMIT} step="1" value={executionStepsQty} onChange={(event) => handleNonNegativeIntegerChange(setExecutionStepsQty, event.target.value)} onBlur={() => setExecutionStepsQty(getNonNegativeIntegerInput(executionStepsQty))} />
                  </label>
                </div>

                <div className={styles.toggleList}>
                  {supportItemsDraft.length > 0 ? (
                    supportItemsDraft.map((item) => (
                      <div key={item.id} className={styles.toggleRow}>
                        <span className={styles.toggleRowText}>{item.description}</span>
                        <button
                          type="button"
                          className={item.isIncluded ? styles.dangerButton : styles.successButton}
                          onClick={() => toggleSupportItem(item.id)}
                        >
                          {item.isIncluded ? "Remover" : "Incluir"}
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className={styles.infoBox}>
                      <strong>Nenhum apoio de execucao cadastrado</strong>
                      <span>Cadastre itens em `location_execution_support_items` para exibir nesta lista.</span>
                    </div>
                  )}
                </div>

                <label className={styles.field}>
                  <span>Observacao</span>
                  <textarea
                    value={executionObservation}
                    onChange={(event) => setExecutionObservation(event.target.value)}
                    placeholder="Registre observacoes da previsao de execucao."
                  />
                </label>
              </article>

              <article className={styles.card}>
                <div className={styles.tableHeader}>
                  <h3 className={styles.cardTitle}>Pre APR</h3>
                </div>

                <div className={styles.toggleList}>
                  {riskDraft.length > 0 ? (
                    riskDraft.map((item) => (
                      <div key={item.id} className={styles.toggleRow}>
                        <span className={styles.toggleRowText}>{item.description}</span>
                        <button
                          type="button"
                          className={item.isActive ? styles.dangerButton : styles.successButton}
                          onClick={() => toggleRisk(item.id)}
                        >
                          {item.isActive ? "Remover" : "Incluir"}
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className={styles.infoBox}>
                      <strong>Nenhum risco cadastrado</strong>
                      <span>Cadastre riscos em `project_location_risks` para exibir nesta lista.</span>
                    </div>
                  )}
                </div>

                <label className={styles.field}>
                  <span>Observacao</span>
                  <textarea
                    value={preAprObservation}
                    onChange={(event) => setPreAprObservation(event.target.value)}
                    placeholder="Registre observacoes do pre APR."
                  />
                </label>

                {renderFeedback("location")}

                <div className={styles.actions}>
                  <button type="button" className={styles.secondaryButton} onClick={() => void saveLocation()} disabled={!selectedProject || busy === "notes"}>
                    {busy === "notes" ? "Salvando..." : "Salvar loca\u00E7\u00E3o"}
                  </button>
                </div>
              </article>
            </>
          ) : null}

          {activeTab === "activities" ? (
            <>
              <article className={styles.card}>
                <div className={styles.tableHeader}>
                  <div>
                    <h3 className={styles.cardTitle}>Cadastro de Atividades Previstas</h3>
                    <p className={styles.tableHint}>Use a tabela base de atividades, informe a quantidade e acompanhe o total monetario. A inclusao salva ao adicionar e a edicao salva no botao da linha.</p>
                  </div>
                  <div className={styles.tableHeaderActions}>
                    <div className={styles.totalHighlight}>
                      <span>Total previsto</span>
                      <strong>{formatCurrency(state?.summary?.activitiesPlannedTotal ?? 0)}</strong>
                    </div>
                  </div>
                </div>

                <div className={styles.formGrid}>
                  <label className={`${styles.field} ${styles.fieldWide}`}>
                    <span>Atividade</span>
                    <input list="location-activity-list" value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} placeholder="Digite codigo ou descricao" disabled={!selectedProject} />
                    <datalist id="location-activity-list">
                      {activityOptions.map((item) => (
                        <option key={item.id} value={optionLabel(item)} />
                      ))}
                    </datalist>
                  </label>

                  <label className={styles.field}>
                    <span>Quantidade</span>
                    <input type="number" min="0.01" max={LOCATION_ITEM_QTY_LIMIT} step="0.01" value={activityQty} onChange={(event) => setActivityQty(event.target.value)} placeholder="0,00" disabled={!selectedProject} />
                  </label>

                  <label className={styles.field}>
                    <span>Unidade</span>
                    <input value={selectedActivityOption?.unit ?? ""} placeholder="Selecione a atividade" disabled />
                  </label>

                  <div className={`${styles.actions} ${styles.formActions}`}>
                    <button type="button" className={styles.primaryButton} onClick={() => void addCatalogItem("activities")} disabled={!selectedProject || busy === "activities"}>
                      {busy === "activities" ? "Adicionando..." : "Adicionar atividade"}
                    </button>
                  </div>
                </div>
              </article>

              {renderFeedback("activities")}

              <article className={styles.card}>
                <div className={styles.tableHeader}>
                  <h3 className={styles.cardTitle}>Filtros</h3>
                </div>

                <div className={styles.filterGrid}>
                  <label className={styles.field}>
                    <span>Codigo</span>
                    <input
                      value={activityFilterDraft.code}
                      onChange={(event) => updateActivityFilterField("code", event.target.value)}
                      placeholder="Filtrar por codigo"
                      disabled={!selectedProject}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Descricao</span>
                    <input
                      value={activityFilterDraft.description}
                      onChange={(event) => updateActivityFilterField("description", event.target.value)}
                      placeholder="Filtrar por descricao"
                      disabled={!selectedProject}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Tipo</span>
                    <input
                      value={activityFilterDraft.type}
                      onChange={(event) => updateActivityFilterField("type", event.target.value)}
                      placeholder="Filtrar por tipo"
                      disabled={!selectedProject}
                    />
                  </label>
                </div>

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setActiveActivityFilter({ ...activityFilterDraft })}
                    disabled={!selectedProject}
                  >
                    Aplicar
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => {
                      setActivityFilterDraft(INITIAL_LIST_FILTERS);
                      setActiveActivityFilter(INITIAL_LIST_FILTERS);
                    }}
                    disabled={!selectedProject}
                  >
                    Limpar
                  </button>
                </div>
              </article>

              <article className={styles.card}>
                <div className={styles.tableHeader}>
                  <h3 className={styles.cardTitle}>Lista de Atividades Previstas</h3>
                </div>

                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Codigo</th>
                        <th>Descricao</th>
                        <th>Tipo</th>
                        <th>Unidade</th>
                        <th>Valor unitario</th>
                        <th>Quantidade</th>
                        <th>Observacao</th>
                        <th>Acoes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredActivities.length === 0 ? <tr><td colSpan={8} className={styles.emptyRow}>Nenhuma atividade prevista para o filtro informado.</td></tr> : null}
                      {filteredActivities.map((item) => {
                        const draft = activityDrafts[item.id] ?? { quantity: String(item.plannedQty), observation: item.observation ?? "", updatedAt: item.updatedAt };
                        return (
                          <tr key={item.id}>
                            <td>{item.code}</td>
                            <td>{item.description}</td>
                            <td>{item.teamTypeName || "-"}</td>
                            <td>{item.unit}</td>
                            <td>{formatCurrency(item.unitValue)}</td>
                            <td><input className={styles.tableInput} type="number" min="0.01" max={LOCATION_ITEM_QTY_LIMIT} step="0.01" value={draft.quantity} onChange={(event) => setActivityDrafts((current) => ({ ...current, [item.id]: { ...draft, quantity: event.target.value } }))} /></td>
                            <td><input className={styles.tableInput} value={draft.observation} onChange={(event) => setActivityDrafts((current) => ({ ...current, [item.id]: { ...draft, observation: event.target.value } }))} placeholder="Opcional" /></td>
                            <td className={styles.actionsCell}><div className={styles.tableActions}><button type="button" className={styles.ghostButton} onClick={() => void saveRow("activities", item.id)} disabled={busy === `activities-${item.id}`}>{busy === `activities-${item.id}` ? "Salvando..." : "Salvar"}</button></div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            </>
          ) : null}

          {activeTab === "materials" ? (
            <>
              <article className={styles.card}>
                <div className={styles.tableHeader}>
                  <div>
                    <h3 className={styles.cardTitle}>Cadastro de Materiais Previstos</h3>
                    <p className={styles.tableHint}>Compare o previsto original do projeto com a previsao atual da locacao e adicione materiais extras. A inclusao salva ao adicionar e a edicao salva no botao da linha.</p>
                  </div>
                  <div className={styles.tableHeaderActions}>
                    <div className={styles.totalHighlight}>
                      <span>Total previsto</span>
                      <strong>{formatQuantity(state?.summary?.materialsPlannedTotal ?? 0)}</strong>
                    </div>
                  </div>
                </div>

                <div className={styles.formGrid}>
                  <label className={`${styles.field} ${styles.fieldWide}`}>
                    <span>Material</span>
                    <input list="location-material-list" value={materialSearch} onChange={(event) => setMaterialSearch(event.target.value)} placeholder="Digite codigo ou descricao" disabled={!selectedProject} />
                    <datalist id="location-material-list">
                      {materialOptions.map((item) => (
                        <option key={item.id} value={optionLabel(item)} />
                      ))}
                    </datalist>
                  </label>

                  <label className={styles.field}>
                    <span>Quantidade</span>
                    <input type="number" min="0.01" max={LOCATION_ITEM_QTY_LIMIT} step="0.01" value={materialQty} onChange={(event) => setMaterialQty(event.target.value)} placeholder="0,00" disabled={!selectedProject} />
                  </label>

                  <div className={`${styles.actions} ${styles.formActions}`}>
                    <button type="button" className={styles.primaryButton} onClick={() => void addCatalogItem("materials")} disabled={!selectedProject || busy === "materials"}>
                      {busy === "materials" ? "Adicionando..." : "Adicionar material"}
                    </button>
                  </div>
                </div>
              </article>

              {renderFeedback("materials")}

              <article className={styles.card}>
                <div className={styles.tableHeader}>
                  <h3 className={styles.cardTitle}>Filtros</h3>
                </div>

                <div className={styles.filterGrid}>
                  <label className={styles.field}>
                    <span>Codigo</span>
                    <input
                      value={materialFilterDraft.code}
                      onChange={(event) => updateMaterialFilterField("code", event.target.value)}
                      placeholder="Filtrar por codigo"
                      disabled={!selectedProject}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Descricao</span>
                    <input
                      value={materialFilterDraft.description}
                      onChange={(event) => updateMaterialFilterField("description", event.target.value)}
                      placeholder="Filtrar por descricao"
                      disabled={!selectedProject}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Tipo</span>
                    <input
                      value={materialFilterDraft.type}
                      onChange={(event) => updateMaterialFilterField("type", event.target.value)}
                      placeholder="Filtrar por tipo"
                      disabled={!selectedProject}
                    />
                  </label>
                </div>

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setActiveMaterialFilter({ ...materialFilterDraft })}
                    disabled={!selectedProject}
                  >
                    Aplicar
                  </button>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => {
                      setMaterialFilterDraft(INITIAL_LIST_FILTERS);
                      setActiveMaterialFilter(INITIAL_LIST_FILTERS);
                    }}
                    disabled={!selectedProject}
                  >
                    Limpar
                  </button>
                </div>
              </article>

              <article className={styles.card}>
                <div className={styles.tableHeader}>
                  <h3 className={styles.cardTitle}>Lista de Materiais Previstos</h3>
                </div>

                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Codigo</th>
                        <th>Descricao</th>
                        <th>Tipo</th>
                        <th>Previsto projeto</th>
                        <th>Previsto locacao</th>
                        <th>Diferenca</th>
                        <th>Observacao</th>
                        <th>Acoes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMaterials.length === 0 ? <tr><td colSpan={8} className={styles.emptyRow}>Nenhum material previsto para o filtro informado.</td></tr> : null}
                      {filteredMaterials.map((item) => {
                        const draft = materialDrafts[item.id] ?? { quantity: String(item.plannedQty), observation: item.observation ?? "", updatedAt: item.updatedAt };
                        const currentQty = Number(draft.quantity || item.plannedQty || 0);
                        return (
                          <tr key={item.id}>
                            <td>{item.code}</td>
                            <td>{item.description}</td>
                            <td>{item.type || "-"}</td>
                            <td>{formatQuantity(item.originalQty)}</td>
                            <td><input className={styles.tableInput} type="number" min="0.01" max={LOCATION_ITEM_QTY_LIMIT} step="0.01" value={draft.quantity} onChange={(event) => setMaterialDrafts((current) => ({ ...current, [item.id]: { ...draft, quantity: event.target.value } }))} /></td>
                            <td>{formatQuantity(currentQty - item.originalQty)}</td>
                            <td><input className={styles.tableInput} value={draft.observation} onChange={(event) => setMaterialDrafts((current) => ({ ...current, [item.id]: { ...draft, observation: event.target.value } }))} placeholder="Opcional" /></td>
                            <td className={styles.actionsCell}><div className={styles.tableActions}><button type="button" className={styles.ghostButton} onClick={() => void saveRow("materials", item.id)} disabled={busy === `materials-${item.id}`}>{busy === `materials-${item.id}` ? "Salvando..." : "Salvar"}</button></div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            </>
          ) : null}
        </>
      ) : null}

      {detailLocation ? (
        <div className={styles.modalOverlay} onClick={() => setDetailLocation(null)}>
          <article className={styles.modalCard} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div className={styles.modalTitleBlock}>
                <h4>Detalhes da Locacao {detailLocation.item.sob}</h4>
                <p className={styles.modalSubtitle}>
                  {detailLocation.item.city ? `Municipio: ${detailLocation.item.city}` : "Sem municipio informado"}
                </p>
              </div>
              <button type="button" className={styles.modalCloseButton} onClick={() => setDetailLocation(null)}>
                Fechar
              </button>
            </header>

            <div className={styles.detailGrid}>
              <div><strong>Status:</strong> {formatLocationStatus(detailLocation.item.status)}</div>
              <div><strong>Projeto (SOB):</strong> {detailLocation.item.sob}</div>
              <div><strong>Locado por:</strong> {detailLocation.item.recordedByName || "-"}</div>
              <div><strong>Registrado em:</strong> {formatDateTime(detailLocation.item.recordedAt)}</div>
              <div><strong>Materiais atuais:</strong> {formatQuantity(detailLocation.data?.summary?.materialsPlannedTotal ?? 0)}</div>
              <div><strong>Atividades atuais:</strong> {formatCurrency(detailLocation.data?.summary?.activitiesPlannedTotal ?? 0)}</div>
              <div><strong>Necessario revisao de projeto?:</strong> {detailQuestionnaireSnapshot?.planning.needsProjectReview === true ? "Sim" : detailQuestionnaireSnapshot?.planning.needsProjectReview === false ? "Nao" : "-"}</div>
              <div><strong>Com desligamento?:</strong> {detailQuestionnaireSnapshot?.planning.withShutdown === true ? "Sim" : detailQuestionnaireSnapshot?.planning.withShutdown === false ? "Nao" : "-"}</div>
              <div><strong>Alimentador:</strong> {String(detailQuestionnaireSnapshot?.planning.feeder ?? "-") || "-"}</div>
              <div><strong>Tipo de SGD:</strong> {detailPlanningSgdLabel}</div>
              <div><strong>Elemento de corte:</strong> {String(detailQuestionnaireSnapshot?.planning.cutElement ?? "-")}</div>
              <div><strong>CESTO:</strong> {String(detailQuestionnaireSnapshot?.executionTeams.cestoQty ?? "-")}</div>
              <div><strong>LINHA MORTA:</strong> {String(detailQuestionnaireSnapshot?.executionTeams.linhaMortaQty ?? "-")}</div>
              <div><strong>LINHA VIVA:</strong> {String(detailQuestionnaireSnapshot?.executionTeams.linhaVivaQty ?? "-")}</div>
              <div><strong>PODA LINHA MORTA:</strong> {String(detailQuestionnaireSnapshot?.executionTeams.podaLinhaMortaQty ?? "-")}</div>
              <div><strong>PODA LINHA VIVA:</strong> {String(detailQuestionnaireSnapshot?.executionTeams.podaLinhaVivaQty ?? "-")}</div>
              <div><strong>ETAPAS PREVISTAS:</strong> {String(detailQuestionnaireSnapshot?.executionForecast.stepsPlannedQty ?? "-")}</div>
              <div className={styles.detailWide}><strong>Observacoes:</strong> {detailLocation.data?.plan?.notes || "-"}</div>
              <div className={styles.detailWide}><strong>Observacao da previsao:</strong> {String(detailQuestionnaireSnapshot?.executionForecast.observation ?? "-")}</div>
              <div className={styles.detailWide}><strong>Observacao do Pre APR:</strong> {String(detailQuestionnaireSnapshot?.preApr.observation ?? "-")}</div>
            </div>

            <div className={styles.detailSection}>
              <h5 className={styles.detailSectionTitle}>Previsao de execucao (apoios)</h5>
              <div className={styles.detailList}>
                {(detailQuestionnaireSnapshot?.supportItems.length ?? 0) === 0 ? (
                  <div className={styles.detailListEmpty}>Nenhum item de apoio cadastrado.</div>
                ) : (
                  detailQuestionnaireSnapshot?.supportItems.map((item) => (
                    <div key={item.id} className={styles.detailListItem}>
                      <span>{item.description}</span>
                      <span className={`${styles.detailBadge} ${item.isIncluded ? styles.detailBadgeSuccess : styles.detailBadgeMuted}`}>
                        {item.isIncluded ? "Incluido" : "Removido"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className={styles.detailSection}>
              <h5 className={styles.detailSectionTitle}>Pre APR (riscos)</h5>
              <div className={styles.detailList}>
                {(detailQuestionnaireSnapshot?.risks.length ?? 0) === 0 ? (
                  <div className={styles.detailListEmpty}>Nenhum risco cadastrado.</div>
                ) : (
                  detailQuestionnaireSnapshot?.risks.map((item) => (
                    <div key={item.id} className={styles.detailListItem}>
                      <span>{item.description}</span>
                      <span className={`${styles.detailBadge} ${item.isActive ? styles.detailBadgeSuccess : styles.detailBadgeMuted}`}>
                        {item.isActive ? "Incluido" : "Removido"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
