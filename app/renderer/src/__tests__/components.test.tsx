import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PosterVisual } from "../components/PosterVisual";
import { SamplePosterCard } from "../components/SamplePosterCard";
import { ScanToast } from "../components/ScanToast";
import { AppTopBar } from "../components/AppTopBar";
import { PinPromptDialog } from "../components/PinPromptDialog";
import { ContextMenu } from "../components/ContextMenu";
import { DuplicateResolutionModal } from "../components/DuplicateResolutionModal";
import { MovieTile } from "../components/MovieTile";
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
})
