# @rophpad/dashu-react

React 18+ client bindings for Dashu: `useDashu`, a question composer, a result renderer, built-in SVG charts, component overrides, theme tokens, data helpers, and CSV formatting.

## Install

```bash
npm install @rophpad/dashu-react
```

## Usage

```tsx
"use client";

import { DashuComposer, DashuResult, useDashu } from "@rophpad/dashu-react";

export function Analytics() {
  const { ask, cancel, result, error, loading } = useDashu();

  return (
    <>
      <DashuComposer onSubmit={ask} onCancel={cancel} loading={loading} />
      {error && <p role="alert">{error.message}</p>}
      {result && <DashuResult result={result} />}
    </>
  );
}
```

The default endpoint is `POST /api/dashu/ask`. The hook stores no credentials and expects your backend route to authenticate and authorize every request.

Override individual renderers with `DashuResult`'s `components` prop, or render the exported result contract yourself. Built-in styles use `--dashu-*` CSS variables.

## Documentation

- [React hook, props, themes, custom renderers, and CSV](https://github.com/rophpad/dashu/blob/main/docs/guides/react-and-custom-ui.md)
- [React API reference](https://github.com/rophpad/dashu/blob/main/docs/reference/packages.md#rophpaddashu-react)
- [Result contract](https://github.com/rophpad/dashu/blob/main/docs/reference/result-contract.md)

## License

Apache-2.0
