import { describe, expect, it } from "vitest";
import type { Anchor } from "@sharehtml/shared";
import { remapElementAnchor } from "../src/utils/document-elements.js";

describe("element anchor migration", () => {
  it("retains signature-based matching when an element moves", () => {
    const anchor: Anchor = {
      selectors: [{
        type: "ElementSelector",
        cssSelector: "body > section:nth-child(1) > img:nth-child(1)",
        tagName: "img",
        ordinal: 1,
        src: "data:image/png;base64,chart",
        alt: "Revenue chart",
      }],
    };

    const migrated = remapElementAnchor(anchor, [{
      cssSelector: "body > article:nth-child(2) > img:nth-child(1)",
      tagName: "img",
      ordinal: 1,
      src: "data:image/png;base64,chart",
      alt: "Revenue chart",
    }]);

    expect(migrated).not.toBe("resolve");
    expect(migrated).not.toBeNull();
    if (!migrated || migrated === "resolve") return;
    expect(migrated.selectors[0]).toMatchObject({
      type: "ElementSelector",
      cssSelector: "body > article:nth-child(2) > img:nth-child(1)",
    });
  });
});
