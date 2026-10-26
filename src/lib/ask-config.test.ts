import { describe, expect, it } from "vitest";
import { askSettingsPatchSchema, askSettingsSchema, DEFAULT_ASK_SETTINGS, estimateCost, FREE_NEURONS_PER_DAY } from "./ask-config";

describe("askSettingsSchema", () => {
  it("fills defaults for a partial or empty document", () => {
    const s = askSettingsSchema.parse({ model: "@cf/meta/llama-3.1-8b-instruct-fp8-fast" });
    expect(s.sourceLimit).toBe(DEFAULT_ASK_SETTINGS.sourceLimit);
    expect(s.model).toBe("@cf/meta/llama-3.1-8b-instruct-fp8-fast");
  });

  it("rejects out-of-range knobs rather than clamping", () => {
    expect(askSettingsSchema.safeParse({ sourceLimit: 0 }).success).toBe(false);
    expect(askSettingsSchema.safeParse({ temperature: 2.5 }).success).toBe(false);
    expect(askSettingsSchema.safeParse({ provider: "openai" }).success).toBe(false);
  });

  it("patch schema keeps only the keys sent, still range-checked", () => {
    expect(askSettingsPatchSchema.parse({ sourceLimit: 3 })).toEqual({ sourceLimit: 3 });
    expect(askSettingsPatchSchema.safeParse({ sourceLimit: 99 }).success).toBe(false);
  });
});

describe("estimateCost", () => {
  it("is null without a model to price", () => {
    expect(estimateCost({ ...DEFAULT_ASK_SETTINGS, provider: "none" })).toBeNull();
    expect(estimateCost({ ...DEFAULT_ASK_SETTINGS, model: "@cf/unknown" })).toBeNull();
  });

  it("scales with passages and answer length, and derives the free count", () => {
    const base = estimateCost(DEFAULT_ASK_SETTINGS)!;
    const more = estimateCost({ ...DEFAULT_ASK_SETTINGS, sourceLimit: 16 })!;
    const longer = estimateCost({ ...DEFAULT_ASK_SETTINGS, maxTokens: 2048 })!;
    expect(more.inputTokens).toBeGreaterThan(base.inputTokens);
    expect(longer.outputTokens).toBe(2048);
    expect(longer.neurons).toBeGreaterThan(base.neurons);
    expect(base.freeQuestionsPerDay).toBe(Math.floor(FREE_NEURONS_PER_DAY / base.neurons));
  });
});
