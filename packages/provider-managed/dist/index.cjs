'use strict';

var dashuCore = require('@rophpad/dashu-core');
var dashuProviderOpenaiCompatible = require('@rophpad/dashu-provider-openai-compatible');

// src/index.ts
function managedProvider(options) {
  const cloudUrl = options.cloudUrl.trim().replace(/\/+$/, "");
  const credential = options.credential.trim();
  if (!cloudUrl || !credential) {
    throw new dashuCore.DashuError(
      "AI_NOT_CONFIGURED",
      "Managed AI is unavailable until this installation is connected to Dashu Cloud."
    );
  }
  return dashuProviderOpenaiCompatible.openAiCompatibleProvider({
    name: "Dashu Managed AI",
    mode: "managed",
    baseUrl: `${cloudUrl}/api/ai/v1`,
    model: options.model ?? "dashu-sql",
    apiKey: credential,
    timeoutMs: options.timeoutMs
  });
}

exports.managedProvider = managedProvider;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map