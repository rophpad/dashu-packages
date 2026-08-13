import { useState, type FormEvent } from "react";
import { token } from "./theme";

export type DashuComposerProps = {
  onSubmit: (question: string) => void;
  onCancel?: () => void;
  loading?: boolean;
  placeholder?: string;
  /** Shown as clickable prompts when the composer is empty. */
  suggestions?: string[];
  autoFocus?: boolean;
  className?: string;
};

/**
 * A question input.
 *
 * Deliberately small: it submits a string and reports nothing else. Products
 * with a design system are expected to replace it — `useDashu` is the part
 * worth keeping.
 */
export function DashuComposer({
  onSubmit,
  onCancel,
  loading = false,
  placeholder = "Ask a question about your data…",
  suggestions = [],
  autoFocus,
  className,
}: DashuComposerProps) {
  const [value, setValue] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const question = value.trim();
    if (!question || loading) return;
    onSubmit(question);
    setValue("");
  }

  return (
    <div className={className} style={{ fontFamily: token.font }}>
      <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          aria-label="Question"
          autoFocus={autoFocus}
          disabled={loading}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "10px 12px",
            fontSize: 14,
            font: "inherit",
            fontFamily: token.font,
            color: token.fg,
            background: "transparent",
            border: `1px solid ${token.border}`,
            borderRadius: token.radius,
          }}
        />

        {loading && onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              color: token.muted,
              background: "transparent",
              border: `1px solid ${token.border}`,
              borderRadius: token.radius,
            }}
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={loading || !value.trim()}
            style={{
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: loading || !value.trim() ? "default" : "pointer",
              opacity: loading || !value.trim() ? 0.5 : 1,
              color: "#fff",
              background: token.accent,
              border: "none",
              borderRadius: token.radius,
            }}
          >
            {loading ? "Asking…" : "Ask"}
          </button>
        )}
      </form>

      {!value && suggestions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSubmit(suggestion)}
              disabled={loading}
              style={{
                padding: "5px 10px",
                fontSize: 12,
                cursor: "pointer",
                color: token.muted,
                background: token.surface,
                border: `1px solid ${token.border}`,
                borderRadius: 999,
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
