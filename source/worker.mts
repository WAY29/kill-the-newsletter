import type {
  D1Database,
  ExecutionContext,
  ExportedHandler,
  ForwardableEmailMessage,
  Headers as WorkerHeaders,
  R2Bucket,
  ScheduledController,
} from "@cloudflare/workers-types";
import PostalMime from "postal-mime";
import type { Address, Attachment } from "postal-mime";

const PUBLIC_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PUBLIC_ID_LENGTH = 20;
const MAX_FEED_CONTENT_LENGTH = 2 ** 19;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export type Env = {
  DB: D1Database;
  FILES: R2Bucket;
  HOSTNAME?: string;
  WEB_HOSTNAME?: string;
  EMAIL_HOSTNAME?: string;
  ENVIRONMENT?: "production" | "development";
  SYSTEM_ADMINISTRATOR_EMAIL?: string;
};

export type Feed = {
  id: number;
  publicId: string;
  title: string;
  icon: string | null;
  emailIcon: string | null;
};

export type FeedEntry = {
  id: number;
  publicId: string;
  createdAt: string;
  author: string | null;
  title: string;
  content: string;
};

export type FeedEntryEnclosure = {
  id?: number;
  publicId: string;
  type: string;
  length: number;
  name: string;
};

const PAGE_CSS = `
*,
::before,
::after {
  font: inherit;
  font-synthesis: none;
  text-align: left;
  vertical-align: 0;
  text-decoration: inherit;
  text-size-adjust: 100%;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: inherit;
  background-color: transparent;
  opacity: 1;
  -webkit-tap-highlight-color: transparent;
  box-sizing: border-box;
  padding: 0;
  border: 0;
  margin: 0;
  outline: 0;
  overflow-wrap: break-word;
  appearance: none;
  list-style: none;
  resize: none;
  cursor: inherit;
}

:root {
  color-scheme: light dark;
  --font-family--sans-serif: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  --font-size--3: 0.75rem;
  --font-size--3--line-height: 1rem;
  --font-size--3-5: 0.875rem;
  --font-size--3-5--line-height: 1.25rem;
  --font-size--4-5: 1.125rem;
  --size--0: 0px;
  --size--1: 0.25rem;
  --size--2: 0.5rem;
  --size--4: 1rem;
  --size--8: 2rem;
  --size--96: 24rem;
  --size--144: 36rem;
  --border-width--1: 1px;
  --border-radius--1: 0.25rem;
  --color--black: #000000;
  --color--white: #ffffff;
  --color--slate--50: #f8fafc;
  --color--slate--200: #e2e8f0;
  --color--slate--400: #94a3b8;
  --color--slate--500: #64748b;
  --color--slate--600: #475569;
  --color--slate--800: #1e293b;
  --color--slate--950: #020617;
  --color--blue--400: #60a5fa;
  --color--blue--500: #3b82f6;
  --color--blue--600: #2563eb;
  --color--red--500: #ef4444;
  --transition-property--colors: color, background-color, border-color, text-decoration-color, fill, stroke;
  --transition-duration--150: 150ms;
  --transition-timing-function--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
}

body {
  font-family: "Roboto Flex Variable", var(--font-family--sans-serif);
  font-size: var(--font-size--3-5);
  line-height: var(--font-size--3-5--line-height);
  color: light-dark(var(--color--black), var(--color--white));
  background-color: light-dark(var(--color--white), var(--color--black));
  padding: var(--size--4);
}

main {
  max-width: var(--size--144);
  margin: var(--size--0) auto;
  display: flex;
  flex-direction: column;
  gap: var(--size--4);
}

header {
  display: flex;
  flex-direction: column;
  gap: var(--size--1);
}

.brand {
  font-size: var(--font-size--4-5);
  line-height: var(--font-size--3-5--line-height);
  font-weight: 700;
}

.brand-link {
  display: inline-flex;
  gap: var(--size--2);
  text-decoration: none;
}

.brand-link:not(:hover, :focus-within, :active) {
  color: light-dark(var(--color--black), var(--color--white));
}

section,
form,
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--size--4);
}

.row {
  display: flex;
  gap: var(--size--2);
}

@media (max-width: 400px) {
  .row {
    flex-direction: column;
  }
}

input[type="text"],
button {
  background-color: light-dark(var(--color--slate--50), var(--color--slate--950));
  padding: var(--size--1) var(--size--2);
  border: var(--border-width--1) solid light-dark(var(--color--slate--400), var(--color--slate--600));
  border-radius: var(--border-radius--1);
  transition-property: var(--transition-property--colors);
  transition-duration: var(--transition-duration--150);
  transition-timing-function: var(--transition-timing-function--ease-in-out);
}

input[type="text"]:focus,
button:focus {
  border-color: light-dark(var(--color--blue--500), var(--color--blue--500));
}

input[type="text"] {
  width: 100%;
}

.row input[type="text"] {
  flex: 1;
}

button {
  cursor: pointer;
}

a {
  cursor: pointer;
  text-decoration: underline;
  color: light-dark(var(--color--blue--500), var(--color--blue--500));
  transition-property: var(--transition-property--colors);
  transition-duration: var(--transition-duration--150);
  transition-timing-function: var(--transition-timing-function--ease-in-out);
}

a:hover,
a:focus-within {
  color: light-dark(var(--color--blue--400), var(--color--blue--400));
}

a:active {
  color: light-dark(var(--color--blue--600), var(--color--blue--600));
}

h2 {
  font-weight: 700;
}

hr {
  border-bottom: var(--border-width--1) solid light-dark(var(--color--slate--200), var(--color--slate--800));
}

small {
  font-size: var(--font-size--3);
  line-height: var(--font-size--3--line-height);
  font-weight: 700;
  color: light-dark(var(--color--slate--500), var(--color--slate--500));
}

.danger {
  color: light-dark(var(--color--red--500), var(--color--red--500));
}
`;

