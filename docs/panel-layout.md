# Panel layout and Sub-Gen modes

Sub-Gen has Normal and Gentle subtabs. Gentle requires the existing unlock and returns to Normal when locked; both the list and selected video use the current mode filter.

Panels that share a layout container can be reordered with their Move handle. Drag a handle onto another panel in the same group, use its up/down buttons, or focus the handle and press Up/Down. Form controls continue to work normally. Panel order is saved locally per page and container; Reset panel layout clears saved orders across pages. Panels remain in their layout rather than floating over one another.

The shared renderer helper uses CSS order without relocating React-owned nodes. It preserves existing grid/flex layouts and gives block containers a column layout. Dialogs are excluded. Source and deployed snapshot load the same panel-layout assets.

Validation: tests/runtime/panel-reorder.cjs exercises pointer dragging, button/keyboard moves, persistence and reset in an isolated Electron profile. tests/runtime/subgen-mode-tabs.cjs verifies mode separation and locking.

The left navigation sidebar resizes from its right edge (visible grip). Its width follows the --sidebarWidth setting and is saved locally as mla-sidebar-width. Collapsing uses a 44px minimum/maximum rather than the expanded 180px minimum. tests/runtime/sidebar-resize.cjs verifies rendered width, reload persistence, collapse, and expansion.
