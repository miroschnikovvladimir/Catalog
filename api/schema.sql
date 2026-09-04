PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  username TEXT,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('setting', 'plot', 'character')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT NOT NULL,
  image_json TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  seed_json TEXT NOT NULL,
  author_json TEXT NOT NULL,
  owner_telegram_id INTEGER REFERENCES users(telegram_id),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'pending', 'published', 'rejected')),
  created_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  cover_json TEXT,
  categories_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  author_json TEXT NOT NULL,
  owner_telegram_id INTEGER REFERENCES users(telegram_id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'pending', 'published', 'rejected')),
  created_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS story_modules (
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE RESTRICT,
  slot TEXT NOT NULL CHECK (slot IN ('setting', 'plot', 'character')),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (story_id, module_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  telegram_id INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('story', 'module')),
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (telegram_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS import_requests (
  id TEXT PRIMARY KEY,
  telegram_id INTEGER NOT NULL REFERENCES users(telegram_id),
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  telegram_id INTEGER NOT NULL REFERENCES users(telegram_id),
  thumbnail_key TEXT NOT NULL,
  detail_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  telegram_id INTEGER NOT NULL REFERENCES users(telegram_id),
  kind TEXT NOT NULL CHECK (kind IN ('story', 'module')),
  content_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  moderator_note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS moderation_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  moderator_telegram_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_modules_status_type ON modules(status, type);
CREATE INDEX IF NOT EXISTS idx_stories_status_sort ON stories(status, sort_order);
CREATE INDEX IF NOT EXISTS idx_story_modules_story_slot ON story_modules(story_id, slot, position);
CREATE INDEX IF NOT EXISTS idx_favorites_entity ON favorites(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status_created ON submissions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_import_requests_user ON import_requests(telegram_id, expires_at);
