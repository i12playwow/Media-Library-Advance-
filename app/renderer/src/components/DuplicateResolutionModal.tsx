import type { DuplicateGroup } from "../../../shared/contracts";

interface DuplicateResolutionModalProps {
  duplicateGroups: DuplicateGroup[];
  duplicateSelections: Record<string, string>;
  onSelectFile: (groupKey: string, filePath: string) => void;
  onResolveGroup: (groupKey: string) => void | Promise<void>;
  onResolveAll: () => void | Promise<void>;
  onSkipAll: () => void;
}

export function DuplicateResolutionModal({
  duplicateGroups,
  duplicateSelections,
  onSelectFile,
  onResolveGroup,
  onResolveAll,
  onSkipAll,
}: DuplicateResolutionModalProps) {
  return (
    <div className="dup-modal-overlay">
      <div className="dup-modal">
        <div className="dup-modal-header">
          <div>
            <p className="eyebrow">Duplicates found</p>
            <h3>
              {duplicateGroups.length} group{duplicateGroups.length !== 1 ? "s" : ""} need your decision
            </h3>
          </div>
          <button className="ghost-button" onClick={onSkipAll} type="button">
            ✕ Skip all
          </button>
        </div>

        <div className="dup-modal-body">
          {duplicateGroups.map((group) => (
            <div className="dup-group" key={group.key}>
              <div className="dup-group-title">
                {group.videoId && <span className="mode-pill">{group.videoId}</span>}
                <strong>{group.title}</strong>
              </div>
              <div className="dup-files">
                {group.files
                  .filter((f, i, arr) => arr.findIndex((x) => x.path === f.path) === i)
                  .map((file) => {
                    const selected =
                      (duplicateSelections[group.key] ?? group.files[0].path) === file.path;
                    return (
                      <button
                        key={file.path}
                        className={`dup-file${selected ? " selected" : ""}`}
                        onClick={() => onSelectFile(group.key, file.path)}
                        type="button"
                      >
                        <div className="dup-file-check">{selected ? "●" : "○"}</div>
                        <div className="dup-file-info">
                          <span className="dup-file-name">
                            {file.path.split(/[\\/]/).pop()}
                          </span>
                          <span className="dup-file-meta">
                            {file.resolution} · {(file.fileSize / 1024 / 1024).toFixed(0)} MB
                            {file.autoSelected && (
                              <span className="dup-badge">auto-picked</span>
                            )}
                          </span>
                          <span className="dup-file-path">{file.path}</span>
                        </div>
                      </button>
                    );
                  })}
              </div>
              <button
                className="dup-resolve-btn"
                onClick={() => onResolveGroup(group.key)}
                type="button"
              >
                ✓ Keep selected · delete {group.files.length - 1} other
                {group.files.length - 1 !== 1 ? "s" : ""}
              </button>
            </div>
          ))}
        </div>

        {duplicateGroups.length > 1 && (
          <div className="dup-modal-footer">
            <button className="primary-button" onClick={onResolveAll} type="button">
              ✓ Resolve all {duplicateGroups.length} groups
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
