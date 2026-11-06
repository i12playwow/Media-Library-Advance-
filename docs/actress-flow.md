# Actress workflow

Open **Actresses** to browse profiles from the accessible library. Search by actress name, studio, or tag; narrow by region or library mode; and sort by name, movie count, studio, or tag. Locked Gentle movies are excluded from the directory, counts, movie picker, and linking requests.

To create or extend a profile:

1. Choose **Add actress to movies**, or open a profile and choose **Link more movies**.
2. Enter an actress name or choose an existing name from the suggestions.
3. Find library movies by title, code, or filename. Select individual movies or **Select shown movies** (up to 60 visible matches at a time).
4. Choose **Save actress and movies**. The profile opens with the linked titles. Existing cast names, poster data, movie paths, and video files are preserved.

An actress profile provides its library movie grid and search, direct playback, a region field, and photo management. Add photos, click a gallery photo to make it primary, or use its Remove button. Return with **All actresses**. The directory renders 80 profiles at a time; movie grids render 60 titles at a time, with explicit load-more controls to avoid mounting an entire large collection.

Profiles are based on movies already in the library. Scan or connect the media disk first if a video is missing. A whole-system scan may initially identify a movie by code without cast metadata; manual linking supplies the actress association. Creating an empty, unlinked profile is not part of this flow.

The main-process `actress:linkMovies` command accepts movie IDs, validates names, preserves existing cast names, avoids duplicate associations, and rejects locked Gentle entries. Linking is blocked while a scan is active to avoid racing metadata imports.

Tests: `node --test tests/actressMovies.test.cjs` covers metadata preservation, duplicate prevention, input validation, and Gentle mode. `node tests/runtime/actress-flow.cjs` exercises the directory, linking dialog, persistent association, profile grid, and player navigation in an isolated synthetic library. It also checks browser-console errors and captures screenshots under ignored diagnostics.
