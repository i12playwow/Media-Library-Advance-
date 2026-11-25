import { useEffect, useRef } from "react";
import type React from "react";

interface PinPromptDialogProps {
  pinInput: string;
  onPinChange: (value: string) => void;
  onUnlock: () => void;
  onClose: () => void;
}

export function PinPromptDialog({ pinInput, onPinChange, onUnlock, onClose }: PinPromptDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the PIN field on open so the shortcut flow (Ctrl+Shift+P) is
  // type-the-code immediately; Escape cancels like the other dialogs.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key === "Enter" && pinInput.length === 4) {
      onUnlock();
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        aria-label="Enter Gentle mode PIN"
        aria-modal="true"
        className="modal-card"
        role="dialog"
      >
        <input
          className="search-input"
          inputMode="numeric"
          maxLength={4}
          onChange={(event) => onPinChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter PIN"
          ref={inputRef}
          type="password"
          value={pinInput}
        />
        <div className="inline-actions">
          <button
            className="primary-button"
            onClick={onUnlock}
            type="button"
            disabled={pinInput.length !== 4}
          >
            Unlock
          </button>
          <button
            className="ghost-button"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