export function escapeHTML(value: string): string {
  return value.replaceAll(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        throw new Error(`Unexpected character: ${character}`);
    }
  });
}

export function generatePublicId(): string {
  const randomBytes = new Uint8Array(PUBLIC_ID_LENGTH);
  globalThis.crypto.getRandomValues(randomBytes);
  return Array.from(
    randomBytes,
    (byte) => PUBLIC_ID_ALPHABET[byte % PUBLIC_ID_ALPHABET.length],
  ).join("");
}

export function parseFeedAddress(
  address: string,
  hostname: string,
  environment: Env["ENVIRONMENT"] = "production",
): string | undefined {
  const normalizedAddress =
    address.trim().match(/<([^<>]+)>$/)?.[1] ?? address.trim();
  const atIndex = normalizedAddress.lastIndexOf("@");
  if (atIndex === -1) return undefined;
  const localPart = normalizedAddress.slice(0, atIndex);
  const addressHostname = normalizedAddress.slice(atIndex + 1);
  if (addressHostname.toLowerCase() !== hostname.toLowerCase())
    return undefined;
  if (environment !== "development" && !/^[A-Za-z0-9]+$/.test(localPart))
    return undefined;
  if (environment === "development" && !/^[A-Za-z0-9_.+-]+$/.test(localPart))
    return undefined;
  return localPart;
}

export function sanitizeFilename(filename: string | null | undefined): string {
  if (typeof filename !== "string") return "untitled";
  const sanitized = filename.replaceAll(/[^A-Za-z0-9_.-]/g, "-");
  if (sanitized === "" || sanitized === "." || sanitized === "..")
    return "untitled";
  return sanitized;
}

export function textToHTML(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  if (paragraphs.length === 0) return "<p>No content.</p>";
  return paragraphs
    .map(
      (paragraph) =>
        `<p>${escapeHTML(paragraph).replaceAll("\n", "<br />")}</p>`,
    )
    .join("");
}

export function renderFeed({
  hostname,
  feed,
  feedEntries,
  enclosuresByFeedEntry,
}: {
  hostname: string;
  feed: Feed;
  feedEntries: FeedEntry[];
  enclosuresByFeedEntry: Map<number, FeedEntryEnclosure[]>;
}): string {
  const feedURL = `https://${hostname}/feeds/${feed.publicId}.xml`;
  const hubURL = `https://${hostname}/feeds/${feed.publicId}/websub`;
  const settingsLink = `<hr /><p><small><a href="https://${hostname}/feeds/${feed.publicId}">Kill the Newsletter! feed settings</a></small></p>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:kill-the-newsletter:${escapeHTML(feed.publicId)}</id>
  <link rel="self" href="${escapeHTML(feedURL)}" />
  <link rel="hub" href="${escapeHTML(hubURL)}" />
  ${
    typeof feed.icon === "string" || typeof feed.emailIcon === "string"
      ? `<icon>${escapeHTML(feed.icon ?? feed.emailIcon ?? "")}</icon>`
      : ""
  }
  <updated>${escapeHTML(feedEntries[0]?.createdAt ?? "2000-01-01T00:00:00.000Z")}</updated>
  <title>${escapeHTML(feed.title)}</title>
  ${feedEntries
    .map((feedEntry) => {
      const enclosures = enclosuresByFeedEntry.get(feedEntry.id) ?? [];
      return `<entry>
    <id>urn:kill-the-newsletter:${escapeHTML(feedEntry.publicId)}</id>
    <link rel="alternate" type="text/html" href="${escapeHTML(`https://${hostname}/feeds/${feed.publicId}/entries/${feedEntry.publicId}.html`)}" />
    ${enclosures
      .map(
        (enclosure) =>
          `<link rel="enclosure" type="${escapeHTML(enclosure.type)}" length="${String(enclosure.length)}" href="${escapeHTML(`https://${hostname}/files/${enclosure.publicId}/${encodeURIComponent(enclosure.name)}`)}" />`,
      )
      .join("\n    ")}
    <published>${escapeHTML(feedEntry.createdAt)}</published>
    <updated>${escapeHTML(feedEntry.createdAt)}</updated>
    <author>
      <name>${escapeHTML(feedEntry.author ?? "Kill the Newsletter!")}</name>
      <email>${escapeHTML(feedEntry.author ?? "kill-the-newsletter@leafac.com")}</email>
    </author>
    <title>${escapeHTML(feedEntry.title)}</title>
    <content type="html">${escapeHTML(feedEntry.content + settingsLink)}</content>
  </entry>`;
    })
    .join("\n  ")}
</feed>`;
}

