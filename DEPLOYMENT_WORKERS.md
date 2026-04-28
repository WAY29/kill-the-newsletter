# Cloudflare Workers Deployment

This deployment path adds a Cloudflare Workers entry point beside the existing
Node/Caddy/SMTP deployment. The original `source/index.mts` entry point remains
unchanged.

## Architecture

The Workers deployment uses Cloudflare platform bindings instead of long-lived
Node processes:

- HTTP routes are served by `fetch` in `source/worker.mts`.
- Incoming email is handled by Cloudflare Email Routing and the Worker's `email`
  handler.
- D1 stores feeds, entries, WebSub subscriptions, and enclosure metadata.
- R2 stores attachment files.
- Cron Triggers run the `scheduled` handler for cleanup.

Workers cannot listen on SMTP port 25, run Caddy, fork child processes, or use a
local SQLite file. Configure Cloudflare Email Routing to deliver mail to this
Worker.

## Setup

Install dependencies without running native install scripts if your local
toolchain has the known `xxhash-addon` build issue:

```console
$ npm --cache /tmp/kill-the-newsletter-npm-cache install --ignore-scripts
```

Create Cloudflare resources:

```console
$ npx wrangler d1 create kill-the-newsletter
$ npx wrangler r2 bucket create kill-the-newsletter-files
```

Update `wrangler.jsonc`:

- Replace `vars.WEB_HOSTNAME` with the hostname that should serve web pages and
  feed URLs, for example `newsletter.example.com`.
- Replace `vars.EMAIL_HOSTNAME` with the zone-level hostname used for generated
  email addresses, for example `example.com`.
- Replace `routes[0].pattern` with the hostname that should serve the Worker.
  The default route is a Workers Custom Domain, so all HTTP paths on that
  hostname are served by this Worker.
- Replace `d1_databases[0].database_id` with the D1 database ID returned by
  `wrangler d1 create`.
- Change `r2_buckets[0].bucket_name` if you created a differently named bucket.

Apply the D1 migration:

```console
$ npm run migrate:worker:remote
```

Deploy:

```console
$ npm run deploy:worker
```

In Cloudflare Email Routing for the `EMAIL_HOSTNAME` zone, route the catch-all
address to the deployed Worker. Feed addresses are generated dynamically as
`<feed-public-id>@EMAIL_HOSTNAME`, so a catch-all route is required.

`EMAIL_HOSTNAME` must be the zone-level domain, not a subdomain. Cloudflare's
catch-all rule applies to the zone-level domain only, so a zone catch-all for
`example.com` will not catch arbitrary
`<feed-public-id>@newsletter.example.com` addresses. `WEB_HOSTNAME` may still be
a subdomain because it only controls web and feed URLs.

Verify that `EMAIL_HOSTNAME` has Email Routing MX records. For example:

```console
$ dig MX example.com
```

The result must include Cloudflare Email Routing MX hosts. If the answer section
is empty, external senders have no route to deliver mail to the Worker.

## Email Receipt Debugging

Start a live Worker log stream before sending a test email:

```console
$ npx wrangler tail kill-the-newsletter --format pretty
```

Send an email from a normal mailbox to the generated feed address, then look for
`Email accepted` or `Email rejected` in the log stream. Rejections include a
reason such as `invalid_recipient`, `unknown_feed`, `invalid_sender`, or
`email_too_big`.

You can also verify persistence directly in D1:

```console
$ npx wrangler d1 execute kill-the-newsletter --remote --command 'select "feedEntries"."createdAt", "feedEntries"."author", "feedEntries"."title" from "feedEntries" join "feeds" on "feeds"."id" = "feedEntries"."feed" where "feeds"."publicId" = "replace-with-feed-public-id" order by "feedEntries"."id" desc limit 10'
```

If the D1 query shows a new row, the Worker received and stored the email. If
the log stream and D1 query both show nothing, check Email Routing rules and MX
records first.

## GitHub Actions Deployment

The workflow in `.github/workflows/cloudflare-workers.yml` can run the Worker
tests, apply D1 migrations, and deploy the Worker. Configure these repository
secrets first:

- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with permission to deploy
  Workers, create and migrate D1 databases, and bind R2.
- `CLOUDFLARE_WEB_HOSTNAME`: Hostname used for web pages and feed URLs, and the
  Workers Custom Domain used for HTTP, for example `newsletter.example.com`.
- `CLOUDFLARE_EMAIL_HOSTNAME`: Zone-level hostname used for generated email
  addresses, for example `example.com`. This must not be a subdomain.

Recommended API token permissions:

- Account resources: include only the Cloudflare account that owns the target
  domain.
- Account permission `Workers Scripts`: `Edit`.
- Account permission `D1`: `Edit`.
- Account permission `Workers R2 Storage`: `Edit`. In the Chinese dashboard,
  choose `Workers R2 存储`, not `Workers R2 数据目录` or `Workers R2 SQL`.
- Zone resources: include only the target domain, for example the B domain if A
  already runs another mail service.
- Zone permission `Workers Routes`: `Edit`.
- Zone permission `Zone`: `Read`.

Optional secrets:

- `CLOUDFLARE_D1_DATABASE_ID`: Existing D1 database ID. If omitted, the workflow
  finds or creates a D1 database by name.
- `CLOUDFLARE_D1_DATABASE_NAME`: Defaults to `kill-the-newsletter`.
- `CLOUDFLARE_R2_BUCKET_NAME`: Defaults to `kill-the-newsletter-files`.

After the secrets are set, open GitHub Actions, select `Cloudflare Workers`, and
run the workflow.

## Local Validation

Run the Worker tests:

```console
$ npm run test:worker
```

Apply migrations locally and start Wrangler:

```console
$ npm run migrate:worker:local
$ npm run dev:worker
```

## Current Differences From The Node Deployment

- The Workers UI uses inline CSS based on the Node UI because it does not reuse
  the Node/Caddy static asset pipeline.
- WebSub verification and dispatch run through `ctx.waitUntil`; there is no
  durable retry queue yet.
- Attachments are served from R2 under `/files/<public-id>/<filename>`.
- Email receipt depends on Cloudflare Email Routing, not an SMTP server run by
  this project.
