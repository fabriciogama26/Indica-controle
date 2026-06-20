export const TEAM_COMPOSITION_UPDATED_EVENT = "team-composition-updated";
export const TEAM_COMPOSITION_UPDATED_STORAGE_KEY = "saas:team-composition-updated";

export function notifyTeamCompositionUpdated() {
  if (typeof window === "undefined") {
    return;
  }

  const updatedAt = new Date().toISOString();
  window.dispatchEvent(new CustomEvent(TEAM_COMPOSITION_UPDATED_EVENT, { detail: { updatedAt } }));

  try {
    window.localStorage.setItem(TEAM_COMPOSITION_UPDATED_STORAGE_KEY, updatedAt);
  } catch {
    // The current tab event still refreshes consumers when storage is unavailable.
  }
}