function page({
  title,
  body,
  status = 200,
}: {
  title: string;
  body: string;
  status?: number;
}): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="none" />
    <title>${escapeHTML(title)}</title>
    <style>${PAGE_CSS}</style>
  </head>
  <body>
    <main>
      <header>
        <div class="brand">
          <a class="brand-link" href="/" aria-label="Kill the Newsletter! home">
            <span>Email -&gt; RSS</span>
            <span>Kill the Newsletter!</span>
          </a>
        </div>
        <div><small>Convert email newsletters into Atom feeds</small></div>
      </header>
      ${body}
    </main>
  </body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Robots-Tag": "none",
      },
    },
  );
}

function validationError(message = "Invalid request."): Response {
  return page({
    title: "Validation error · Kill the Newsletter!",
    status: 400,
    body: `<h1>Validation error</h1><p>${escapeHTML(message)}</p>`,
  });
}

function notFound(): Response {
  return page({
    title: "Not found · Kill the Newsletter!",
    status: 404,
    body: `<h1>Not found</h1><p>The requested feed or entry does not exist.</p>`,
  });
}

function redirect(request: Request, pathname: string): Response {
  return Response.redirect(new URL(pathname, request.url).href, 303);
}

export function configuredWebHostname(
  env: Pick<Env, "HOSTNAME" | "WEB_HOSTNAME">,
  requestHostname: string,
): string {
  return env.WEB_HOSTNAME || env.HOSTNAME || requestHostname;
}

export function configuredEmailHostname(
  env: Pick<Env, "HOSTNAME" | "WEB_HOSTNAME" | "EMAIL_HOSTNAME">,
): string {
  return env.EMAIL_HOSTNAME || env.HOSTNAME || env.WEB_HOSTNAME || "";
}

function environment(env: Env): Env["ENVIRONMENT"] {
  return env.ENVIRONMENT ?? "production";
}

async function readFields(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body))
      return {};
    return Object.fromEntries(
      Object.entries(body)
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        )
        .map(([key, value]) => [key, value]),
    );
  }

  const formData = await request.formData();
  const fields: Record<string, string> = {};
  for (const [key, value] of formData)
    if (typeof value === "string") fields[key] = value;
  return fields;
}

async function getFeed(env: Env, publicId: string): Promise<Feed | null> {
  return await env.DB.prepare(
    `select "id", "publicId", "title", "icon", "emailIcon"
     from "feeds"
     where "publicId" = ?`,
  )
    .bind(publicId)
    .first<Feed>();
}

async function getFeedEntries(env: Env, feedId: number): Promise<FeedEntry[]> {
  return (
    await env.DB.prepare(
      `select "id", "publicId", "createdAt", "author", "title", "content"
       from "feedEntries"
       where "feed" = ?
       order by "id" desc`,
    )
      .bind(feedId)
      .all<FeedEntry>()
  ).results;
}

async function getEnclosuresByFeedEntry(
  env: Env,
  feedId: number,
): Promise<Map<number, FeedEntryEnclosure[]>> {
  const rows = (
    await env.DB.prepare(
      `select
         "feedEntries"."id" as "feedEntry",
         "feedEntryEnclosures"."id" as "id",
         "feedEntryEnclosures"."publicId" as "publicId",
         "feedEntryEnclosures"."type" as "type",
         "feedEntryEnclosures"."length" as "length",
         "feedEntryEnclosures"."name" as "name"
       from "feedEntryEnclosures"
       join "feedEntryEnclosureLinks" on
         "feedEntryEnclosureLinks"."feedEntryEnclosure" = "feedEntryEnclosures"."id"
       join "feedEntries" on
         "feedEntries"."id" = "feedEntryEnclosureLinks"."feedEntry"
       where "feedEntries"."feed" = ?
       order by "feedEntryEnclosures"."id" asc`,
    )
      .bind(feedId)
      .all<FeedEntryEnclosure & { feedEntry: number }>()
  ).results;

  const enclosuresByFeedEntry = new Map<number, FeedEntryEnclosure[]>();
  for (const row of rows) {
    const enclosures = enclosuresByFeedEntry.get(row.feedEntry) ?? [];
    enclosures.push({
      id: row.id,
      publicId: row.publicId,
      type: row.type,
      length: row.length,
      name: row.name,
    });
    enclosuresByFeedEntry.set(row.feedEntry, enclosures);
  }
  return enclosuresByFeedEntry;
}

