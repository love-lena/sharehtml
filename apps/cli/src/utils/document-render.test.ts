import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderMarkdownToHtml } from "./document-render.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "sharehtml-render-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("Markdown image inlining", () => {
  test("embeds supported images inside the document directory", () => {
    const root = temporaryDirectory();
    const documentDirectory = join(root, "document");
    mkdirSync(documentDirectory);
    const markdownPath = join(documentDirectory, "report.md");
    const imageBytes = "inside-image";
    writeFileSync(join(documentDirectory, "chart.png"), imageBytes);

    const rendered = renderMarkdownToHtml("![chart](./chart.png)", "Report", markdownPath);
    expect(rendered).toContain(Buffer.from(imageBytes).toString("base64"));
  });

  test("does not read relative paths outside the document directory", () => {
    const root = temporaryDirectory();
    const documentDirectory = join(root, "document");
    mkdirSync(documentDirectory);
    const markdownPath = join(documentDirectory, "report.md");
    const outsideBytes = "outside-secret";
    writeFileSync(join(root, "secret.png"), outsideBytes);

    const rendered = renderMarkdownToHtml("![secret](../secret.png)", "Report", markdownPath);
    expect(rendered).not.toContain(Buffer.from(outsideBytes).toString("base64"));
    expect(rendered).toContain("../secret.png");
  });

  test("does not follow an in-directory symlink outside the document directory", () => {
    const root = temporaryDirectory();
    const documentDirectory = join(root, "document");
    mkdirSync(documentDirectory);
    const markdownPath = join(documentDirectory, "report.md");
    const outsidePath = join(root, "secret.png");
    const outsideBytes = "symlink-secret";
    writeFileSync(outsidePath, outsideBytes);
    symlinkSync(outsidePath, join(documentDirectory, "linked.png"));

    const rendered = renderMarkdownToHtml("![secret](./linked.png)", "Report", markdownPath);
    expect(rendered).not.toContain(Buffer.from(outsideBytes).toString("base64"));
  });
});
