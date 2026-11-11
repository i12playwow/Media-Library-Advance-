import type { LibraryMode, LibraryRoots } from "../shared/contracts";

/**
 * The roots a session may scan. While Gentle mode is locked its saved roots are
 * invisible to the scanner, so a folder scan cannot import or reorganize Gentle
 * content just because the paths are still configured.
 */
export function scanRootsForSession(
  roots: LibraryRoots,
  gentleUnlocked: boolean
): LibraryRoots {
  return gentleUnlocked
    ? { normal: [...roots.normal], gentle: [...roots.gentle] }
    : { normal: [...roots.normal], gentle: [] };
}

/** Gentle rows are only readable or changeable during an unlocked session. */
export function canAccessMovie(
  libraryMode: LibraryMode,
  gentleUnlocked: boolean
): boolean {
  return libraryMode !== "gentle" || gentleUnlocked;
}
