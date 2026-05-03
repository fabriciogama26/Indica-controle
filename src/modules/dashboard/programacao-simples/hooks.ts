import { useDeferredValue, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { fetchActivityCatalog, fetchNextEtapaNumber } from "./api";
import type { ActivityCatalogItem, FormState } from "./types";

export function useProgrammingActivityCatalog(params: {
  accessToken: string | null;
  search: string;
}) {
  const deferredSearch = useDeferredValue(params.search);
  const [activityOptions, setActivityOptions] = useState<ActivityCatalogItem[]>([]);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);

  useEffect(() => {
    if (!params.accessToken || deferredSearch.trim().length < 2) {
      setActivityOptions([]);
      setIsLoadingActivities(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoadingActivities(true);
      try {
        const data = await fetchActivityCatalog({
          accessToken: params.accessToken ?? "",
          query: deferredSearch.trim(),
          signal: controller.signal,
        });
        setActivityOptions(data?.items ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setActivityOptions([]);
        }
      } finally {
        setIsLoadingActivities(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [params.accessToken, deferredSearch]);

  return {
    activityOptions,
    isLoadingActivities,
  };
}

export function useProgrammingEtapaSuggestion(params: {
  accessToken: string | null;
  form: FormState;
  isEditing: boolean;
  isEtapaManuallyEdited: boolean;
  isVisualizationMode: boolean;
  setForm: Dispatch<SetStateAction<FormState>>;
  setInvalidFields: Dispatch<SetStateAction<string[]>>;
  setIsEtapaManuallyEdited: Dispatch<SetStateAction<boolean>>;
}) {
  const {
    accessToken,
    form,
    isEditing,
    isEtapaManuallyEdited,
    isVisualizationMode,
    setForm,
    setInvalidFields,
    setIsEtapaManuallyEdited,
  } = params;

  useEffect(() => {
    if (isEditing) {
      return;
    }

    setIsEtapaManuallyEdited(false);
  }, [form.projectId, form.date, form.teamIds, isEditing, setIsEtapaManuallyEdited]);

  useEffect(() => {
    if (isVisualizationMode || isEditing || !accessToken) {
      return;
    }

    if (!form.projectId || !form.date || !form.teamIds.length || form.etapaUnica || form.etapaFinal) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const nextEtapaNumber = await fetchNextEtapaNumber({
          accessToken,
          projectId: form.projectId,
          date: form.date,
          teamIds: form.teamIds,
          signal: controller.signal,
        });
        if (!nextEtapaNumber) {
          return;
        }

        setForm((current) => {
          if (current.projectId !== form.projectId || current.date !== form.date) {
            return current;
          }

          const sameTeamSelection =
            current.teamIds.length === form.teamIds.length
            && current.teamIds.every((teamId) => form.teamIds.includes(teamId));

          if (!sameTeamSelection) {
            return current;
          }

          if (isEtapaManuallyEdited && current.etapaNumber.trim()) {
            return current;
          }

          return { ...current, etapaNumber: String(nextEtapaNumber) };
        });
        setInvalidFields((current) => current.filter((item) => item !== "etapaNumber"));
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          return;
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [
    accessToken,
    form.date,
    form.etapaFinal,
    form.etapaUnica,
    form.projectId,
    form.teamIds,
    isEditing,
    isEtapaManuallyEdited,
    isVisualizationMode,
    setForm,
    setInvalidFields,
  ]);
}
