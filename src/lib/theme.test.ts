import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadTheme, saveTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
});

describe("loadTheme / saveTheme", () => {
  it("defaults to dark when nothing is stored", () => {
    expect(loadTheme()).toBe("dark");
  });

  it("round-trips a saved theme", () => {
    saveTheme("light");
    expect(loadTheme()).toBe("light");
  });

  it("falls back to dark for any stored value other than 'light'", () => {
    localStorage.setItem("wikilink-graph.theme", "garbage");
    expect(loadTheme()).toBe("dark");
  });

  it("toggling round-trips both ways", () => {
    saveTheme("light");
    expect(loadTheme()).toBe("light");
    saveTheme("dark");
    expect(loadTheme()).toBe("dark");
  });

  it("loadTheme falls back to dark when localStorage.getItem throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    expect(loadTheme()).toBe("dark");
    spy.mockRestore();
  });

  it("saveTheme silently swallows a setItem failure", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveTheme("light")).not.toThrow();
    spy.mockRestore();
  });
});
