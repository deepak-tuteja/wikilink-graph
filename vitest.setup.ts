import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement Element.scrollTo — PageView calls it on open to reset reader scroll
// position. Stub it out so any test that opens the reader doesn't crash on this environment gap.
// This setup file also runs for plain-Node test files (parser tests, `@vitest-environment node`),
// where `Element` doesn't exist at all — guard accordingly.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