function renderHome(): Response {
  return page({
    title: "Kill the Newsletter!",
    body: `<h1>Kill the Newsletter!</h1>
<form method="post" action="/feeds">
  <label>
    <span>Feed title</span><br />
    <input type="text" name="title" placeholder="Feed title..." required maxlength="200" autofocus />
  </label>
  <button type="submit">Create feed</button>
</form>
<section>
  <h2>How does it work?</h2>
  <p>Create a feed and use the generated email address when signing up for newsletters. Emails sent to that address become Atom feed entries.</p>
</section>`,
  });
}

async function createFeed(request: Request, env: Env): Promise<Response> {
  const fields = await readFields(request);
  const title = fields.title?.trim();
  if (typeof title !== "string" || title === "" || title.length > 200)
    return validationError(
      "Feed title is required and must be at most 200 characters.",
    );

  const publicId = generatePublicId();
  const result = await env.DB.prepare(
    `insert into "feeds" ("publicId", "title")
     values (?, ?)`,
  )
    .bind(publicId, title)
    .run();
  const feed: Feed = {
    id: result.meta.last_row_id,
    publicId,
    title,
    icon: null,
    emailIcon: null,
  };

  const requestHostname = new URL(request.url).hostname;
  const webHostname = configuredWebHostname(env, requestHostname);
  const emailHostname = configuredEmailHostname(env);
  if (request.headers.get("Accept")?.includes("application/json"))
    return Response.json({
      feedId: feed.publicId,
      email: `${feed.publicId}@${emailHostname}`,
      feed: `https://${webHostname}/feeds/${feed.publicId}.xml`,
    });

  return redirect(request, `/feeds/${feed.publicId}`);
}

function renderFeedSettings(request: Request, env: Env, feed: Feed): Response {
  const webHostname = configuredWebHostname(env, new URL(request.url).hostname);
  const emailHostname = configuredEmailHostname(env);
  const emailAddress = `${feed.publicId}@${emailHostname}`;
  const feedURL = `https://${webHostname}/feeds/${feed.publicId}.xml`;
  return page({
    title: `${feed.title} · Kill the Newsletter!`,
    body: `<h1>${escapeHTML(feed.title)}</h1>
<section>
  <p>Subscribe to newsletters with this email address:</p>
  <input type="text" readonly value="${escapeHTML(emailAddress)}" />
</section>
<section>
  <p>Subscribe to this Atom feed:</p>
  <input type="text" readonly value="${escapeHTML(feedURL)}" />
</section>
<p><a href="/">Create another feed</a></p>
<hr />
<section>
  <h2>Feed settings</h2>
  <form method="post" action="/feeds/${escapeHTML(feed.publicId)}">
    <input type="hidden" name="_method" value="PATCH" />
    <label>
      <span>Title</span><br />
      <input type="text" name="title" value="${escapeHTML(feed.title)}" required maxlength="200" />
    </label>
    <label>
      <span>Icon URL</span><br />
      <input type="text" name="icon" value="${escapeHTML(feed.icon ?? "")}" maxlength="200" placeholder="https://example.com/favicon.ico" />
    </label>
    <button type="submit">Update feed settings</button>
  </form>
</section>
<hr />
<section>
  <h2>Delete feed</h2>
  <p class="danger">This action cannot be reverted.</p>
  <form method="post" action="/feeds/${escapeHTML(feed.publicId)}">
    <input type="hidden" name="_method" value="DELETE" />
    <label>
      <span>Feed title confirmation</span><br />
      <input type="text" name="titleConfirmation" placeholder="${escapeHTML(feed.title)}" required />
    </label>
    <button type="submit">Delete feed</button>
  </form>
</section>`,
  });
}

async function updateFeed(
  request: Request,
  env: Env,
  feed: Feed,
  fields?: Record<string, string>,
): Promise<Response> {
  fields ??= await readFields(request);
  const title = fields.title?.trim();
  const icon = fields.icon?.trim() ?? "";
  if (
    typeof title !== "string" ||
    title === "" ||
    title.length > 200 ||
    icon.length > 200
  )
    return validationError();
  if (icon !== "") {
    try {
      new URL(icon);
    } catch {
      return validationError("Icon must be a valid URL.");
    }
  }

  await env.DB.prepare(
    `update "feeds"
     set "title" = ?, "icon" = ?
     where "id" = ?`,
  )
    .bind(title, icon === "" ? null : icon, feed.id)
    .run();
  return redirect(request, `/feeds/${feed.publicId}`);
}

