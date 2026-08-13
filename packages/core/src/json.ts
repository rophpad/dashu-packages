import { DashuError } from "./errors";

/**
 * Pull a JSON object out of a model reply.
 *
 * The output contract is carried by the prompt rather than a `response_format`
 * parameter, because OpenAI-compatible providers do not consistently support
 * the same structured-output features. So the reply arrives bare, fenced, or
 * wrapped in prose, and all three have to work.
 */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Fall through to the non-compliant shapes below.
  }

  const fenced = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(trimmed);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {
      // Fall through to balanced-object extraction.
    }
  }

  const start = trimmed.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < trimmed.length; index++) {
      const character = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth++;
      else if (character === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, index + 1)) as T;
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new DashuError("AI_UNAVAILABLE", "The model did not return a usable query plan.", {
    detail: `unparseable completion, ${trimmed.length} chars`,
  });
}
