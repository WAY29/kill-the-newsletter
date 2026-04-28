create table "feeds" (
  "id" integer primary key autoincrement,
  "publicId" text not null unique,
  "title" text not null,
  "emailIcon" text null,
  "icon" text null
);

create index "index_feeds_publicId" on "feeds" ("publicId");

create table "feedEntries" (
  "id" integer primary key autoincrement,
  "publicId" text not null unique,
  "feed" integer not null references "feeds" ("id") on delete cascade,
  "createdAt" text not null,
  "author" text null,
  "title" text not null,
  "content" text not null
);

create index "index_feedEntries_publicId" on "feedEntries" ("publicId");
create index "index_feedEntries_feed" on "feedEntries" ("feed");

create table "feedVisualizations" (
  "id" integer primary key autoincrement,
  "feed" integer not null references "feeds" ("id") on delete cascade,
  "createdAt" text not null
);

create index "index_feedVisualizations_feed" on "feedVisualizations" ("feed");
create index "index_feedVisualizations_createdAt" on "feedVisualizations" ("createdAt");

create table "feedWebSubSubscriptions" (
  "id" integer primary key autoincrement,
  "feed" integer not null references "feeds" ("id") on delete cascade,
  "createdAt" text not null,
  "callback" text not null,
  "secret" text null,
  unique ("feed", "callback")
);

create index "index_feedWebSubSubscriptions_feed" on "feedWebSubSubscriptions" ("feed");
create index "index_feedWebSubSubscriptions_createdAt" on "feedWebSubSubscriptions" ("createdAt");
create index "index_feedWebSubSubscriptions_callback" on "feedWebSubSubscriptions" ("callback");

create table "feedEntryEnclosures" (
  "id" integer primary key autoincrement,
  "publicId" text not null unique,
  "type" text not null,
  "length" integer not null,
  "name" text not null
);

create table "feedEntryEnclosureLinks" (
  "id" integer primary key autoincrement,
  "feedEntry" integer not null references "feedEntries" ("id") on delete cascade,
  "feedEntryEnclosure" integer not null references "feedEntryEnclosures" ("id") on delete cascade
);

create index "index_feedEntryEnclosureLinks_feedEntry" on "feedEntryEnclosureLinks" ("feedEntry");
create index "index_feedEntryEnclosureLinks_feedEntryEnclosure" on "feedEntryEnclosureLinks" ("feedEntryEnclosure");
