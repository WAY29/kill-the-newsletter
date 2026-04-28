import assert from "node:assert/strict";
import test from "node:test";
import {
  configuredEmailHostname,
  configuredWebHostname,
  parseFeedAddress,
  renderFeed,
  sanitizeFilename,
  textToHTML,
} from "./worker.mjs";

test("parseFeedAddress accepts only local recipients for the configured hostname", () => {
  assert.equal(
    parseFeedAddress("abc123@example.com", "example.com", "production"),
    "abc123",
  );
  assert.equal(
    parseFeedAddress("abc123@other.example", "example.com", "production"),
    undefined,
  );
  assert.equal(
    parseFeedAddress("bad+tag@example.com", "example.com", "production"),
    undefined,
  );
});

test("split hostnames use the web hostname for URLs and the email hostname for recipients", () => {
  const env = {
    WEB_HOSTNAME: "newsletter.example.com",
    EMAIL_HOSTNAME: "example.com",
  };

  assert.equal(
    configuredWebHostname(env, "fallback.example"),
    "newsletter.example.com",
  );
  assert.equal(configuredEmailHostname(env), "example.com");
  assert.equal(
    parseFeedAddress(
      "abc123@example.com",
      configuredEmailHostname(env),
      "production",
    ),
    "abc123",
  );
  assert.equal(
    parseFeedAddress(
      "abc123@newsletter.example.com",
      configuredEmailHostname(env),
      "production",
    ),
    undefined,
  );
});

test("sanitizeFilename keeps portable attachment names", () => {
  assert.equal(sanitizeFilename("report 2026/04?.pdf"), "report-2026-04-.pdf");
  assert.equal(sanitizeFilename(undefined), "untitled");
});

test("textToHTML escapes text fallback content", () => {
  assert.equal(
    textToHTML("Hello <World>\n\nNext & final"),
    "<p>Hello &lt;World&gt;</p><p>Next &amp; final</p>",
  );
});

test("renderFeed emits escaped Atom entries and enclosures", () => {
  const feed = renderFeed({
    hostname: "example.com",
    feed: {
      id: 1,
      publicId: "feed123",
      title: "News & Updates",
      icon: null,
      emailIcon: null,
    },
    feedEntries: [
      {
        id: 10,
        publicId: "entry123",
        createdAt: "2026-04-28T00:00:00.000Z",
        author: "sender@example.com",
        title: "Hello <reader>",
        content: "<p>Body</p>",
      },
    ],
    enclosuresByFeedEntry: new Map([
      [
        10,
        [
          {
            publicId: "file123",
            type: "application/pdf",
            length: 123,
            name: "report.pdf",
          },
        ],
      ],
    ]),
  });

  assert.match(feed, /<title>News &amp; Updates<\/title>/);
  assert.match(feed, /<title>Hello &lt;reader&gt;<\/title>/);
  assert.match(
    feed,
    /href="https:\/\/example\.com\/files\/file123\/report\.pdf"/,
  );
});
