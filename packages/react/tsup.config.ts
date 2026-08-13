import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Rollup's treeshake pass drops module-level directives and warns that it did
  // — which would silently strip the client boundary below and break every
  // App Router consumer. Bundle size is not worth that.
  treeshake: false,
  target: "es2022",
  external: ["react", "react-dom"],
  // esbuild strips directives from bundle output, so the boundary has to be
  // re-attached. Everything exported here renders, so the whole entry is a
  // client module.
  banner: { js: '"use client";' },
});
