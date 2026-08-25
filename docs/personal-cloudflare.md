# Personal Cloudflare deployment

This guide publishes a private ShareHTML instance at `artifacts.lena.dog`. Cloudflare Workers serves the app, R2 stores the uploaded HTML, Durable Objects store metadata and comments, and Cloudflare Access provides the login page. The production `workers.dev` URL is disabled.

## Before you run setup

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), confirm `lena.dog` is an **Active** zone in the account you intend to use.
2. In **DNS > Records**, make sure there is no existing record named `artifacts`. Wrangler will create the DNS record and certificate when it deploys the Custom Domain.
3. Open **Storage & databases > R2 object storage** and enable R2. Cloudflare may require checkout even when your usage stays inside the free allowance. The setup script creates the `sharehtml-documents` bucket.
4. Open **Zero Trust**, choose **Get started**, and select a team name. New organizations only include Cloudflare login by default. To add email codes, go to **Integrations > Identity providers**, select **Add new identity provider**, and choose **One-time PIN**. An existing Google or GitHub identity provider also works.
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
- Require Cloudflare Access: **yes**
- Access policy: your own email address

The setup script asks for a short-lived Cloudflare API token to create the Access application. Give it only:

- Account > Access: Apps and Policies > Edit
- Account > Access: Organizations, Identity Providers, and Groups > Read

`Workers Scripts > Read` is only needed when using a `workers.dev` hostname. The token is held in memory for the setup run and is not written to disk. Revoke it after setup.

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
sharehtml config set-url https://artifacts.lena.dog
sharehtml login
sharehtml deploy example/coffee-report.html
```

`sharehtml login` uses `cloudflared access login`, so it works for people and agents without copying browser cookies into the CLI. Verify all three paths:

1. Open `https://artifacts.lena.dog` in a private browser window and confirm Cloudflare Access challenges you.
2. Complete the login and confirm the ShareHTML home page loads.
3. Deploy the example and open the returned document URL.

Also confirm there is no usable production `workers.dev` URL. Setup writes `workers_dev: false` for a Custom Domain.

## Ongoing use

- Run `pnpm run deploy` after application changes.
- Agents can run the normal `sharehtml login` and `sharehtml deploy <file>` commands.
- Run `pnpm run setup` again to change the hostname or Access policy. Verify the new hostname before manually removing the old DNS record or old Access application.
- Uploaded documents live in the R2 bucket `sharehtml-documents`. Comments, users, and document metadata live in Durable Object SQLite storage.

Deleting the R2 bucket, Worker, or Durable Object namespaces is destructive and is not part of this setup flow.
