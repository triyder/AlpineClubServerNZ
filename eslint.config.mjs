// Flat ESLint config using eslint-config-next's native flat exports (Next 16).
// The default export bundles the Next core rules + the TypeScript rules; we add
// the core-web-vitals set on top, then project ignores.
import next from "eslint-config-next";
import coreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...next,
  ...coreWebVitals,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
