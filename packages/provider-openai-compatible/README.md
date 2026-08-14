# @rophpad/dashu-provider-openai-compatible

Dashu provider for OpenAI-compatible chat-completions endpoints such as Ollama, vLLM, LocalAI, llama.cpp, and internal gateways.

## Install

```bash
npm install @rophpad/dashu-core @rophpad/dashu-provider-openai-compatible
```

Requires a Node.js 20+ backend.

## Usage

```ts
import { openAiCompatibleProvider } from "@rophpad/dashu-provider-openai-compatible";

const ai = openAiCompatibleProvider({
  name: "Internal Ollama",
  mode: "local",
  baseUrl: "http://localhost:11434/v1",
  model: "qwen2.5-coder:7b",
  timeoutMs: 60_000,
});
```

`baseUrl` must include the endpoint's version segment where required. The package calls `${baseUrl}/chat/completions`. Optional `apiKey` and `headers` support authenticated gateways.

## Documentation

- [Local/provider configuration recipes](https://github.com/rophpad/dashu/blob/main/docs/guides/providers.md)
- [Complete options and retry behavior](https://github.com/rophpad/dashu/blob/main/docs/reference/packages.md#rophpaddashu-provider-openai-compatible)
- [Provider data boundary](https://github.com/rophpad/dashu/blob/main/docs/security/security-model.md#exactly-what-the-ai-provider-receives)

## License

Apache-2.0
