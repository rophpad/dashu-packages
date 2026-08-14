# @rophpad/dashu-provider-openrouter

Dashu AI provider using the product operator's OpenRouter API key.

## Install

```bash
npm install @rophpad/dashu-core @rophpad/dashu-provider-openrouter
```

Requires a Node.js 20+ backend. Keep the API key out of browser bundles.

## Usage

```ts
import { openRouterProvider } from "@rophpad/dashu-provider-openrouter";

const ai = openRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: "openai/gpt-4.1-mini",
  referer: "https://example.com",
  title: "Example analytics",
  timeoutMs: 60_000,
});
```

Requests go directly from your backend to OpenRouter. You own model choice, billing, quotas, retention review, and availability.

## Documentation

- [Provider selection and privacy](https://github.com/rophpad/dashu/blob/main/docs/guides/providers.md)
- [OpenRouter API reference](https://github.com/rophpad/dashu/blob/main/docs/reference/packages.md#rophpaddashu-provider-openrouter)
- [Data sent to providers](https://github.com/rophpad/dashu/blob/main/docs/security/security-model.md#exactly-what-the-ai-provider-receives)

## License

Apache-2.0
