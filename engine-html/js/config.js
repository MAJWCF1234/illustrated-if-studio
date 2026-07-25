/** Resolved at boot from /api/settings so the player follows the active studio project. */
export let PROJECT_BASE = new URL("../../projects/sample-project/", import.meta.url);

export async function initProjectBase() {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return PROJECT_BASE;
    const s = await res.json();
    if (s.projectUrl) {
      PROJECT_BASE = new URL(s.projectUrl, window.location.origin);
    } else if (s.activeProjectId) {
      PROJECT_BASE = new URL(`../../projects/${s.activeProjectId}/`, import.meta.url);
    }
  } catch {
    /* keep default */
  }
  return PROJECT_BASE;
}
