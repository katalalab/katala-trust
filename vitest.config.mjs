import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		include: ["packages/katala/**/*.test.ts"],
		exclude: ["node_modules/**", "packages/katala/mediation-client/**"],
	},
});
