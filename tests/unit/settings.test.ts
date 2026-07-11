import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeAppSettings } from "../../src/domain/models";

describe("application settings defaults", () => {
  it("defaults new browser and desktop databases to dark mode", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("dark");
    expect(normalizeAppSettings({} as unknown).theme).toBe("dark");
  });

  it("preserves an existing explicit system-theme preference", () => {
    expect(normalizeAppSettings({ ...DEFAULT_SETTINGS, theme: "system" }).theme).toBe("system");
  });
});
