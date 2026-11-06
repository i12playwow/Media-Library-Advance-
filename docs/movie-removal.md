# Removing movies

Right-click a movie for **Remove from library…** or **Move video file to Recycle Bin…**. Select multiple movie checkboxes to use the corresponding selected-movies toolbar controls. A confirmation lists the selected videos and paths; Cancel is the default.

Library removal deletes the selected movie records and their subtitle associations, while preserving every file on disk. A later scan can add the videos again.

File removal asks the operating system to recycle only the selected video files, then removes their library entries. Subtitle, poster, and other files are left on disk. The app never falls back to permanent deletion if the Recycle Bin is unavailable on an external disk. On failure the movie entry remains and an error is shown. Only regular video files can be recycled, not directories or symbolic links.

Gentle movies require an unlocked Gentle session. The main process accepts movie IDs rather than renderer-provided paths and checks the current path and mode again after confirmation. Stop an active scan before removing movies, to avoid removing entries that the same scan is still importing.

`tests/movieRemoval.test.cjs` covers confirmation cancellation, selected-only removal, file preservation, protected-mode checks, recycling failure, and relinking during confirmation. `tests/runtime/movie-removal.cjs` exercises the context menu, batch toolbar, confirmation behavior, and UI refresh using synthetic media. Its recycling implementation is redirected into the isolated test directory; it does not touch the user's library or Recycle Bin.
