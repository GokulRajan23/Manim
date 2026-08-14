import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves the `@/*` alias from tsconfig.json natively; no plugin needed.
  resolve: { tsconfigPaths: true },
  test: {
    // Everything under test here is server-side: the rules parser, the gate, the
    // silence planner, duration reconciliation, the AST guard. No DOM needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
