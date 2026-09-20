import { describe, it, expect } from "vitest";
import { gatedModels, isExpired, FREE_MODELS } from "@/server/plans";

describe("gatedModels", () => {
  it("kredit > 0 -> pakai model paket penuh", () => {
    const allowed = ["copilot:*", "ollama:*", "zaltr-core"];
    expect(gatedModels(allowed, 10)).toEqual(allowed);
  });

  it("kredit 0 (habis/hangus) -> hanya FREE_MODELS", () => {
    expect(gatedModels(["copilot:*", "*"], 0)).toEqual(FREE_MODELS);
  });

  it("FREE_MODELS = trio gratis (core + qwen + gemma)", () => {
    expect(FREE_MODELS).toContain("zaltr-core");
    expect(FREE_MODELS).toContain("ollama:qwen2.5:7b-instruct");
    expect(FREE_MODELS).toContain("ollama:gemma4:latest");
  });
});

describe("isExpired", () => {
  it("null -> false", () => {
    expect(isExpired(null)).toBe(false);
  });
  it("tanggal masa depan -> false", () => {
    expect(isExpired(new Date(Date.now() + 86_400_000))).toBe(false);
  });
  it("tanggal lampau -> true", () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
  });
});
