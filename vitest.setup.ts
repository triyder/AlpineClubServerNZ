// Deterministic environment for unit tests. These are set before any module
// under test reads process.env at import time.
const env = process.env as Record<string, string | undefined>;
env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
env.NODE_ENV ??= "test";
