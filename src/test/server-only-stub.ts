// In the Node/vitest environment the real `server-only` package throws on
// import (it only resolves to an empty module under the RSC bundler condition).
// vitest.config.ts aliases `server-only` to this no-op so modules guarded by it
// can be unit-tested directly.
export {};
