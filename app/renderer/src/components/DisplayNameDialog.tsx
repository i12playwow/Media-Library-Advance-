import { useEffect, useRef, useState } from "react";
import type { MovieRecord } from "../../../shared/contracts";

interface DisplayNameDialogProps {
  movie: MovieRecord;
  onClose: () => void;
  onSave: (displayName: string) => void;
}

export function DisplayNameDialog({ movie, onClose, onSave }: DisplayNameDialogProps) {
  const [draft, setDraft] = useState(movie.displayName ?? movie.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      className="ctx-backdrop"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div
        className="panel display-name-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Edit display name"
      >
        <p className="eyebrow">Library display</p>
        <h3>Edit display name</h3>
        <p className="subtle">
          The name shown on this video's tile in the library. The file on disk keeps
          its real name — leave blank to fall back to the library title.
        </p>
        <label className="form-field">
          <span>Display name</span>
          <input
            className="search-input"
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSave(draft);
            }}
            placeholder={movie.title}
            ref={inputRef}
            type="text"
            value={draft}
          />
        </label>
        <p className="subtle">Original library title: <code>{movie.title}</code></p>
        <div className="inline-actions">
          <button className="primary-button" onClick={() => onSave(draft)} type="button">
            Save
          </button>
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
