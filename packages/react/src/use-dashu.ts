import { useCallback, useRef, useState } from "react";
import type { AskResult, AskTurn } from "@rophpad/dashu-core";

/** The error shape every Dashu route returns. */
export type DashuErrorPayload = {
  code: string;
  message: string;
  requestId?: string;
};

export type UseDashuOptions = {
  /** The route you mounted `dashuRoute` on. */
  endpoint?: string;
  /**
   * Follow-up context. Only the question and its SQL travel, and only when the
   * server permitted SQL in the first place — a result without `query` cannot
   * contribute a turn.
   */
  keepHistory?: boolean;
  /** Extra headers, e.g. a CSRF token. Credentials belong on the backend. */
  headers?: Record<string, string>;
  onResult?: (result: AskResult) => void;
  onError?: (error: DashuErrorPayload) => void;
};

export type UseDashu = {
  ask: (question: string) => Promise<AskResult | null>;
  /** Re-run the last question. */
  retry: () => Promise<AskResult | null>;
  /** Abort the request in flight. */
  cancel: () => void;
  reset: () => void;
  result: AskResult | null;
  error: DashuErrorPayload | null;
  loading: boolean;
  question: string;
  history: AskTurn[];
};

const GENERIC_ERROR: DashuErrorPayload = {
  code: "INTERNAL",
  message: "Something went wrong. Please try again.",
};

/**
 * Client state for asking questions.
 *
 * This owns the parts every integration would otherwise rewrite: the fetch, the
 * in-flight flag, cancellation, the last question for retry, and follow-up
 * history. It holds no credentials and makes no decisions about permissions —
 * it calls your route, and your route decides what the actor may do.
 */
export function useDashu(options: UseDashuOptions = {}): UseDashu {
  const {
    endpoint = "/api/dashu/ask",
    keepHistory = true,
    headers,
    onResult,
    onError,
  } = options;

  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<DashuErrorPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<AskTurn[]>([]);

  // Refs rather than state: an in-flight request must be reachable from the
  // next call without waiting for a re-render.
  const controller = useRef<AbortController | null>(null);
  const lastQuestion = useRef("");
  const historyRef = useRef<AskTurn[]>([]);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setLoading(false);
  }, []);

  const send = useCallback(
    async (asked: string): Promise<AskResult | null> => {
      const trimmed = asked.trim();
      if (!trimmed) return null;

      // A second question supersedes the first; leaving both running would
      // race to set the result.
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;

      lastQuestion.current = trimmed;
      setQuestion(trimmed);
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({
            question: trimmed,
            ...(keepHistory && historyRef.current.length
              ? { history: historyRef.current }
              : {}),
          }),
          signal: abort.signal,
        });

        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          const failure =
            payload && typeof payload === "object" && "error" in payload
              ? ((payload as { error: DashuErrorPayload }).error ?? GENERIC_ERROR)
              : GENERIC_ERROR;

          setError(failure);
          onError?.(failure);
          return null;
        }

        const answer = payload as AskResult;
        setResult(answer);

        // Only a result carrying SQL can seed a follow-up. When policy withheld
        // it there is nothing to reference, and inventing one would mislead the
        // model on the next turn.
        if (keepHistory && answer.answered && answer.query?.sql) {
          const next = [...historyRef.current, { question: trimmed, sql: answer.query.sql }].slice(-6);
          historyRef.current = next;
          setHistory(next);
        }

        onResult?.(answer);
        return answer;
      } catch (caught) {
        // An abort is this hook doing its job, not a failure to report.
        if (caught instanceof Error && caught.name === "AbortError") return null;

        setError(GENERIC_ERROR);
        onError?.(GENERIC_ERROR);
        return null;
      } finally {
        if (controller.current === abort) {
          controller.current = null;
          setLoading(false);
        }
      }
    },
    [endpoint, headers, keepHistory, onError, onResult],
  );

  const reset = useCallback(() => {
    cancel();
    setResult(null);
    setError(null);
    setQuestion("");
    setHistory([]);
    historyRef.current = [];
    lastQuestion.current = "";
  }, [cancel]);

  return {
    ask: send,
    retry: useCallback(() => send(lastQuestion.current), [send]),
    cancel,
    reset,
    result,
    error,
    loading,
    question,
    history,
  };
}
