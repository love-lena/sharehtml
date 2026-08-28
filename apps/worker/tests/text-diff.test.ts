import { describe, expect, it } from "vitest";
import { diffText, mapRangeThroughDiff } from "../src/utils/text-diff.js";

function reconstructedText(
  operations: ReturnType<typeof diffText>["operations"],
  side: "old" | "new",
): string {
  return operations
    .filter((operation) => operation.type === "equal" ||
      (side === "old" ? operation.type === "delete" : operation.type === "insert"))
    .map((operation) => operation.text)
    .join("");
}

describe("bounded text diff", () => {
  it("maps unchanged ranges through multiple modest edits exactly", () => {
    const oldText = "alpha bravo charlie delta";
    const newText = "alpha BRAVO charlie DELTA";
    const diff = diffText(oldText, newText);
    const start = oldText.indexOf("charlie");

    expect(diff.strategy).toBe("exact");
    expect(reconstructedText(diff.operations, "old")).toBe(oldText);
    expect(reconstructedText(diff.operations, "new")).toBe(newText);
    expect(mapRangeThroughDiff(
      { start, end: start + "charlie".length },
      diff.operations,
    )).toEqual({
      start: newText.indexOf("charlie"),
      end: newText.indexOf("charlie") + "charlie".length,
    });
  });

  it("falls back to a bounded coarse diff for divergent text", () => {
    const oldText = `prefix|${"a".repeat(20_000)}|suffix`;
    const newText = `prefix|${"b".repeat(41_000)}|suffix`;
    const diff = diffText(oldText, newText);
    const suffixStart = oldText.indexOf("suffix");
    const middleStart = oldText.indexOf("aaa");

    expect(diff.strategy).toBe("coarse");
    expect(diff.operations).toHaveLength(4);
    expect(reconstructedText(diff.operations, "old")).toBe(oldText);
    expect(reconstructedText(diff.operations, "new")).toBe(newText);
    expect(mapRangeThroughDiff(
      { start: suffixStart, end: suffixStart + "suffix".length },
      diff.operations,
    )).toEqual({
      start: newText.indexOf("suffix"),
      end: newText.indexOf("suffix") + "suffix".length,
    });
    expect(mapRangeThroughDiff(
      { start: middleStart, end: middleStart + 3 },
      diff.operations,
    )).toBeNull();
  });
});
