export const MODE_ENTRY_TYPE = "pistack-mode";

/**
 * Poteto Mode is session-scoped. The latest recorded toggle on the active branch wins,
 * so a resumed or forked session keeps whatever the branch last said.
 */
export function modeFromEntries(entries: readonly unknown[]): boolean {
  let active = false;
  for (const candidate of entries) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const entry = candidate as { type?: unknown; customType?: unknown; data?: unknown };
    if (entry.type !== "custom" || entry.customType !== MODE_ENTRY_TYPE) continue;
    const data = entry.data;
    if (typeof data === "object" && data !== null && typeof (data as { active?: unknown }).active === "boolean") {
      active = (data as { active: boolean }).active;
    }
  }
  return active;
}

export function modeInstruction(namespace: string, skillPath: string): string {
  return `<${namespace}-poteto-mode>
Poteto Mode is active for this session. Before acting on the user's request, read ${skillPath} in full, including its Principles index, and follow it. Read each leaf principle skill you apply. Pi policy and the user's explicit instructions still override anything in that skill. Turn this off with /${namespace}-mode off.
</${namespace}-poteto-mode>`;
}