async function deleteFeed(
  request: Request,
  env: Env,
  feed: Feed,
  fields?: Record<string, string>,
): Promise<Response> {
  fields ??= await readFields(request);
  if (fields.titleConfirmation !== feed.title)
    return validationError("Feed title confirmation does not match.");

  await env.DB.batch([
    env.DB.prepare(
      `delete from "feedEntryEnclosureLinks"
       where "feedEntry" in (
         select "id" from "feedEntries" where "feed" = ?
       )`,
    ).bind(feed.id),
    env.DB.prepare(`delete from "feedEntries" where "feed" = ?`).bind(feed.id),
    env.DB.prepare(`delete from "feedVisualizations" where "feed" = ?`).bind(
      feed.id,
    ),
    env.DB.prepare(
      `delete from "feedWebSubSubscriptions" where "feed" = ?`,
    ).bind(feed.id),
    env.DB.prepare(`delete from "feeds" where "id" = ?`).bind(feed.id),
  ]);
  return redirect(request, "/");
}

async function serveFeedXML(
  request: Request,
  env: Env,
  feed: Feed,
): Promise<Response> {
  const recentVisualizationCount = await env.DB.prepare(
    `select count(*) as "count"
     from "feedVisualizations"
     where "feed" = ? and ? < "createdAt"`,
  )
    .bind(feed.id, new Date(Date.now() - ONE_HOUR_MS).toISOString())
    .first<{ count: number }>();
  if ((recentVisualizationCount?.count ?? 0) > 10)
    return page({
      title: "Rate limit · Kill the Newsletter!",
      status: 429,
      body: `<h1>Rate limit</h1><p>This feed was visualized too often. Please return in one hour.</p>`,
    });

  await env.DB.prepare(
    `insert into "feedVisualizations" ("feed", "createdAt")
     values (?, ?)`,
  )
    .bind(feed.id, new Date().toISOString())
    .run();

  const feedEntries = await getFeedEntries(env, feed.id);
  const enclosuresByFeedEntry = await getEnclosuresByFeedEntry(env, feed.id);
  return new Response(
    renderFeed({
      hostname: configuredWebHostname(env, new URL(request.url).hostname),
      feed,
      feedEntries,
      enclosuresByFeedEntry,
    }),
    {
      headers: {
        "Content-Type": "application/atom+xml; charset=utf-8",
        "X-Robots-Tag": "none",
      },
    },
  );
}

async function serveFeedEntryHTML(
  env: Env,
  feed: Feed,
  feedEntryPublicId: string,
): Promise<Response> {
  const feedEntry = await env.DB.prepare(
    `select "content"
     from "feedEntries"
     where "feed" = ? and "publicId" = ?`,
  )
    .bind(feed.id, feedEntryPublicId)
    .first<{ content: string }>();
  if (feedEntry === null) return notFound();
  return new Response(feedEntry.content, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'self'; img-src *; style-src 'self' 'unsafe-inline'; frame-src 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'",
      "Cross-Origin-Embedder-Policy": "unsafe-none",
      "X-Robots-Tag": "none",
    },
  });
}

function fileKey(publicId: string, name: string): string {
  return `files/${publicId}/${name}`;
}

async function serveFile(
  env: Env,
  publicId: string,
  rawName: string,
): Promise<Response> {
  let name: string;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    return notFound();
  }
  if (sanitizeFilename(name) !== name) return notFound();

  const object = await env.FILES.get(fileKey(publicId, name));
  if (object === null) return notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers as unknown as WorkerHeaders);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/octet-stream");
  return new Response(object.body as unknown as BodyInit, { headers });
}

function validateWebSubCallback(
  hostname: string,
  callback: string,
): URL | null {
  let callbackURL: URL;
  try {
    callbackURL = new URL(callback);
  } catch {
    return null;
  }
  if (callbackURL.href !== callback) return null;
  if (callbackURL.protocol !== "https:" && callbackURL.protocol !== "http:")
    return null;
  if (
    callbackURL.hostname === hostname ||
    callbackURL.hostname === "localhost" ||
    callbackURL.hostname === "127.0.0.1"
  )
    return null;
  return callbackURL;
}

