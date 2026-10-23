// DOM matchers are only needed by the happy-dom suites. Importing jest-dom
// from every test file costs ~100 ms of module evaluation per file even in a
// Node environment, where none of its matchers can apply.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom");
}
