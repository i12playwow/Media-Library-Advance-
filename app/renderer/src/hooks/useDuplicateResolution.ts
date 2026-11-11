import type { Dispatch, SetStateAction } from "react";
import type { DuplicateGroup } from "../../../shared/contracts";

type DesktopApi = NonNullable<typeof window.desktopApi>;
type FailedDeletion = { path: string; error: string };

interface UseDuplicateResolutionOptions {
  desktopApi: DesktopApi | undefined;
  duplicateGroups: DuplicateGroup[];
  duplicateSelections: Record<string, string>;
  setDuplicateGroups: Dispatch<SetStateAction<DuplicateGroup[]>>;
  setStatusMessage: (message: string) => void;
}

function failureMessage(failed: FailedDeletion[]): string {
  return `${failed.length} duplicate file(s) were not deleted: ${failed[0].error}`;
}

export function useDuplicateResolution({
  desktopApi,
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
    // Gentle state lives in the main process; the renderer no longer asserts it.
    const result = await desktopApi.resolveDuplicate(keepPath, deletePaths);
    if (result.failed.length > 0) {
      // Keep the group on screen so the user can review what stayed on disk.
      setStatusMessage(failureMessage(result.failed));
      return;
    }
    if (result.blocked > 0)
      setStatusMessage(
        `${result.blocked} gentle-library file(s) removed from library but not deleted (unlock to delete).`
      );
    setDuplicateGroups((prev) => prev.filter((g) => g.key !== groupKey));
  }

  async function resolveAll() {
    if (!desktopApi) return;
    const resolvedKeys = new Set<string>();
    let totalBlocked = 0;
    let failures: FailedDeletion[] | null = null;
    for (const group of duplicateGroups) {
      const keepPath = duplicateSelections[group.key] ?? group.files[0].path;
      const deletePaths = group.files.map((f) => f.path).filter((p) => p !== keepPath);
      const result = await desktopApi.resolveDuplicate(keepPath, deletePaths);
      totalBlocked += result.blocked;
      if (result.failed.length > 0) {
        failures ??= result.failed;
      } else {
        resolvedKeys.add(group.key);
      }
    }
    setDuplicateGroups((prev) => prev.filter((g) => !resolvedKeys.has(g.key)));
    if (failures) {
      setStatusMessage(failureMessage(failures));
      return;
    }
    if (totalBlocked > 0)
      setStatusMessage(
        `${totalBlocked} gentle-library file(s) removed from library but not deleted (unlock to delete).`
      );
  }

  function skipAll() {
    setDuplicateGroups([]);
  }

  return { resolveGroup, resolveAll, skipAll };
}
