import type { Dispatch, SetStateAction } from "react";
import type { AppShellState, DuplicateGroup } from "../../../shared/contracts";

type DesktopApi = NonNullable<typeof window.desktopApi>;

interface UseDuplicateResolutionOptions {
  desktopApi: DesktopApi | undefined;
  appState: AppShellState | null;
  duplicateGroups: DuplicateGroup[];
  duplicateSelections: Record<string, string>;
  setDuplicateGroups: Dispatch<SetStateAction<DuplicateGroup[]>>;
  setStatusMessage: (message: string) => void;
}

export function useDuplicateResolution({
  desktopApi,
  appState,
  duplicateGroups,
  duplicateSelections,
  setDuplicateGroups,
  setStatusMessage,
}: UseDuplicateResolutionOptions) {
  async function resolveGroup(groupKey: string) {
    if (!desktopApi) return;
    const group = duplicateGroups.find((g) => g.key === groupKey);
    if (!group) return;
    const keepPath = duplicateSelections[groupKey] ?? group.files[0].path;
    const deletePaths = group.files.map((f) => f.path).filter((p) => p !== keepPath);
    const result = await desktopApi.resolveDuplicate(keepPath, deletePaths, appState?.gentleUnlocked);
    if (result.blocked > 0)
      setStatusMessage(
        `${result.blocked} gentle-library file(s) removed from library but not deleted (unlock to delete).`
      );
    setDuplicateGroups((prev) => prev.filter((g) => g.key !== groupKey));
  }

  async function resolveAll() {
    if (!desktopApi) return;
    let totalBlocked = 0;
    for (const group of duplicateGroups) {
      const keepPath = duplicateSelections[group.key] ?? group.files[0].path;
      const deletePaths = group.files.map((f) => f.path).filter((p) => p !== keepPath);
      const result = await desktopApi.resolveDuplicate(keepPath, deletePaths, appState?.gentleUnlocked);
      totalBlocked += result.blocked;
    }
    if (totalBlocked > 0)
      setStatusMessage(
        `${totalBlocked} gentle-library file(s) removed from library but not deleted (unlock to delete).`
      );
    setDuplicateGroups([]);
  }

  function skipAll() {
    setDuplicateGroups([]);
  }

  return { resolveGroup, resolveAll, skipAll };
}
