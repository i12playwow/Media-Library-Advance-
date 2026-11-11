# Sticky browse controls

The header at `/html/body/div/div/main/div[2]/section/div/div[1]` is pinned on actress browsing, and the corresponding Library header is pinned too. Controls remain available while scrolling through posters.

The shared browse-toolbar renderer assets measure the main search bar with ResizeObserver, place the pinned header below it, and update the offset when window/sidebar size changes. Headers have opaque dark/light backgrounds, stay below menus/dialogs, and gain an internal scrollbar when the available height is too small. Poster scroll margins account for the pinned controls. Detached player windows are excluded.

Verification: tests/runtime/sticky-browse-toolbar.cjs checks the exact XPath, Library and actress scroll positions, functional buttons/sorting, opaque backgrounds and smaller-window layout using an isolated 450-movie fixture. Component suite: 231 tests.