async function handleWebSub(
  request: Request,
  env: Env,
  feed: Feed,
  ctx: ExecutionContext,
): Promise<Response> {
  const hostname = configuredWebHostname(env, new URL(request.url).hostname);
  const fields = await readFields(request);
  const mode = fields["hub.mode"];
  const topic = fields["hub.topic"] ?? fields["hub.url"];
  const callback = fields["hub.callback"];
  const secret = fields["hub.secret"];
  const callbackURL =
    typeof callback === "string"
      ? validateWebSubCallback(hostname, callback)
      : null;

  if (
    (mode !== "subscribe" && mode !== "unsubscribe") ||
    topic !== `https://${hostname}/feeds/${feed.publicId}.xml` ||
    callbackURL === null ||
    (secret !== undefined && secret === "")
  )
    return validationError();

  if (mode === "subscribe") {
    const recentSubscriptionCount = await env.DB.prepare(
      `select count(*) as "count"
       from "feedWebSubSubscriptions"
       where
         "feed" = ? and
         ? < "createdAt" and
         "callback" != ?`,
    )
      .bind(feed.id, new Date(Date.now() - ONE_DAY_MS).toISOString(), callback)
      .first<{ count: number }>();
    if ((recentSubscriptionCount?.count ?? 0) > 10) return validationError();
  }

  ctx.waitUntil(
    verifyWebSub({
      env,
      feed,
      mode,
      topic,
      callback,
      secret: secret ?? null,
    }),
  );
  return new Response(null, { status: 202 });
}

async function verifyWebSub({
  env,
  feed,
  mode,
  topic,
  callback,
  secret,
}: {
  env: Env;
  feed: Feed;
  mode: "subscribe" | "unsubscribe";
  topic: string;
  callback: string;
  secret: string | null;
}): Promise<void> {
  const challenge =
    generatePublicId() + generatePublicId() + generatePublicId();
  const verificationURL = new URL(callback);
  verificationURL.searchParams.append("hub.mode", mode);
  verificationURL.searchParams.append("hub.topic", topic);
  verificationURL.searchParams.append("hub.challenge", challenge);
  if (mode === "subscribe")
    verificationURL.searchParams.append(
      "hub.lease_seconds",
      String(ONE_DAY_MS / 1000),
    );

  const response = await fetch(verificationURL, { redirect: "manual" });
  if (!response.ok || (await response.text()) !== challenge) return;

  if (mode === "subscribe")
    await env.DB.prepare(
      `insert into "feedWebSubSubscriptions" (
         "feed",
         "createdAt",
         "callback",
         "secret"
       )
       values (?, ?, ?, ?)
       on conflict ("feed", "callback") do update set
         "createdAt" = excluded."createdAt",
         "secret" = excluded."secret"`,
    )
      .bind(feed.id, new Date().toISOString(), callback, secret)
      .run();
  else
    await env.DB.prepare(
      `delete from "feedWebSubSubscriptions"
       where "feed" = ? and "callback" = ?`,
    )
      .bind(feed.id, callback)
      .run();
}

async function fetchHandler(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") return renderHome();
  if (request.method === "POST" && url.pathname === "/feeds")
    return await createFeed(request, env);

  const fileMatch = url.pathname.match(/^\/files\/([A-Za-z0-9]+)\/([^/]+)$/);
  if (request.method === "GET" && fileMatch !== null)
    return await serveFile(env, fileMatch[1], fileMatch[2]);

  const entryMatch = url.pathname.match(
    /^\/feeds\/([A-Za-z0-9]+)\/entries\/([A-Za-z0-9]+)\.html$/,
  );
  if (request.method === "GET" && entryMatch !== null) {
    const feed = await getFeed(env, entryMatch[1]);
    if (feed === null) return notFound();
    return await serveFeedEntryHTML(env, feed, entryMatch[2]);
  }

  const webSubMatch = url.pathname.match(/^\/feeds\/([A-Za-z0-9]+)\/websub$/);
  if (request.method === "POST" && webSubMatch !== null) {
    const feed = await getFeed(env, webSubMatch[1]);
    if (feed === null) return notFound();
    return await handleWebSub(request, env, feed, ctx);
  }

  const feedXMLMatch = url.pathname.match(/^\/feeds\/([A-Za-z0-9]+)\.xml$/);
  if (request.method === "GET" && feedXMLMatch !== null) {
    const feed = await getFeed(env, feedXMLMatch[1]);
    if (feed === null) return notFound();
    return await serveFeedXML(request, env, feed);
  }

  const feedMatch = url.pathname.match(/^\/feeds\/([A-Za-z0-9]+)$/);
  if (feedMatch !== null) {
    const feed = await getFeed(env, feedMatch[1]);
    if (feed === null) return notFound();

    if (request.method === "GET") return renderFeedSettings(request, env, feed);
    if (request.method === "PATCH") return await updateFeed(request, env, feed);
    if (request.method === "DELETE")
      return await deleteFeed(request, env, feed);
    if (request.method === "POST") {
      const fields = await readFields(request);
      if (fields._method === "PATCH")
        return await updateFeed(request, env, feed, fields);
      if (fields._method === "DELETE")
        return await deleteFeed(request, env, feed, fields);
    }
  }

  return notFound();
}

function mailboxAddress(address: Address | undefined): string | undefined {
  if (address === undefined) return undefined;
  if ("address" in address && typeof address.address === "string")
    return address.address;
  if ("group" in address && address.group.length > 0)
    return address.group[0]?.address;
  return undefined;
}

