"use strict";

function createLibraryMove({ database, dialog, moveMovie, getWindow, isUnlocked, isScanning }) {
  let busy = false;

  async function run(event, ids, mode) {
    const window = getWindow();
    if (!window || event.sender !== window.webContents) throw new Error("Use the main library window to move movies.");
    if (mode !== "normal" && mode !== "gentle") throw new Error("Choose Normal or Gentle.");
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new Error("Invalid movie selection.");
    if (busy || isScanning()) throw new Error("Wait for the current scan or library move to finish.");

    const result = { moved: [], failed: [], skipped: 0, cancelled: false };
    const selection = [...new Set(ids)];
    const checkAccess = movie => {
      if ((mode === "gentle" || movie.libraryMode === "gentle") && !isUnlocked()) {
        throw new Error("Unlock Gentle mode before moving these movies.");
      }
    };
    const label = mode === "normal" ? "Normal" : "Gentle";
    busy = true;
    try {
      if (mode === "gentle" && !isUnlocked()) throw new Error("Unlock Gentle mode before moving these movies.");
      const choice = await dialog.showMessageBox(window, {
        type: "question",
        title: "Move movies between libraries",
        message: `Move ${selection.length} selected ${selection.length === 1 ? "movie" : "movies"} to ${label}?`,
        detail: "Keep files in place changes the library only. Move files on disk also relocates the video and its registered subtitles to the destination library folder.",
        buttons: ["Keep files in place", "Move files on disk", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (choice.response !== 0 && choice.response !== 1) {
        result.cancelled = true;
        return result;
      }

      for (const id of selection) {
        try {
          const movie = database.getMovie(id);
          if (!movie) throw new Error("Movie no longer exists in the library.");
          checkAccess(movie);
          if (movie.libraryMode === mode) {
            result.skipped++;
            continue;
          }
          if (choice.response === 1) {
            await moveMovie(database, id, mode);
          } else {
            database.updateMovieMode(id, mode);
          }
          result.moved.push(id);
        } catch (error) {
          result.failed.push({ id, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (result.failed.length) {
        const messages = [...new Set(result.failed.map(item => item.error))];
        await dialog.showMessageBox(window, {
          type: "warning",
          title: "Library move results",
          message: `${result.moved.length} moved, ${result.skipped} already in ${label}, ${result.failed.length} failed.`,
          detail: messages.slice(0, 8).join("\n"),
        });
      }
      return result;
    } finally {
      busy = false;
    }
  }

  return { run, isBusy: () => busy };
}

module.exports = { createLibraryMove };
