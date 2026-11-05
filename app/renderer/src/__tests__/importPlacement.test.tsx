import React from "react";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanOptionsDialog } from "../components/ScanOptionsDialog";
import { DEFAULT_SCAN_OPTIONS } from "../../../services/libraryScanner";
import { DEFAULT_ORGANIZATION_SETTINGS } from "../../../shared/organizationTemplates";

afterEach(cleanup);

describe("import placement", () => {
  it("offers in-place import with optional conversion that preserves the original", () => {
    const onChange = vi.fn();
    render(<ScanOptionsDialog pendingScanMode="normal"
      organizationDraft={DEFAULT_ORGANIZATION_SETTINGS}
      scanOptionsDraft={{ ...DEFAULT_SCAN_OPTIONS, moveRename: false,
        autoConvertToMp4: true, autoResolveDuplicates: true }}
      scanSourceMode="folder" onChangeScanOption={onChange}
      onChangeScanSource={vi.fn()} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Import in place/ })).toBeChecked();
    const conversion = screen.getByRole("checkbox", { name: /Convert to MP4/ });
    expect(conversion).toBeEnabled();
    expect(conversion).toBeChecked();
    fireEvent.click(conversion);
    expect(onChange).toHaveBeenCalledWith("autoConvertToMp4", false);
    const duplicates = screen.getByRole("checkbox", { name: /Auto-resolve duplicates/ });
    expect(duplicates).toBeEnabled();
    expect(duplicates).toBeChecked();
    fireEvent.click(duplicates);
    expect(onChange).toHaveBeenCalledWith("autoResolveDuplicates", false);
    const longPaths = screen.getByRole("checkbox", { name: /Resolve long/ });
    expect(longPaths).toBeEnabled();
    fireEvent.click(longPaths);
    expect(onChange).toHaveBeenCalledWith("resolveLongPath", false);
    fireEvent.click(screen.getByRole("radio", { name: /Move and rename/ }));
    expect(onChange).toHaveBeenCalledWith("moveRename", true);
  });
});
