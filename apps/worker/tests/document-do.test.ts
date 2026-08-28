import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { AnchorMigrationSummary } from "../src/types.js";

type MigrationTestInstance = {
  sql: SqlStorage;
  migrateAnchors(newHtml: string, oldText: string, newText: string): Promise<AnchorMigrationSummary>;
  broadcast(message: unknown): void;
};

function textAnchor(text: string, exact: string) {
  const start = text.indexOf(exact);
  return JSON.stringify({
    selectors: [
      { type: "TextPositionSelector", start, end: start + exact.length },
      { type: "TextQuoteSelector", exact, prefix: "", suffix: "" },
    ],
  });
}

describe("DocumentDO anchor migration", () => {
  it("resolves only ambiguous annotations when the diff becomes coarse", async () => {
    const id = env.DOCUMENT_DO.idFromName(`coarse-migration-${crypto.randomUUID()}`);
    const stub = env.DOCUMENT_DO.get(id);
    const oldText = `prefix|${"a".repeat(20_000)}|suffix`;
    const newText = `prefix|${"b".repeat(41_000)}|suffix`;
    const result = await runInDurableObject(stub, async (instance) => {
      const testInstance = instance as unknown as MigrationTestInstance;
      for (const [commentId, exact] of [["middle", "a".repeat(24)], ["suffix", "suffix"]]) {
        testInstance.sql.exec(
          `INSERT INTO comments
            (id, author_email, author_name, author_color, content, anchor, parent_id, resolved)
           VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`,
          commentId,
          "person@example.com",
          "Person",
          "#123456",
          commentId,
          textAnchor(oldText, exact),
        );
      }
      testInstance.sql.exec(
        `INSERT INTO reactions (id, author_email, author_name, emoji, anchor)
         VALUES (?, ?, ?, ?, ?)`,
        "middle-reaction",
        "person@example.com",
        "Person",
        "👍",
        textAnchor(oldText, "a".repeat(24)),
      );

      const summary = await testInstance.migrateAnchors("<main>updated</main>", oldText, newText);
      const comments = testInstance.sql
        .exec<{ id: string; anchor: string; resolved: number }>(
          "SELECT id, anchor, resolved FROM comments ORDER BY id",
        )
        .toArray();
      const reactionCount = testInstance.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM reactions")
        .one();
      return { summary, comments, reactionCount };
    });

    expect(result.summary).toMatchObject({
      strategy: "coarse",
      updatedComments: 1,
      resolvedComments: 1,
      deletedReactions: 1,
    });
    expect(result.comments.find((comment) => comment.id === "middle")?.resolved).toBe(1);
    const suffixComment = result.comments.find((comment) => comment.id === "suffix");
    expect(suffixComment?.resolved).toBe(0);
    expect(suffixComment?.anchor).toContain(`"start":${newText.indexOf("suffix")}`);
    expect(result.reactionCount.count).toBe(0);
  });

  it("does not write or broadcast when migration computation fails", async () => {
    const id = env.DOCUMENT_DO.idFromName(`migration-failure-${crypto.randomUUID()}`);
    const stub = env.DOCUMENT_DO.get(id);
    const result = await runInDurableObject(stub, async (instance) => {
      const testInstance = instance as unknown as MigrationTestInstance;
      const validAnchor = JSON.stringify({
        selectors: [
          { type: "TextPositionSelector", start: 0, end: 10 },
          { type: "TextQuoteSelector", exact: "old anchor", prefix: "", suffix: "" },
        ],
      });
      testInstance.sql.exec(
        `INSERT INTO comments
          (id, author_email, author_name, author_color, content, anchor, parent_id, resolved)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`,
        "valid-comment",
        "person@example.com",
        "Person",
        "#123456",
        "Valid",
        validAnchor,
      );
      testInstance.sql.exec(
        `INSERT INTO comments
          (id, author_email, author_name, author_color, content, anchor, parent_id, resolved)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`,
        "invalid-comment",
        "person@example.com",
        "Person",
        "#123456",
        "Invalid",
        "{",
      );

      const broadcasts: unknown[] = [];
      testInstance.broadcast = (message) => broadcasts.push(message);
      let failed = false;
      try {
        await testInstance.migrateAnchors("<main>replacement</main>", "old anchor", "replacement");
      } catch {
        failed = true;
      }

      const rows = testInstance.sql
        .exec<{ id: string; resolved: number }>("SELECT id, resolved FROM comments ORDER BY id")
        .toArray();
      return { failed, rows, broadcasts };
    });

    expect(result.failed).toBe(true);
    expect(result.rows).toEqual([
      { id: "invalid-comment", resolved: 0 },
      { id: "valid-comment", resolved: 0 },
    ]);
    expect(result.broadcasts).toEqual([]);
  });
});
