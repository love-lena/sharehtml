# sharehtml

I've been using coding agents to write in markdown, make slides, and build interactive data analysis as static HTML files. Sending those files around still gets messy fast: you can't update them after sharing, and there's no way to get feedback inline. This is the reason I built sharehtml.

![sharehtml screenshot](assets/screenshot.png)

## What is sharehtml?

Deploy a local document privately, then choose whether to collaborate with named people or publish an anonymous read-only link. Re-deploy to update the content at the same URL. Markdown and common code files are converted to styled HTML automatically.

- **CLI deploys** — `htmldog deploy report.html` → `https://artifacts.example.com/d/9brkzbe67ntm`
- **Collaborative** — comments, threaded replies, emoji reactions, text anchoring
- **Live presence** — see who's viewing and their selections
- **Home page** — your documents and recently viewed docs shared with you
- **Public links** — anonymous, read-only `/p/...` links with immediate revocation
- **Self-hosted** — runs on your own Cloudflare account

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/)
- [Bun](https://bun.sh/) (for the setup script and TypeScript development; not required by the shell client)
- [Cloudflare account](https://dash.cloudflare.com/sign-up) with [R2 enabled](https://developers.cloudflare.com/r2/pricing/#free-tier) (free tier available)

## Quick Start

```bash
git clone https://github.com/love-lena/sharehtml.git
cd sharehtml
pnpm install
npx wrangler login
pnpm run setup
```

The interactive setup script walks you through the Custom Domain or `workers.dev` choice, R2 bucket creation, deployment, CLI installation, and authentication. Built-in authentication uses GitHub OAuth; Cloudflare Access remains available as a legacy option. Without authentication, anyone with the URL can use the deployment. For a concrete personal-domain walkthrough, see [Personal Cloudflare deployment](docs/personal-cloudflare.md).
If you enable Cloudflare Access, setup protects the home page, private viewers, collaboration, and APIs while creating a more-specific Access Bypass application for anonymous read-only `/p/*` links. It also provisions the production `VIEWER_CAPABILITY_SECRET` used to sign browser capability tokens for the trusted authenticated viewer shell.

The fork ships a dependency-light shell client. Install it directly from the repository:

```bash
mkdir -p "$HOME/.local/bin"
curl -fsSL https://raw.githubusercontent.com/love-lena/sharehtml/main/bin/htmldog \
  -o "$HOME/.local/bin/htmldog"
chmod +x "$HOME/.local/bin/htmldog"
```

Ensure `$HOME/.local/bin` is on `PATH`. The client needs only `curl` and `openssl`; macOS Keychain and Linux Secret Service are used when available. It defaults to `https://artifacts.lena.dog`, and another deployment can be selected with `htmldog config set-url <url>`.

If your team already has a sharehtml worker deployed, install the script, run `htmldog config set-url <your-team-url>`, then `htmldog login`. For built-in auth, the command starts a PKCE-protected device authorization, opens the normal ShareHTML login page, and polls for completion. GitHub credentials never leave the Worker and `cloudflared` is not required. The resulting ShareHTML session lasts 24 hours and is stored in macOS Keychain or Linux Secret Service when available, with a mode-`0600` local fallback.

If you choose the legacy Cloudflare Access mode, you'll need a [Cloudflare API token](https://dash.cloudflare.com/profile/api-tokens) with these permissions:
- **Account > Access: Apps and Policies > Edit**
- **Account > Access: Organization, Identity Providers, and Groups > Read**
- **Account > Workers Scripts > Read** (only when resolving a `workers.dev` subdomain)

When it's done, try deploying one of the included examples:

```bash
htmldog deploy example/coffee-report.html
# or try the markdown example:
htmldog deploy example/sample.md
# or the interactive slideshow example:
htmldog deploy example/nba-slideshow.html
# or deploy a code file:
htmldog deploy apps/cli/src/index.ts
```

If a document with the same filename exists, the CLI will prompt to update it. Use `-u` to skip the prompt.

### Manual deploy

If you've already run setup and just need to redeploy:

```bash
pnpm run deploy
```

When authentication is enabled, make sure the production worker has `VIEWER_CAPABILITY_SECRET` configured. `pnpm run setup` handles that automatically.

To create it manually:

```bash
openssl rand -hex 32
npx wrangler secret put VIEWER_CAPABILITY_SECRET --env production
```

### Local development

```bash
pnpm dev
```

Starts the Vite dev server with Wrangler at http://localhost:5173. Local dev uses the default environment — `AUTH_MODE` is `"none"`, no login required.
Local development does not require `VIEWER_CAPABILITY_SECRET`.

To use the CLI locally:

```bash
htmldog config set-url http://localhost:5173
htmldog deploy my-report.html
```

## Architecture

```
CLI ──► Worker ──► R2 (HTML storage)
         │
Browser ◄┘──► Durable Objects
               ├── RegistryDO (users, documents, views)
               └── DocumentDO (per-doc comments, reactions, presence via WebSocket)
```

| Component | Purpose |
|-----------|---------|
| **[Worker](https://developers.cloudflare.com/workers/)** | HTTP routing, auth, serves viewer shell and home page |
| **RegistryDO** | Global [Durable Object](https://developers.cloudflare.com/durable-objects/) — users, document metadata, view history (SQLite) |
| **DocumentDO** | Per-document Durable Object — comments, reactions, real-time presence over WebSocket |
| **[R2](https://developers.cloudflare.com/r2/)** | Stores the actual HTML files |
| **CLI** | Dependency-light shell client using `curl`, `openssl`, and browser device authorization |

### Uploaded document security

Uploaded documents run in a sandboxed iframe and receive a restrictive Content Security Policy. Inline scripts and styles are supported for self-contained artifacts; network connections, external subresources, forms, objects, and nested frames are blocked. Images, fonts, and media must be embedded as `data:` or `blob:` URLs. Opening an external link through the trusted viewer shell requires a browser confirmation.

When Markdown images are converted to data URLs, the CLI only reads supported image files inside the Markdown file's own directory. Parent-directory paths and symlinks that escape that directory are left untouched.

### Custom domains

Choose **Publish on a custom domain** during `pnpm run setup` and enter a hostname such as `artifacts.example.com`. The hostname must be in an active Cloudflare zone with no conflicting DNS record. Setup writes a Workers Custom Domain route and disables the public `workers.dev` endpoint; Cloudflare then manages DNS and TLS automatically.

### Sharing model

Documents are private by default when Cloudflare Access is enabled:

- `/d/:id` is the authenticated viewer. Owners and explicitly listed email addresses can collaborate here.
- `/p/:id` is an anonymous, read-only viewer and only serves documents in link-sharing mode.
- Owners with an active Cloudflare Access session can manage sharing directly from `/p/:id`; the control stays hidden for anonymous and non-owner viewers.
- `htmldog share <document> link` enables the public route and prints its `/p/...` URL.
- `htmldog unshare <document>` disables both the public shell and content endpoint immediately. Public responses use `Cache-Control: no-store` and are marked `noindex`.

The Worker checks the document's current share mode on every public shell and content request. The document ID is not treated as the authorization check. Upload, source download, comments, WebSockets, document listing, and sharing controls remain behind Cloudflare Access.

## CLI Commands

| Command | Description |
|---------|-------------|
| `htmldog deploy <file> [title]` | Upload a new HTML artifact |
| `htmldog update <id> <file> [title]` | Replace an existing artifact |
| `htmldog list` | List documents as JSON |
| `htmldog pull <id> <output>` | Download the original source |
| `htmldog comments <id>` | Fetch comments as JSON |
| `htmldog delete <id>` | Delete a document |
| `htmldog share <id> <mode> [emails]` | Set `link`, `private`, or `emails` sharing |
| `htmldog unshare <id>` | Make a document private |
| `htmldog login` | Authorize the shell client through ShareHTML and GitHub |
| `htmldog logout` | Remove the saved CLI session for the configured deployment |
| `htmldog config set-url <url>` | Set the sharehtml URL |
| `htmldog config show` | Show current configuration |

## Agent Skill

Install the sharehtml skill to let coding agents deploy documents, compare changes, and review comments on your behalf. The skill teaches agents to diff before overwriting and keep documents private by default. Run `sharehtml skill install` to set it up for Claude Code, Codex, or OpenCode.

## Configuration

Production auth vars live in `wrangler.jsonc` under `env.production.vars`, set by `pnpm run setup`:

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH_MODE` | Yes | `"builtin"` enables GitHub login, `"none"` disables auth, and `"access"` keeps legacy Cloudflare Access JWT verification |
| `GITHUB_CLIENT_ID` | When using GitHub | GitHub OAuth app client ID. Set its callback URL to `https://YOUR_HOST/auth/github/callback` |
| `ACCESS_AUD` | When `AUTH_MODE=access` | Cloudflare Access Application Audience tag |
| `ACCESS_TEAM` | When `AUTH_MODE=access` | Cloudflare Access team name |

Production secrets:

| Secret | Required | Description |
|--------|----------|-------------|
| `AUTH_SECRET` | When `AUTH_MODE=builtin` | Random secret used to sign separate ShareHTML browser sessions and 24-hour CLI tokens |
| `GITHUB_CLIENT_SECRET` | When using GitHub | GitHub OAuth app client secret |
| `VIEWER_CAPABILITY_SECRET` | When auth is enabled | Secret used to sign short-lived browser capability tokens, keeping privileged viewer authority out of uploaded iframe JavaScript |

You can configure the secrets manually with `npx wrangler secret put NAME --env production`. Use a separate random value for `AUTH_SECRET` and `VIEWER_CAPABILITY_SECRET` (for example, `openssl rand -hex 32`). GitHub accounts are keyed by their verified GitHub email.

## Project Structure

```
apps/
├── worker/
│   ├── src/
│   │   ├── index.ts                  # Hono app, routing
│   │   ├── routes/
│   │   │   ├── api.ts                # REST API (CRUD documents)
│   │   │   ├── viewer.ts             # Document viewer + WebSocket proxy
│   │   ├── durable-objects/
│   │   │   ├── registry.ts           # RegistryDO — users, docs, views
│   │   │   └── document.ts           # DocumentDO — comments, reactions, presence
│   │   ├── frontend/
│   │   │   ├── home.tsx              # Home page (document list)
│   │   │   ├── shell.tsx             # Document viewer shell
│   │   ├── client/
│   │   │   ├── shell-client.ts       # Viewer shell JS (presence, sidebar)
│   │   │   ├── collab-client.ts      # In-iframe collaboration (comments, reactions)
│   │   │   └── styles.css            # Shared styles
│   │   └── utils/
│   │       ├── auth.ts               # Built-in sessions and CF Access JWT verification
│   │       ├── registry.ts           # getRegistry() helper
│   │       ├── crypto.ts             # sha256 utility
│   │       ├── assets.ts             # Vite asset URL resolution
│   │       └── ids.ts                # nanoid generator
│   ├── scripts/
│   │   └── setup.ts                  # Interactive production setup script
│   └── wrangler.jsonc                # Cloudflare Workers config
├── cli/
│   └── src/
│       ├── index.ts                  # CLI entry point (commander)
│       ├── commands/                 # deploy, list, open, delete, config
│       ├── api/                      # HTTP client for worker API
│       └── config/                   # Local config store (~/.config/sharehtml)
└── packages/
    └── shared/                       # Shared types (messages, comments, reactions)
```

## License

Apache-2.0