function isValidSender(address: string): boolean {
  return (
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address) &&
    !["blogtrottr.com", "feedrabbit.com"].some((hostname) =>
      address.toLowerCase().endsWith(`@${hostname}`),
    )
  );
}

function attachmentBytes(content: Attachment["content"]): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(content);
}

async function storeAttachment(
  env: Env,
  attachment: Attachment,
): Promise<FeedEntryEnclosure> {
  const publicId = generatePublicId();
  const name = sanitizeFilename(attachment.filename);
  const bytes = attachmentBytes(attachment.content);
  const type = attachment.mimeType || "application/octet-stream";
  await env.FILES.put(fileKey(publicId, name), bytes, {
    httpMetadata: {
      contentType: type,
      contentDisposition: `attachment; filename="${name.replaceAll(/["\\]/g, "-")}"`,
    },
  });
  const result = await env.DB.prepare(
    `insert into "feedEntryEnclosures" (
       "publicId",
       "type",
       "length",
       "name"
     )
     values (?, ?, ?, ?)`,
  )
    .bind(publicId, type, bytes.byteLength, name)
    .run();
  return {
    id: result.meta.last_row_id,
    publicId,
    type,
    length: bytes.byteLength,
    name,
  };
}

async function linkEnclosures(
  env: Env,
  feedEntryId: number,
  enclosures: FeedEntryEnclosure[],
): Promise<void> {
  if (enclosures.length === 0) return;
  await env.DB.batch(
    enclosures.map((enclosure) =>
      env.DB.prepare(
        `insert into "feedEntryEnclosureLinks" (
           "feedEntry",
           "feedEntryEnclosure"
         )
         values (?, ?)`,
      ).bind(feedEntryId, enclosure.id),
    ),
  );
}

async function pruneFeedEntries(env: Env, feedId: number): Promise<void> {
  const feedEntries = (
    await env.DB.prepare(
      `select "id", "title", "content"
       from "feedEntries"
       where "feed" = ?
       order by "id" asc`,
    )
      .bind(feedId)
      .all<{ id: number; title: string; content: string }>()
  ).results;

  let feedLength = 0;
  while (feedEntries.length > 0) {
    const feedEntry = feedEntries.pop();
    if (feedEntry === undefined) break;
    feedLength += feedEntry.title.length + feedEntry.content.length;
    if (feedLength > MAX_FEED_CONTENT_LENGTH) break;
  }

  for (const feedEntry of feedEntries)
    await env.DB.batch([
      env.DB.prepare(
        `delete from "feedEntryEnclosureLinks" where "feedEntry" = ?`,
      ).bind(feedEntry.id),
      env.DB.prepare(`delete from "feedEntries" where "id" = ?`).bind(
        feedEntry.id,
      ),
    ]);
}

