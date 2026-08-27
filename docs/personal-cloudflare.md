# Personal Cloudflare deployment

This guide publishes a private ShareHTML instance at `artifacts.lena.dog`. Cloudflare Workers serves the app, R2 stores the uploaded HTML, Durable Objects store metadata and comments, and ShareHTML provides GitHub login. The production `workers.dev` URL is disabled.

## Before you run setup

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), confirm `lena.dog` is an **Active** zone in the account you intend to use.
2. In **DNS > Records**, make sure there is no existing record named `artifacts`. Wrangler will create the DNS record and certificate when it deploys the Custom Domain.
3. Open **Storage & databases > R2 object storage** and enable R2. Cloudflare may require checkout even when your usage stays inside the free allowance. The setup script creates the `sharehtml-documents` bucket.
4. Create a GitHub OAuth app with callback URL `https://artifacts.lena.dog/auth/github/callback`, and keep its client ID and secret ready.
5. Install the local prerequisites from the main README, then authenticate Wrangler:

   ```bash
   pnpm install
   npx wrangler login
   ```

For a guided dashboard walkthrough, run:

```bash
./scripts/setup-personal-cloudflare.sh
```

## Deploy

Run:

```bash
pnpm run setup
```

Choose these answers when prompted:

- Deploy to Cloudflare: **yes**
- Publish on a custom domain: **yes**
- Custom hostname: `artifacts.lena.dog`
- Use built-in GitHub authentication: **yes**
- GitHub OAuth client ID/secret: values from your OAuth app

The OAuth client secret and generated signing secrets are stored as encrypted Wrangler secrets, not in `wrangler.jsonc`.

Setup creates two Access applications:

- `artifacts.lena.dog` uses your allow policy and protects all private and management routes.
- `artifacts.lena.dog/p/*` uses an Everyone Bypass policy. These requests still pass through the Worker, which returns content only when that document is currently in link-sharing mode.

Wrangler's own browser login handles the Worker, R2, Durable Objects, route, DNS, and certificate. The generated Custom Domain route is equivalent to:

```json
{
  "workers_dev": false,
  "routes": [{ "pattern": "artifacts.lena.dog", "custom_domain": true }]
}
```

Do not create a CNAME manually. The hostname must be inside an active Cloudflare zone and must not conflict with an existing DNS record.

## Verify login and publishing

After setup prints the final URL:

```bash
htmldog config set-url https://artifacts.lena.dog
htmldog login
htmldog deploy example/coffee-report.html
```

`htmldog login` opens the same login page and polls a PKCE-protected device authorization until the browser approves it. The exchanged ShareHTML session lasts 24 hours; GitHub credentials are never returned to the CLI, and no `cloudflared` installation is needed. Verify all three paths:

1. Open `https://artifacts.lena.dog` in a private browser window and confirm the GitHub login page appears.
2. Complete the login and confirm the ShareHTML home page loads.
3. Deploy the example and open the returned document URL.

Then verify anonymous sharing and revocation:

```bash
htmldog share <document-id> link
# Open the printed /p/... URL in a private browser window; no login should appear.
htmldog unshare <document-id>
# The same /p/... URL should now return 404.
```

Also confirm there is no usable production `workers.dev` URL. Setup writes `workers_dev: false` for a Custom Domain.

## Ongoing use

- Run `pnpm run deploy` after application changes.
- Agents can run the normal `htmldog login` and `htmldog deploy <file>` commands.
- Run `pnpm run setup` again to change the hostname or authentication configuration. Verify the new hostname before manually removing the old DNS record.
- Uploaded documents live in the R2 bucket `sharehtml-documents`. Comments, users, and document metadata live in Durable Object SQLite storage.

Deleting the R2 bucket, Worker, or Durable Object namespaces is destructive and is not part of this setup flow.
