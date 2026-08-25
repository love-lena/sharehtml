/** @jsxImportSource hono/jsx */
import { raw } from "hono/utils/html";
import { safeJsonForScript, toHtml } from "./jsx.js";

interface PublicViewerParams {
  title: string;
  contentPath: string;
}

export function PublicViewer({ title, contentPath }: PublicViewerParams) {
  const jsx = (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} — sharehtml</title>
        <style>{raw(`
          :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          * { box-sizing: border-box; }
          html, body { width: 100%; height: 100%; margin: 0; background: #0f1117; color: #f5f7ff; }
          body { display: grid; grid-template-rows: 44px 1fr; }
          header { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 0 16px; border-bottom: 1px solid #262a35; background: #171a22; }
          .brand { flex: 0 0 auto; font-size: 13px; font-weight: 750; letter-spacing: .02em; }
          .title { min-width: 0; overflow: hidden; color: #d9dcea; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
          .badge { flex: 0 0 auto; margin-left: auto; color: #aeb4c7; font-size: 11px; }
          iframe { width: 100%; height: 100%; border: 0; background: white; }
          #error { display: none; place-items: center; padding: 24px; color: #c7cada; text-align: center; }
        `)}</style>
      </head>
      <body>
        <header>
          <span class="brand">sharehtml</span>
          <span class="title">{title}</span>
          <span class="badge">public · read only</span>
        </header>
        <iframe id="document" sandbox="allow-scripts" allow="fullscreen" allowFullScreen title={title}></iframe>
        <main id="error">This public link is no longer available.</main>
        <script>{raw(`
          const config = ${safeJsonForScript({ contentPath })};
          const frame = document.getElementById("document");
          const error = document.getElementById("error");
          fetch(config.contentPath, { credentials: "omit", cache: "no-store" })
            .then((response) => {
              if (!response.ok) throw new Error("unavailable");
              return response.text();
            })
            .then((html) => { frame.srcdoc = html; })
            .catch(() => {
              frame.remove();
              error.style.display = "grid";
            });
        `)}</script>
      </body>
    </html>
  );
  return toHtml(jsx);
}
