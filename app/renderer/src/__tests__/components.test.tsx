import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PosterVisual } from "../components/PosterVisual";
import { SamplePosterCard } from "../components/SamplePosterCard";
import { ScanToast } from "../components/ScanToast";
import { AppTopBar } from "../components/AppTopBar";
import { AppSidebar } from "../components/AppSidebar";
import { PlayerPopup } from "../components/PlayerPopup";
import { PinPromptDialog } from "../components/PinPromptDialog";
import { ContextMenu } from "../components/ContextMenu";
import { DuplicateResolutionModal } from "../components/DuplicateResolutionModal";
import { MovieTile } from "../components/MovieTile";
import { ScanOptionsDialog } from "../components/ScanOptionsDialog";
import { defaultScanOptions } from "../hooks/useSettings";
import { DEFAULT_ORGANIZATION_SETTINGS } from "../../../shared/organizationTemplates";
import type { DuplicateGroup, MovieRecord, ScanProgress } from "../../../shared/contracts";

// ---------------------------------------------------------------------------
// SamplePosterCard
// ---------------------------------------------------------------------------
describe("SamplePosterCard", () => {
  const sample = { title: "Iron Man", year: "2008", accent: "linear-gradient(180deg, #f00, #000)" };

  it("renders the title", () => {
    render(<SamplePosterCard sample={sample} />);
    expect(screen.getByText("Iron Man")).toBeInTheDocument();
  });

  it("renders the year", () => {
    render(<SamplePosterCard sample={sample} />);
    expect(screen.getByText("2008")).toBeInTheDocument();
  });

  it("applies the accent as inline background style", () => {
    const { container } = render(<SamplePosterCard sample={sample} />);
    const card = container.firstChild as HTMLElement;
    expect(card.style.background).toBe(sample.accent);
  });

  it("applies base class without small prop", () => {
    const { container } = render(<SamplePosterCard sample={sample} />);
    expect((container.firstChild as HTMLElement).className).toBe("sample-poster");
  });

  it("applies small class when small prop is true", () => {
    const { container } = render(<SamplePosterCard sample={sample} small />);
    expect((container.firstChild as HTMLElement).className).toBe("sample-poster small");
  });

  it("renders the 'Featured' label", () => {
    render(<SamplePosterCard sample={sample} />);
    expect(screen.getByText("Featured")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PosterVisual
// ---------------------------------------------------------------------------
describe("PosterVisual", () => {
  it("renders <img> when posterUrl is present", () => {
    const movie = makeMovie({ posterUrl: "https://example.com/poster.jpg" });
    render(<PosterVisual movie={movie} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/poster.jpg");
    expect(img).toHaveAttribute("alt", movie.title);
  });

  it("renders fallback div when posterUrl is null", () => {
    const movie = makeMovie({ posterUrl: null });
    const { container } = render(<PosterVisual movie={movie} />);
    expect(container.querySelector(".poster-fallback")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows movie title in fallback", () => {
    const movie = makeMovie({ posterUrl: null, title: "Unique Movie Title" });
    render(<PosterVisual movie={movie} />);
    expect(screen.getByText("Unique Movie Title")).toBeInTheDocument();
  });

  it("shows year and resolution in fallback", () => {
    const movie = makeMovie({ posterUrl: null, year: 2022, resolution: "4K" });
    render(<PosterVisual movie={movie} />);
    expect(screen.getByText(/2022/)).toBeInTheDocument();
    expect(screen.getByText(/4K/)).toBeInTheDocument();
  });

  it("shows Unknown year when year is null", () => {
    const movie = makeMovie({ posterUrl: null, year: null });
    render(<PosterVisual movie={movie} />);
    expect(screen.getByText(/Unknown year/)).toBeInTheDocument();
  });

  it("applies base class by default", () => {
    const { container } = render(<PosterVisual movie={makeMovie()} />);
    expect((container.firstChild as HTMLElement).className).toBe("poster-visual");
  });

  it("badges the specific web source that served the poster", () => {
    for (const [posterSource, badge] of [
      ["javdatabase", "JDB"],
      ["javbus", "JAVBUS"],
      ["imdb", "IMDB"],
      ["tmdb", "TMDB"],
      ["web", "WEB"]
    ] as const) {
      const { unmount } = render(<PosterVisual movie={makeMovie({ posterSource })} />);
      expect(screen.getByText(badge)).toBeInTheDocument();
      unmount();
    }
  });

  it("shows no badge for local posters or missing posters", () => {
    const local = render(<PosterVisual movie={makeMovie({ posterSource: "local", posterUrl: "data:image/jpeg;base64,x" })} />);
    expect(local.container.querySelector(".poster-source-badge")).toBeNull();
    local.unmount();
    const none = render(<PosterVisual movie={makeMovie({ posterSource: "none", posterUrl: null })} />);
    expect(none.container.querySelector(".poster-source-badge")).toBeNull();
  });

  it("applies compact class", () => {
    const { container } = render(<PosterVisual movie={makeMovie()} compact />);
    expect((container.firstChild as HTMLElement).className).toBe("poster-visual compact");
  });

  it("applies detail class (overrides compact)", () => {
    const { container } = render(<PosterVisual movie={makeMovie()} detail compact />);
    expect((container.firstChild as HTMLElement).className).toBe("poster-visual detail");
  });

  it("renders the poster-shade overlay", () => {
    const { container } = render(<PosterVisual movie={makeMovie()} />);
    expect(container.querySelector(".poster-shade")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function makeMovie(overrides: Partial<MovieRecord> = {}): MovieRecord {
  return {
    id: "test-id",
    title: "Test Movie",
    videoId: "TEST-001",
    year: 2023,
    resolution: "1080p",
    posterUrl: "https://example.com/poster.jpg",
    posterSource: "web",
    sourcePath: "C:/library/normal/test.mp4",
    folderPath: "C:/library/normal",
    libraryMode: "normal",
    actresses: [],
    keywords: [],
    subtitles: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ScanToast
// ---------------------------------------------------------------------------
describe("ScanToast", () => {
  function makeScanProgress(overrides: Partial<ScanProgress> = {}): ScanProgress {
    return {
      stage: "processing",
      mode: "normal",
      currentRoot: null,
      currentFile: "movie.mp4",
      processedFiles: 10,
      totalFiles: 20,
      imported: 10,
      skipped: 0,
      message: "",
      ...overrides,
    };
  }

  it("shows scanning label when isScanning is true", () => {
    render(
      <ScanToast
        scanProgress={makeScanProgress()}
        isScanning={true}
        progressPercent={50}
        scanStageLabel="Importing…"
        onCancel={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText(/Scanning/)).toBeInTheDocument();
  });

  it("shows complete label when isScanning is false", () => {
    render(
      <ScanToast
        scanProgress={makeScanProgress()}
        isScanning={false}
        progressPercent={100}
        scanStageLabel="Done"
        onCancel={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText(/Scan complete/)).toBeInTheDocument();
  });

  it("shows stop button when scanning", () => {
    render(
      <ScanToast
        scanProgress={makeScanProgress()}
        isScanning={true}
        progressPercent={30}
        scanStageLabel="Importing…"
        onCancel={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByTitle("Stop scan (Esc)")).toBeInTheDocument();
  });

  it("shows dismiss button when done", () => {
    render(
      <ScanToast
        scanProgress={makeScanProgress()}
        isScanning={false}
        progressPercent={100}
        scanStageLabel="Done"
        onCancel={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByTitle("Dismiss")).toBeInTheDocument();
  });

  it("shows progress counts", () => {
    render(
      <ScanToast
        scanProgress={makeScanProgress({ imported: 7, totalFiles: 42 })}
        isScanning={true}
        progressPercent={17}
        scanStageLabel="Stage"
        onCancel={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText(/7\/42 movies/)).toBeInTheDocument();
  });

  it("shows the stage label", () => {
    render(
      <ScanToast
        scanProgress={makeScanProgress()}
        isScanning={true}
        progressPercent={50}
        scanStageLabel="Fetching posters"
        onCancel={() => {}}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText("Fetching posters")).toBeInTheDocument();
  });

  it("applies 'active' class when scanning", () => {
    const { container } = render(
      <ScanToast
        scanProgress={makeScanProgress()}
        isScanning={true}
        progressPercent={50}
        scanStageLabel="Stage"
        onCancel={() => {}}
        onDismiss={() => {}}
      />
    );
    expect((container.firstChild as HTMLElement).className).toContain("active");
  });

  it("applies 'done' class when not scanning", () => {
    const { container } = render(
      <ScanToast
        scanProgress={makeScanProgress()}
        isScanning={false}
        progressPercent={100}
        scanStageLabel="Stage"
        onCancel={() => {}}
        onDismiss={() => {}}
      />
    );
    expect((container.firstChild as HTMLElement).className).toContain("done");
  });
});

// ---------------------------------------------------------------------------
// AppTopBar
// ---------------------------------------------------------------------------
describe("AppTopBar", () => {
  it("shows the gentle status indicator in locked state", () => {
    render(
      <AppTopBar
        searchInput=""
        onSearchChange={() => {}}
        isScanning={false}
        onOpenScanOptions={() => {}}
        onCancelScan={() => {}}
        gentleUnlocked={false}
        scanProgress={null}
        scanStageLabel="Idle"
        lastScanSummaryInvalidFiles={[]}
        getRejectedStatusLabel={() => "Invalid"}
      />
    );
    expect(screen.getByText(/gentle off/i)).toBeInTheDocument();
    expect(screen.getByText(/ctrl\+alt\+d/i)).toBeInTheDocument();
  });

  it("shows the gentle status indicator in unlocked state", () => {
    render(
      <AppTopBar
        searchInput=""
        onSearchChange={() => {}}
        isScanning={false}
        onOpenScanOptions={() => {}}
        onCancelScan={() => {}}
        gentleUnlocked={true}
        scanProgress={null}
        scanStageLabel="Idle"
        lastScanSummaryInvalidFiles={[]}
        getRejectedStatusLabel={() => "Invalid"}
      />
    );
    expect(screen.getByText(/gentle on/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PinPromptDialog
// ---------------------------------------------------------------------------
describe("PinPromptDialog", () => {
  it("renders the PIN prompt shell", () => {
    render(
      <PinPromptDialog
        pinInput=""
        onPinChange={() => {}}
        onUnlock={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByPlaceholderText("Enter PIN")).toBeInTheDocument();
  });

  it("renders the PIN input", () => {
    render(
      <PinPromptDialog
        pinInput="1234"
        onPinChange={() => {}}
        onUnlock={() => {}}
        onClose={() => {}}
      />
    );
    const input = screen.getByPlaceholderText("Enter PIN") as HTMLInputElement;
    expect(input.value).toBe("1234");
  });

  it("renders Unlock and Cancel buttons", () => {
    render(
      <PinPromptDialog
        pinInput=""
        onPinChange={() => {}}
        onUnlock={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /unlock/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ContextMenu
// ---------------------------------------------------------------------------
describe("ContextMenu", () => {
  const baseMenu = { movie: makeMovie({ title: "Action Flick", videoId: "ACT-001" }), x: 100, y: 200 };
  const noop = () => {};

  it("shows the movie title in the menu", () => {
    render(
      <ContextMenu
        contextMenu={baseMenu}
        isSelected={false}
        onClose={noop} onOpenInPlayer={noop} onOpenExternal={noop}
        onShowInFolder={noop} onRefreshPoster={noop} onMove={noop}
        onToggleSelect={noop} onCopyPath={noop}
      />
    );
    expect(screen.getByText("Action Flick")).toBeInTheDocument();
  });

  it("shows 'Copy DVD ID' when onCopyVideoId is provided", () => {
    render(
      <ContextMenu
        contextMenu={baseMenu}
        isSelected={false}
        onClose={noop} onOpenInPlayer={noop} onOpenExternal={noop}
        onShowInFolder={noop} onRefreshPoster={noop} onMove={noop}
        onToggleSelect={noop} onCopyPath={noop}
        onCopyVideoId={noop}
      />
    );
    expect(screen.getByText(/Copy DVD ID/i)).toBeInTheDocument();
  });

  it("does not show 'Copy DVD ID' when onCopyVideoId is absent", () => {
    render(
      <ContextMenu
        contextMenu={baseMenu}
        isSelected={false}
        onClose={noop} onOpenInPlayer={noop} onOpenExternal={noop}
        onShowInFolder={noop} onRefreshPoster={noop} onMove={noop}
        onToggleSelect={noop} onCopyPath={noop}
      />
    );
    expect(screen.queryByText(/Copy DVD ID/i)).toBeNull();
  });

  it("shows 'Deselect' when movie is selected", () => {
    render(
      <ContextMenu
        contextMenu={baseMenu}
        isSelected={true}
        onClose={noop} onOpenInPlayer={noop} onOpenExternal={noop}
        onShowInFolder={noop} onRefreshPoster={noop} onMove={noop}
        onToggleSelect={noop} onCopyPath={noop}
      />
    );
    expect(screen.getByText(/Deselect/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DuplicateResolutionModal
// ---------------------------------------------------------------------------
describe("DuplicateResolutionModal", () => {
  function makeGroup(overrides: Partial<DuplicateGroup> = {}): DuplicateGroup {
    return {
      key: "group-1",
      videoId: "DUP-001",
      title: "Duplicate Movie",
      files: [
        { path: "/lib/a.mp4", resolution: "1080p", fileSize: 1000, autoSelected: true },
        { path: "/lib/b.mp4", resolution: "1080p", fileSize: 900, autoSelected: false },
      ],
      ...overrides,
    };
  }

  it("shows the group count heading", () => {
    render(
      <DuplicateResolutionModal
        duplicateGroups={[makeGroup(), makeGroup({ key: "group-2" })]}
        duplicateSelections={{}}
        onSelectFile={() => {}} onResolveGroup={() => {}}
        onResolveAll={() => {}} onSkipAll={() => {}}
      />
    );
    expect(screen.getByText(/2 groups need your decision/i)).toBeInTheDocument();
  });

  it("shows singular 'group' for a single duplicate", () => {
    render(
      <DuplicateResolutionModal
        duplicateGroups={[makeGroup()]}
        duplicateSelections={{}}
        onSelectFile={() => {}} onResolveGroup={() => {}}
        onResolveAll={() => {}} onSkipAll={() => {}}
      />
    );
    expect(screen.getByText(/1 group need/i)).toBeInTheDocument();
  });

  it("renders the movie title", () => {
    render(
      <DuplicateResolutionModal
        duplicateGroups={[makeGroup()]}
        duplicateSelections={{}}
        onSelectFile={() => {}} onResolveGroup={() => {}}
        onResolveAll={() => {}} onSkipAll={() => {}}
      />
    );
    expect(screen.getByText("Duplicate Movie")).toBeInTheDocument();
  });

  it("renders file paths for each duplicate", () => {
    render(
      <DuplicateResolutionModal
        duplicateGroups={[makeGroup()]}
        duplicateSelections={{}}
        onSelectFile={() => {}} onResolveGroup={() => {}}
        onResolveAll={() => {}} onSkipAll={() => {}}
      />
    );
    expect(screen.getByText("/lib/a.mp4")).toBeInTheDocument();
    expect(screen.getByText("/lib/b.mp4")).toBeInTheDocument();
  });

  it("renders Skip all button", () => {
    render(
      <DuplicateResolutionModal
        duplicateGroups={[makeGroup()]}
        duplicateSelections={{}}
        onSelectFile={() => {}} onResolveGroup={() => {}}
        onResolveAll={() => {}} onSkipAll={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /skip all/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// MovieTile
// ---------------------------------------------------------------------------
describe("MovieTile", () => {
  it("renders the movie title", () => {
    render(
      <MovieTile
        movie={makeMovie({ title: "Great Film" })}
        isActive={false}
        isSelected={false}
        onClick={() => {}}
        onContextMenu={() => {}}
      />
    );
    expect(screen.getByText("Great Film")).toBeInTheDocument();
  });

  it("shows resolution in the tile", () => {
    render(
      <MovieTile
        movie={makeMovie({ resolution: "4K" })}
        isActive={false}
        isSelected={false}
        onClick={() => {}}
        onContextMenu={() => {}}
      />
    );
    expect(screen.getByText(/4K/)).toBeInTheDocument();
  });

  it("applies selected styling class", () => {
    const { container } = render(
      <MovieTile
        movie={makeMovie()}
        isActive={false}
        isSelected={true}
        onClick={() => {}}
        onContextMenu={() => {}}
      />
    );
    expect((container.firstChild as HTMLElement).className).toContain("selected");
  });

  it("does not apply selected class when not selected", () => {
    const { container } = render(
      <MovieTile
        movie={makeMovie()}
        isActive={false}
        isSelected={false}
        onClick={() => {}}
        onContextMenu={() => {}}
      />
    );
    expect((container.firstChild as HTMLElement).className).not.toContain("selected");
  });

  it("applies active class when isActive is true", () => {
    const { container } = render(
      <MovieTile
        movie={makeMovie()}
        isActive={true}
        onClick={() => {}}
        onContextMenu={() => {}}
      />
    );
    expect((container.firstChild as HTMLElement).className).toContain("active");
  });

  // The quick-play button sits dead centre on the poster, so a right-click
  // aimed at the tile lands on it. It must not swallow the context-menu event,
  // or the tile's menu becomes unreachable from the middle of the poster.
  it("bubbles a right-click on the play button up to the tile's menu", () => {
    const onContextMenu = vi.fn();
    render(
      <MovieTile
        movie={makeMovie({ title: "Great Film" })}
        isActive={false}
        isSelected={false}
        onClick={() => {}}
        onContextMenu={onContextMenu}
        onPlay={() => {}}
      />
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Play Great Film" }));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });
})

// ---------------------------------------------------------------------------
// AppSidebar — library snapshot
// ---------------------------------------------------------------------------
describe("AppSidebar library snapshot", () => {
  it("shows the full library totals, not the loaded page's length", () => {
    render(
      <AppSidebar
        collapsed={false}
        onToggleCollapse={() => {}}
        width={260}
        onResizeStart={() => {}}
        pages={[{ id: "home", label: "Home" }]}
        activePage="home"
        onNavigate={() => {}}
        movies={[makeMovie(), makeMovie({ id: "second-id" })]}
        totalMovies={480}
        normalCount={450}
        gentleCount={30}
        statusMessage="Ready"
      />
    );

    // The snapshot reports DB totals even though only 2 movies are loaded.
    expect(screen.getByText("480 titles")).toBeInTheDocument();
    expect(screen.getByText("480")).toBeInTheDocument(); // Visible titles
    expect(screen.getByText("450")).toBeInTheDocument(); // Normal mode
    expect(screen.getByText("30")).toBeInTheDocument(); // Gentle mode
    expect(screen.queryByText("2 titles")).toBeNull();
  });
})

// ---------------------------------------------------------------------------
// PlayerPopup — header seek buttons
// ---------------------------------------------------------------------------
describe("PlayerPopup header seek buttons", () => {
  it("seeks ±10s from the title bar and leaves close untouched", () => {
    const onSeek = vi.fn();
    const onClose = vi.fn();
    render(
      <PlayerPopup title="Test Movie" onClose={onClose} onSeek={onSeek}>
        <div data-testid="player-child" />
      </PlayerPopup>
    );

    fireEvent.click(screen.getByRole("button", { name: "Seek backward 10 seconds" }));
    expect(onSeek).toHaveBeenLastCalledWith(-10);

    fireEvent.click(screen.getByRole("button", { name: "Seek forward 10 seconds" }));
    expect(onSeek).toHaveBeenLastCalledWith(10);
    expect(onSeek).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });
})

// ---------------------------------------------------------------------------
// PlayerPopup — drag to resize
// ---------------------------------------------------------------------------
describe("PlayerPopup resize handles", () => {
  it("drags bigger and smaller from the corner, clamped to a minimum", () => {
    const { container } = render(
      <PlayerPopup title="Resize me" onClose={() => {}} onSeek={() => {}}>
        <div />
      </PlayerPopup>
    );
    const frame = container.querySelector(".player-popup") as HTMLElement;
    const handle = container.querySelector(".player-popup-resize-se") as HTMLElement;
    expect(frame).not.toBeNull();
    expect(handle).not.toBeNull();

    const rectSpy = vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
      left: 50,
      top: 40,
      width: 760,
      height: 500,
      right: 810,
      bottom: 540,
      x: 50,
      y: 40,
      toJSON: () => ({})
    } as DOMRect);

    fireEvent.pointerDown(handle, { clientX: 500, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 600, clientY: 350, pointerId: 1 });
    expect(frame.style.width).toBe("860px");
    expect(frame.style.height).toBe("550px");
    expect(frame.style.left).toBe("50px");
    expect(frame.style.top).toBe("40px");

    // Dragging past the floor stops at the popup's minimum size.
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(frame.style.width).toBe("720px");
    expect(frame.style.height).toBe("460px");

    fireEvent.pointerUp(handle, { pointerId: 1 });
    rectSpy.mockRestore();
  });
})

// ---------------------------------------------------------------------------
// ScanOptionsDialog — in-place (no-move) scan option
// ---------------------------------------------------------------------------
describe("ScanOptionsDialog move/rename toggle", () => {
  it("defaults to on and switches the scan to import-in-place when unchecked", () => {
    const onChangeScanOption = vi.fn();
    render(
      <ScanOptionsDialog
        pendingScanMode="normal"
        organizationDraft={{ ...DEFAULT_ORGANIZATION_SETTINGS }}
        scanOptionsDraft={defaultScanOptions}
        scanSourceMode="folder"
        onChangeScanOption={onChangeScanOption}
        onChangeScanSource={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const checkbox = screen.getByRole("checkbox", {
      name: /move and rename files into library folders/i
    }) as HTMLInputElement;
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(onChangeScanOption).toHaveBeenCalledWith("moveRename", false);
  });
})
