import { Hono } from "hono";
import type { AppBindings, DocumentRow } from "../types.js";
import { PublicViewer } from "../frontend/public-viewer.js";
import { createAttachmentHeaders } from "../utils/download.js";
import { getRenderedObject } from "../utils/document-storage.js";
import { injectArtifactContentSecurityPolicy } from "../utils/artifact-security.js";
import { getRegistry } from "../utils/registry.js";

const PUBLIC_SHELL_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "connect-src 'self'",
  "frame-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const publicHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": PUBLIC_SHELL_CSP,
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

async function loadPublicDocument(
  env: AppBindings["Bindings"],
  id: string,
): Promise<DocumentRow | null> {
  const doc = await getRegistry(env).getDocument(id);
  return doc?.is_shared === 1 ? doc : null;
}

export const publicViewer = new Hono<AppBindings>();

publicViewer.get("/p/:id", async (c) => {
  const id = c.req.param("id");
  const doc = await loadPublicDocument(c.env, id);
  if (!doc) return c.text("Not found", 404, publicHeaders);

  return c.html(
    PublicViewer({
      title: doc.title,
      contentPath: `/p/${encodeURIComponent(id)}/content`,
      managePath: `/api/documents/${encodeURIComponent(id)}/share`,
      privatePath: `/d/${encodeURIComponent(id)}`,
    }),
    200,
    publicHeaders,
  );
});

publicViewer.get("/p/:id/content", async (c) => {
  const id = c.req.param("id");
  const doc = await loadPublicDocument(c.env, id);
  if (!doc) return c.text("Not found", 404, publicHeaders);

  const object = await getRenderedObject(c.env.DOCUMENTS_BUCKET, id, doc);
  if (!object) return c.text("Content not found", 404, publicHeaders);

  const renderedFilename = doc.rendered_filename || doc.filename;
  const securedHtml = injectArtifactContentSecurityPolicy(await object.text());
  return new Response(securedHtml, {
    headers: createAttachmentHeaders(renderedFilename, {
      "X-ShareHTML-Download-Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
    }),
  });
});
