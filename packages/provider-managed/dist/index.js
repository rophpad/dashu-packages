import { DashuError } from '@rophpad/dashu-core';
import { openAiCompatibleProvider } from '@rophpad/dashu-provider-openai-compatible';

// src/index.ts
function managedProvider(options) {
  const cloudUrl = options.cloudUrl.trim().replace(/\/+$/, "");
  const credential = options.credential.trim();
  if (!cloudUrl || !credential) {
    throw new DashuError(
      "AI_NOT_CONFIGURED",
      "Managed AI is unavailable until this installation is connected to Dashu Cloud."
    );
  }
  return openAiCompatibleProvider({
    name: "Dashu Managed AI",
    mode: "managed",
    baseUrl: `${cloudUrl}/api/ai/v1`,
    model: options.model ?? "dashu-sql",
    apiKey: credential,
    timeoutMs: options.timeoutMs
  });
}

export { managedProvider };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map