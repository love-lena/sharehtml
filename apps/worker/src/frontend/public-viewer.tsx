/** @jsxImportSource hono/jsx */
import { raw } from "hono/utils/html";
import { safeJsonForScript, toHtml } from "./jsx.js";

interface PublicViewerParams {
  title: string;
  contentPath: string;
  managePath: string;
  privatePath: string;
}

export function PublicViewer({ title, contentPath, managePath, privatePath }: PublicViewerParams) {
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
          button, select, textarea { font: inherit; }
          button { border: 1px solid #363b49; border-radius: 7px; padding: 5px 9px; color: #e9ebf4; background: #242833; cursor: pointer; }
          button:hover { background: #2d3240; }
          button:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #8b9cff; outline-offset: 2px; }
          #manage-button[hidden] { display: none; }
          iframe { width: 100%; height: 100%; border: 0; background: white; }
          #error { display: none; place-items: center; padding: 24px; color: #c7cada; text-align: center; }
          #error a { color: #b9c4ff; }
          dialog { width: min(420px, calc(100% - 32px)); border: 1px solid #363b49; border-radius: 14px; padding: 0; color: #f5f7ff; background: #191c25; box-shadow: 0 24px 80px rgb(0 0 0 / .55); }
          dialog::backdrop { background: rgb(4 6 10 / .72); backdrop-filter: blur(3px); }
          form { display: grid; gap: 16px; padding: 20px; }
          h2 { margin: 0; font-size: 17px; }
          label { display: grid; gap: 7px; color: #c8ccda; font-size: 12px; }
          select, textarea { width: 100%; border: 1px solid #363b49; border-radius: 8px; padding: 9px 10px; color: #f5f7ff; background: #11131a; }
          textarea { min-height: 88px; resize: vertical; }
          .hint, #manage-message { margin: 0; color: #979daf; font-size: 11px; line-height: 1.45; }
          .actions { display: flex; justify-content: flex-end; gap: 8px; }
          .primary { border-color: #7384ea; background: #6577df; }
          .primary:hover { background: #7183ea; }
        `)}</style>
      </head>
      <body>
        <header>
          <span class="brand">sharehtml</span>
          <span class="title">{title}</span>
          <span class="badge" id="status-badge">public · read only</span>
          <button id="manage-button" type="button" hidden>manage sharing</button>
        </header>
        <iframe id="document" sandbox="allow-scripts" allow="fullscreen" allowFullScreen title={title}></iframe>
        <main id="error">This public link is no longer available.</main>
        <dialog id="manage-dialog">
          <form id="manage-form">
            <h2>Manage sharing</h2>
            <label>
              Who can access
              <select id="share-mode">
                <option value="link">anyone with the link</option>
                <option value="emails">specific people</option>
                <option value="private">only me</option>
              </select>
            </label>
            <label id="email-section" hidden>
              Email addresses
              <textarea id="share-emails" placeholder="person@example.com, another@example.com"></textarea>
              <span class="hint">Separate multiple addresses with commas or new lines.</span>
            </label>
            <p id="manage-message" role="status"></p>
            <div class="actions">
              <button id="manage-cancel" type="button">cancel</button>
              <button class="primary" id="manage-save" type="submit">save</button>
            </div>
          </form>
        </dialog>
        <script>{raw(`
          const config = ${safeJsonForScript({ contentPath, managePath, privatePath })};
          const frame = document.getElementById("document");
          const error = document.getElementById("error");
          const badge = document.getElementById("status-badge");
          const manageButton = document.getElementById("manage-button");
          const dialog = document.getElementById("manage-dialog");
          const form = document.getElementById("manage-form");
          const modeSelect = document.getElementById("share-mode");
          const emailSection = document.getElementById("email-section");
          const emailInput = document.getElementById("share-emails");
          const message = document.getElementById("manage-message");
          const saveButton = document.getElementById("manage-save");

          function updateEmailVisibility() {
            emailSection.hidden = modeSelect.value !== "emails";
          }

          async function ownerRequest(options = {}) {
            const response = await fetch(config.managePath, {
              credentials: "include",
              redirect: "manual",
              cache: "no-store",
              ...options,
            });
            if (!response.ok) throw new Error("not authorized");
            return response.json();
          }

          ownerRequest().then((state) => {
            if (!state || !["private", "link", "emails"].includes(state.mode)) return;
            modeSelect.value = state.mode;
            emailInput.value = Array.isArray(state.emails) ? state.emails.join(", ") : "";
            updateEmailVisibility();
            manageButton.hidden = false;
          }).catch(() => {});

          manageButton.addEventListener("click", () => {
            message.textContent = "";
            dialog.showModal();
          });
          document.getElementById("manage-cancel").addEventListener("click", () => dialog.close());
          modeSelect.addEventListener("change", updateEmailVisibility);
          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const mode = modeSelect.value;
            const body = { mode };
            if (mode === "emails") {
              body.emails = [...new Set(emailInput.value.split(/[\\n,]/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
              if (body.emails.length === 0) {
                message.textContent = "Add at least one email address.";
                return;
              }
            }

            saveButton.disabled = true;
            message.textContent = "Saving…";
            try {
              const state = await ownerRequest({
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              if (!state || state.mode !== mode) throw new Error("unexpected response");
              if (mode === "link") {
                message.textContent = "Public link remains active.";
                dialog.close();
                return;
              }

              dialog.close();
              manageButton.hidden = true;
              badge.textContent = mode === "private" ? "private" : "specific people";
              frame.remove();
              error.replaceChildren(
                document.createTextNode(mode === "private" ? "This artifact is now private. " : "This artifact is now shared with specific people. "),
                Object.assign(document.createElement("a"), { href: config.privatePath, textContent: "Open the authenticated viewer." }),
              );
              error.style.display = "grid";
            } catch {
              message.textContent = "Could not update sharing. Try again.";
            } finally {
              saveButton.disabled = false;
            }
          });

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