async function hmacSHA256Hex(secret: string, body: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function dispatchWebSubForFeedEntry({
  env,
  hostname,
  feedId,
  feedEntryId,
}: {
  env: Env;
  hostname: string;
  feedId: number;
  feedEntryId: number;
}): Promise<void> {
  const feed = await env.DB.prepare(
    `select "id", "publicId", "title", "icon", "emailIcon"
     from "feeds"
     where "id" = ?`,
  )
    .bind(feedId)
    .first<Feed>();
  const feedEntry = await env.DB.prepare(
    `select "id", "publicId", "createdAt", "author", "title", "content"
     from "feedEntries"
     where "id" = ?`,
  )
    .bind(feedEntryId)
    .first<FeedEntry>();
  if (feed === null || feedEntry === null) return;

  const subscriptions = (
    await env.DB.prepare(
      `select "id", "callback", "secret"
       from "feedWebSubSubscriptions"
       where "feed" = ? and ? < "createdAt"`,
    )
      .bind(feedId, new Date(Date.now() - ONE_DAY_MS).toISOString())
      .all<{ id: number; callback: string; secret: string | null }>()
  ).results;
  const enclosuresByFeedEntry = await getEnclosuresByFeedEntry(env, feed.id);
  const body = renderFeed({
    hostname,
    feed,
    feedEntries: [feedEntry],
    enclosuresByFeedEntry,
  });

  for (const subscription of subscriptions) {
    const headers = new Headers({
      "Content-Type": "application/atom+xml; charset=utf-8",
      Link: `<https://${hostname}/feeds/${feed.publicId}.xml>; rel="self", <https://${hostname}/feeds/${feed.publicId}/websub>; rel="hub"`,
    });
    if (subscription.secret !== null)
      headers.set(
        "X-Hub-Signature",
        `sha256=${await hmacSHA256Hex(subscription.secret, body)}`,
      );

    const response = await fetch(subscription.callback, {
      method: "POST",
      redirect: "manual",
      headers,
      body,
    });
    if (response.status === 410)
      await env.DB.prepare(
        `delete from "feedWebSubSubscriptions" where "id" = ?`,
      )
        .bind(subscription.id)
        .run();
    else if (String(response.status).startsWith("4"))
      console.warn("WebSub callback rejected dispatch", response.status);
    else if (!response.ok)
      throw new Error(`WebSub dispatch failed with status ${response.status}`);
  }
}

function logEmailRejected(
  reason: string,
  message: ForwardableEmailMessage,
  feedPublicId?: string,
): void {
  console.warn("Email rejected", {
    reason,
    from: message.from,
    to: message.to,
    feedPublicId,
    rawSize: message.rawSize,
  });
}

async function receiveEmail(
  message: ForwardableEmailMessage,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const hostname = configuredEmailHostname(env);
  const feedPublicId = parseFeedAddress(message.to, hostname, environment(env));
  if (feedPublicId === undefined) {
    logEmailRejected("invalid_recipient", message);
    message.setReject("Invalid recipient.");
    return;
  }
  if (message.rawSize > MAX_FEED_CONTENT_LENGTH) {
    logEmailRejected("email_too_big", message, feedPublicId);
    message.setReject("Email is too big.");
    return;
  }
  if (!isValidSender(message.from)) {
    logEmailRejected("invalid_sender", message, feedPublicId);
    message.setReject("Invalid sender.");
    return;
  }

  const feed = await getFeed(env, feedPublicId);
  if (feed === null) {
    logEmailRejected("unknown_feed", message, feedPublicId);
    message.setReject("Unknown feed.");
    return;
  }

  const email = await PostalMime.parse(
    message.raw as unknown as ReadableStream,
    {
      attachmentEncoding: "arraybuffer",
    },
  );
  const enclosures = new Array<FeedEntryEnclosure>();
  for (const attachment of email.attachments)
    enclosures.push(await storeAttachment(env, attachment));

  const senderAddress = mailboxAddress(email.from) ?? message.from;
  const senderHostname = message.from.split("@").at(-1);
  const content =
    typeof email.html === "string" && email.html.trim() !== ""
      ? email.html
      : typeof email.text === "string" && email.text.trim() !== ""
        ? textToHTML(email.text)
        : "No content.";

  await env.DB.prepare(
    `update "feeds"
     set "emailIcon" = ?
     where "id" = ?`,
  )
    .bind(
      typeof senderHostname === "string" && senderHostname !== ""
        ? `https://${senderHostname}/favicon.ico`
        : null,
      feed.id,
    )
    .run();

  const feedEntryPublicId = generatePublicId();
  const feedEntryResult = await env.DB.prepare(
    `insert into "feedEntries" (
       "publicId",
       "feed",
       "createdAt",
       "author",
       "title",
       "content"
     )
     values (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      feedEntryPublicId,
      feed.id,
      new Date().toISOString(),
      senderAddress,
      email.subject?.trim() || "Untitled",
      content,
    )
    .run();

  await linkEnclosures(env, feedEntryResult.meta.last_row_id, enclosures);
  await pruneFeedEntries(env, feed.id);
  console.info("Email accepted", {
    from: message.from,
    to: message.to,
    feedPublicId,
    feedEntryPublicId,
    attachmentCount: enclosures.length,
    rawSize: message.rawSize,
  });
  ctx.waitUntil(
    dispatchWebSubForFeedEntry({
      env,
      hostname,
      feedId: feed.id,
      feedEntryId: feedEntryResult.meta.last_row_id,
    }),
  );
}

async function cleanup(env: Env): Promise<void> {
  const orphanEnclosures = (
    await env.DB.prepare(
      `select
         "feedEntryEnclosures"."id" as "id",
         "feedEntryEnclosures"."publicId" as "publicId",
         "feedEntryEnclosures"."name" as "name"
       from "feedEntryEnclosures"
       left join "feedEntryEnclosureLinks" on
         "feedEntryEnclosureLinks"."feedEntryEnclosure" = "feedEntryEnclosures"."id"
       where "feedEntryEnclosureLinks"."id" is null`,
    ).all<{ id: number; publicId: string; name: string }>()
  ).results;

  for (const enclosure of orphanEnclosures) {
    await env.FILES.delete(fileKey(enclosure.publicId, enclosure.name));
    await env.DB.prepare(`delete from "feedEntryEnclosures" where "id" = ?`)
      .bind(enclosure.id)
      .run();
  }

  await env.DB.batch([
    env.DB.prepare(
      `delete from "feedVisualizations" where "createdAt" < ?`,
    ).bind(new Date(Date.now() - ONE_HOUR_MS).toISOString()),
    env.DB.prepare(
      `delete from "feedWebSubSubscriptions" where "createdAt" < ?`,
    ).bind(new Date(Date.now() - ONE_DAY_MS).toISOString()),
  ]);
}

export default {
  fetch: fetchHandler,
  email: receiveEmail,
  scheduled: (
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) => {
    ctx.waitUntil(cleanup(env));
  },
} as unknown as ExportedHandler<Env>;
