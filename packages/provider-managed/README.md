# @rophpad/dashu-provider-managed

Dashu Managed AI provider. It sends planning requests from your backend to a configured Dashu Cloud deployment using an installation credential.

## Install

```bash
npm install @rophpad/dashu-core @rophpad/dashu-provider-managed
```

Requires a Node.js 20+ backend. The credential is a server secret and must never use a public/browser environment-variable prefix.

## Usage

```ts
import { managedProvider } from "@rophpad/dashu-provider-managed";

const ai = managedProvider({
  cloudUrl: process.env.DASHU_CLOUD_URL!,
  credential: process.env.DASHU_INSTALLATION_CREDENTIAL!,
  model: "dashu-sql",
  timeoutMs: 60_000,
});
```

The default model/capability name is `dashu-sql`. Blank URL or credential fails immediately with `AI_NOT_CONFIGURED`.

## Documentation

- [Provider selection and Managed AI](https://github.com/rophpad/dashu/blob/main/docs/guides/providers.md)
- [Managed provider API reference](https://github.com/rophpad/dashu/blob/main/docs/reference/packages.md#rophpaddashu-provider-managed)
- [Data sent to providers](https://github.com/rophpad/dashu/blob/main/docs/security/security-model.md#exactly-what-the-ai-provider-receives)

## License

Apache-2.0
