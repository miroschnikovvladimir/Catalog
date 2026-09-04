import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { validateTelegramInitData, issueSession, verifySession } from "./auth";

type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
  BOT_TOKEN: string;
  SESSION_SECRET: string;
  BOT_API_TOKEN: string;
  ADMIN_TOKEN: string;
  SUPERADMIN_ID: string;
  ALLOWED_ORIGINS: string;
};
type Variables = { telegramId: number };
type AppEnv = { Bindings: Bindings; Variables: Variables };

const app = new Hono<AppEnv>();
const now = () => new Date().toISOString();
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: string | null | undefined, fallback: T): T => {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};

app.use("*", async (c, next) => {
  const origin = c.req.header("origin") || "";
  const allowed = c.env.ALLOWED_ORIGINS.split(",").map((item) => item.trim());
  if (origin && allowed.includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Headers", "authorization,content-type,x-admin-token");
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  }
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await next();
});

const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
  try {
    c.set("telegramId", await verifySession(token, c.env.SESSION_SECRET));
    await next();
  } catch {
    return c.json({ error: "Открой каталог заново внутри Telegram" }, 401);
  }
};

function requireService(c: { req: { header(name: string): string | undefined }; env: Bindings }) {
  return (c.req.header("authorization") || "") === `Bearer ${c.env.BOT_API_TOKEN}`;
}

function requireAdmin(c: { req: { header(name: string): string | undefined }; env: Bindings }) {
  return (c.req.header("x-admin-token") || "") === c.env.ADMIN_TOKEN;
}

app.get("/v1/health", (c) => c.json({ ok: true, service: "storyteller-catalog-api" }));

app.post("/v1/auth/telegram", async (c) => {
  const body = await c.req.json<{ init_data?: string }>();
  try {
    const user = await validateTelegramInitData(body.init_data || "", c.env.BOT_TOKEN);
    const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ");
    const timestamp = now();
    await c.env.DB.prepare(
      `INSERT INTO users (telegram_id, username, display_name, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username,
       display_name=excluded.display_name, last_seen_at=excluded.last_seen_at`,
    ).bind(user.id, user.username || null, displayName, timestamp, timestamp).run();
    return c.json({ token: await issueSession(user.id, c.env.SESSION_SECRET), user: { display_name: displayName } });
  } catch {
    return c.json({ error: "Не удалось подтвердить Telegram-профиль" }, 401);
  }
});

type ModuleRow = {
  id: string; type: "setting" | "plot" | "character"; title: string; summary: string;
  description: string; image_json: string | null; tags_json: string; author_json: string; likes: number;
};
type StoryRow = {
  id: string; title: string; summary: string; cover_json: string | null; categories_json: string;
  tags_json: string; author_json: string; sort_order: number; likes: number;
};

app.get("/v1/catalog", async (c) => {
  const [moduleResult, storyResult, linkResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT m.id,m.type,m.title,m.summary,m.description,m.image_json,m.tags_json,m.author_json,
       COUNT(f.entity_id) AS likes FROM modules m LEFT JOIN favorites f
       ON f.entity_type='module' AND f.entity_id=m.id WHERE m.status='published' GROUP BY m.id`,
    ).all<ModuleRow>(),
    c.env.DB.prepare(
      `SELECT s.id,s.title,s.summary,s.cover_json,s.categories_json,s.tags_json,s.author_json,s.sort_order,
       COUNT(f.entity_id) AS likes FROM stories s LEFT JOIN favorites f
       ON f.entity_type='story' AND f.entity_id=s.id WHERE s.status='published' GROUP BY s.id ORDER BY s.sort_order,s.title`,
    ).all<StoryRow>(),
    c.env.DB.prepare("SELECT story_id,module_id,slot,position FROM story_modules ORDER BY position").all<{ story_id: string; module_id: string; slot: string; position: number }>(),
  ]);
  if (!storyResult.results.length) return c.json({ error: "catalog is not seeded" }, 404);
  const links = linkResult.results;
  const modules = moduleResult.results.map((row) => ({
    id: row.id, type: row.type, title: row.title, summary: row.summary, description: row.description,
    image: parse(row.image_json, null), tags: parse(row.tags_json, []), author: parse(row.author_json, { mode: "anonymous", name: "Аноним" }), likes: row.likes,
  }));
  const stories = storyResult.results.map((row) => {
    const ownLinks = links.filter((link) => link.story_id === row.id);
    return {
      id: row.id, title: row.title, summary: row.summary, cover: parse(row.cover_json, null),
      categories: parse(row.categories_json, []), tags: parse(row.tags_json, []), author: parse(row.author_json, { mode: "anonymous", name: "Аноним" }),
      sort_order: row.sort_order, likes: row.likes,
      setting_id: ownLinks.find((link) => link.slot === "setting")?.module_id || "",
      plot_id: ownLinks.find((link) => link.slot === "plot")?.module_id || "",
      character_ids: ownLinks.filter((link) => link.slot === "character").map((link) => link.module_id),
    };
  });
  return c.json({ version: 2, stories, modules });
});

app.get("/v1/favorites", requireUser, async (c) => {
  const result = await c.env.DB.prepare("SELECT entity_id FROM favorites WHERE telegram_id=? ORDER BY created_at DESC").bind(c.get("telegramId")).all<{ entity_id: string }>();
  return c.json({ ids: result.results.map((row) => row.entity_id) });
});

app.put("/v1/favorites/:type/:id", requireUser, async (c) => {
  const type = c.req.param("type");
  if (type !== "story" && type !== "module") return c.json({ error: "Некорректный тип" }, 400);
  const id = c.req.param("id");
  const table = type === "story" ? "stories" : "modules";
  const exists = await c.env.DB.prepare(`SELECT id FROM ${table} WHERE id=? AND status='published'`).bind(id).first();
  if (!exists) return c.json({ error: "Объект не найден" }, 404);
  await c.env.DB.prepare("INSERT OR IGNORE INTO favorites (telegram_id,entity_type,entity_id,created_at) VALUES (?,?,?,?)").bind(c.get("telegramId"), type, id, now()).run();
  const count = await c.env.DB.prepare("SELECT COUNT(*) count FROM favorites WHERE entity_type=? AND entity_id=?").bind(type, id).first<{ count: number }>();
  return c.json({ active: true, likes: count?.count || 0 });
});

app.delete("/v1/favorites/:type/:id", requireUser, async (c) => {
  const type = c.req.param("type");
  if (type !== "story" && type !== "module") return c.json({ error: "Некорректный тип" }, 400);
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM favorites WHERE telegram_id=? AND entity_type=? AND entity_id=?").bind(c.get("telegramId"), type, id).run();
  const count = await c.env.DB.prepare("SELECT COUNT(*) count FROM favorites WHERE entity_type=? AND entity_id=?").bind(type, id).first<{ count: number }>();
  return c.json({ active: false, likes: count?.count || 0 });
});

const importSchema = z.object({
  title: z.string().trim().min(1).max(100),
  setting_id: z.string().min(1),
  plot_id: z.string().min(1),
  character_ids: z.array(z.string().min(1)).min(1).max(20),
}).refine((value) => new Set(value.character_ids).size === value.character_ids.length, "Персонажи не должны повторяться");

app.post("/v1/import-requests", requireUser, async (c) => {
  const input = importSchema.safeParse(await c.req.json());
  if (!input.success) return c.json({ error: "Выбери сеттинг, сюжет и персонажей" }, 400);
  const telegramId = c.get("telegramId");
  const ids = [input.data.setting_id, input.data.plot_id, ...input.data.character_ids];
  const placeholders = ids.map(() => "?").join(",");
  const result = await c.env.DB.prepare(
    `SELECT m.id,m.type,m.title,m.summary,m.seed_json FROM modules m JOIN favorites f
     ON f.entity_type='module' AND f.entity_id=m.id AND f.telegram_id=?
     WHERE m.status='published' AND m.id IN (${placeholders})`,
  ).bind(telegramId, ...ids).all<{ id: string; type: string; title: string; summary: string; seed_json: string }>();
  if (result.results.length !== new Set(ids).size) return c.json({ error: "Все части должны быть сохранены" }, 400);
  const map = new Map(result.results.map((row) => [row.id, row]));
  if (map.get(input.data.setting_id)?.type !== "setting" || map.get(input.data.plot_id)?.type !== "plot" || input.data.character_ids.some((id) => map.get(id)?.type !== "character")) {
    return c.json({ error: "Типы частей не совпадают" }, 400);
  }
  const moduleData = (id: string) => { const row = map.get(id)!; return { id: row.id, title: row.title, summary: row.summary, seed: parse(row.seed_json, {}) }; };
  const payload = {
    schema_version: 2, title: input.data.title,
    setting: moduleData(input.data.setting_id), plot: moduleData(input.data.plot_id),
    characters: input.data.character_ids.map(moduleData),
  };
  const importId = crypto.randomUUID();
  const created = new Date();
  const expires = new Date(created.getTime() + 24 * 60 * 60 * 1000);
  await c.env.DB.prepare("INSERT INTO import_requests (id,telegram_id,title,payload_json,created_at,expires_at) VALUES (?,?,?,?,?,?)")
    .bind(importId, telegramId, input.data.title, json(payload), created.toISOString(), expires.toISOString()).run();
  return c.json({ import_id: importId }, 201);
});

app.get("/v1/import-requests/:id", async (c) => {
  if (!requireService(c)) return c.json({ error: "unauthorized" }, 401);
  const telegramId = Number(c.req.query("telegram_id"));
  const row = await c.env.DB.prepare("SELECT payload_json,expires_at,completed_at FROM import_requests WHERE id=? AND telegram_id=?")
    .bind(c.req.param("id"), telegramId).first<{ payload_json: string; expires_at: string; completed_at: string | null }>();
  if (!row || row.completed_at || row.expires_at < now()) return c.json({ error: "Импорт недоступен" }, 404);
  return c.json(parse(row.payload_json, {}));
});

app.post("/v1/import-requests/:id/complete", async (c) => {
  if (!requireService(c)) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{ telegram_id?: number }>();
  await c.env.DB.prepare("UPDATE import_requests SET completed_at=? WHERE id=? AND telegram_id=? AND completed_at IS NULL")
    .bind(now(), c.req.param("id"), body.telegram_id).run();
  return c.json({ ok: true });
});

app.post("/v1/uploads", requireUser, async (c) => {
  const recent = await c.env.DB.prepare("SELECT COUNT(*) count FROM uploads WHERE telegram_id=? AND created_at>=?")
    .bind(c.get("telegramId"), hoursAgo(24)).first<{ count: number }>();
  if ((recent?.count || 0) >= 10) return c.json({ error: "Лимит — 10 изображений за 24 часа" }, 429);
  const form = await c.req.formData();
  const thumbnail = form.get("thumbnail");
  const detail = form.get("detail");
  if (!(thumbnail instanceof File) || !(detail instanceof File)) return c.json({ error: "Нужны два варианта изображения" }, 400);
  if (thumbnail.type !== "image/webp" || detail.type !== "image/webp" || thumbnail.size > 300_000 || detail.size > 1_200_000) {
    return c.json({ error: "Изображение не прошло ограничения размера" }, 400);
  }
  const id = crypto.randomUUID();
  const thumbnailKey = `uploads/${c.get("telegramId")}/${id}-480.webp`;
  const detailKey = `uploads/${c.get("telegramId")}/${id}-1120.webp`;
  await Promise.all([
    c.env.IMAGES.put(thumbnailKey, thumbnail.stream(), { httpMetadata: { contentType: "image/webp", cacheControl: "public,max-age=31536000,immutable" } }),
    c.env.IMAGES.put(detailKey, detail.stream(), { httpMetadata: { contentType: "image/webp", cacheControl: "public,max-age=31536000,immutable" } }),
  ]);
  await c.env.DB.prepare("INSERT INTO uploads (id,telegram_id,thumbnail_key,detail_key,created_at) VALUES (?,?,?,?,?)")
    .bind(id, c.get("telegramId"), thumbnailKey, detailKey, now()).run();
  const origin = new URL(c.req.url).origin;
  return c.json({ image: { thumbnail: `${origin}/v1/images/${encodeURIComponent(thumbnailKey)}`, detail: `${origin}/v1/images/${encodeURIComponent(detailKey)}` } }, 201);
});

app.get("/v1/images/:key{.+}", async (c) => {
  const object = await c.env.IMAGES.get(decodeURIComponent(c.req.param("key")));
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public,max-age=31536000,immutable");
  return new Response(object.body, { headers });
});

const submissionSchema = z.object({
  kind: z.enum(["story", "module"]), module_type: z.enum(["setting", "plot", "character"]).optional(),
  title: z.string().trim().min(1).max(100), summary: z.string().trim().min(1).max(400),
  description: z.string().trim().min(1).max(10_000), author_mode: z.enum(["telegram", "pseudonym", "anonymous"]),
  pseudonym: z.string().trim().min(1).max(60).optional(), image: z.object({ thumbnail: z.string().url(), detail: z.string().url() }).optional(),
  setting_id: z.string().min(1).optional(), plot_id: z.string().min(1).optional(), character_ids: z.array(z.string().min(1)).min(1).max(20).optional(), opening_scene: z.string().max(2000).optional(),
})
  .refine((value) => value.author_mode !== "pseudonym" || Boolean(value.pseudonym), "Нужен псевдоним")
  .refine((value) => value.kind !== "story" || Boolean(value.setting_id && value.plot_id && value.character_ids?.length), "Нужен состав истории")
  .refine((value) => !value.character_ids || new Set(value.character_ids).size === value.character_ids.length, "Персонажи не должны повторяться");

function imageKey(url: string) {
  try {
    const path = new URL(url).pathname;
    return path.startsWith("/v1/images/") ? decodeURIComponent(path.slice("/v1/images/".length)) : "";
  } catch { return ""; }
}

app.post("/v1/submissions", requireUser, async (c) => {
  const input = submissionSchema.safeParse(await c.req.json());
  if (!input.success || (input.data.kind === "module" && !input.data.module_type)) return c.json({ error: "Проверь обязательные поля" }, 400);
  const telegramId = c.get("telegramId");
  const recent = await c.env.DB.prepare("SELECT COUNT(*) count FROM submissions WHERE telegram_id=? AND created_at>=?")
    .bind(telegramId, hoursAgo(24)).first<{ count: number }>();
  if ((recent?.count || 0) >= 5) return c.json({ error: "Лимит — 5 материалов за 24 часа" }, 429);
  if (input.data.image) {
    const thumbnailKey = imageKey(input.data.image.thumbnail);
    const detailKey = imageKey(input.data.image.detail);
    const owned = await c.env.DB.prepare("SELECT id FROM uploads WHERE telegram_id=? AND thumbnail_key=? AND detail_key=?")
      .bind(telegramId, thumbnailKey, detailKey).first();
    if (!thumbnailKey || !detailKey || !owned) return c.json({ error: "Изображение не принадлежит отправителю" }, 400);
  }
  if (input.data.kind === "story") {
    const ids = [input.data.setting_id!, input.data.plot_id!, ...input.data.character_ids!];
    const placeholders = ids.map(() => "?").join(",");
    const available = await c.env.DB.prepare(
      `SELECT m.id,m.type FROM modules m JOIN favorites f ON f.entity_type='module' AND f.entity_id=m.id AND f.telegram_id=?
       WHERE m.status='published' AND m.id IN (${placeholders})`,
    ).bind(telegramId, ...ids).all<{ id: string; type: string }>();
    const types = new Map(available.results.map((row) => [row.id, row.type]));
    if (available.results.length !== new Set(ids).size || types.get(input.data.setting_id!) !== "setting" ||
      types.get(input.data.plot_id!) !== "plot" || input.data.character_ids!.some((id) => types.get(id) !== "character")) {
      return c.json({ error: "Историю можно собрать только из сохранённых опубликованных частей" }, 400);
    }
  }
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO submissions (id,telegram_id,kind,content_json,status,created_at) VALUES (?,?,?,?,?,?)")
    .bind(id, telegramId, input.data.kind, json(input.data), "pending", now()).run();
  return c.json({ id, status: "pending" }, 201);
});

app.get("/v1/admin/submissions", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const result = await c.env.DB.prepare("SELECT s.*,u.username,u.display_name FROM submissions s JOIN users u ON u.telegram_id=s.telegram_id WHERE s.status='pending' ORDER BY s.created_at").all();
  return c.json({ submissions: result.results });
});

app.post("/v1/admin/submissions/:id/:action", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const action = c.req.param("action");
  if (action !== "approve" && action !== "reject") return c.json({ error: "unknown action" }, 400);
  const body = await c.req.json<{ note?: string; moderator_telegram_id?: number }>();
  const row = await c.env.DB.prepare("SELECT * FROM submissions WHERE id=? AND status='pending'").bind(c.req.param("id")).first<{ id: string; telegram_id: number; kind: string; content_json: string }>();
  if (!row) return c.json({ error: "submission not found" }, 404);
  const content = parse<Record<string, unknown>>(row.content_json, {});
  const authorMode = String(content.author_mode);
  const user = await c.env.DB.prepare("SELECT username,display_name FROM users WHERE telegram_id=?").bind(row.telegram_id).first<{ username: string | null; display_name: string }>();
  const authorName = authorMode === "anonymous" ? "Аноним" : authorMode === "pseudonym" ? String(content.pseudonym) : user?.username ? `@${user.username}` : user?.display_name || "Автор";
  const publishStatements: D1PreparedStatement[] = [];
  if (action === "approve" && row.kind === "module") {
    const moduleType = String(content.module_type);
    const seed = moduleType === "setting"
      ? { world: content.description }
      : moduleType === "plot"
        ? { plot: content.description, opening_scene: content.opening_scene || content.summary }
        : { description: content.description };
    publishStatements.push(c.env.DB.prepare(
      "INSERT INTO modules (id,type,title,summary,description,image_json,tags_json,seed_json,author_json,owner_telegram_id,status,created_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(crypto.randomUUID(), moduleType, content.title, content.summary, content.description, json(content.image || null), "[]", json(seed), json({ mode: authorMode, name: authorName }), row.telegram_id, "published", now(), now()));
  }
  if (action === "approve" && row.kind === "story") {
    const storyId = crypto.randomUUID();
    const settingId = String(content.setting_id);
    const plotId = String(content.plot_id);
    const characterIds = Array.isArray(content.character_ids) ? content.character_ids.map(String) : [];
    const moduleIds = [settingId, plotId, ...characterIds];
    const placeholders = moduleIds.map(() => "?").join(",");
    const available = await c.env.DB.prepare(`SELECT id FROM modules WHERE status='published' AND id IN (${placeholders})`).bind(...moduleIds).all<{ id: string }>();
    if (available.results.length !== new Set(moduleIds).size) return c.json({ error: "В истории есть недоступные модули" }, 409);
    const storyStatements: D1PreparedStatement[] = [
      c.env.DB.prepare("INSERT INTO stories (id,title,summary,cover_json,categories_json,tags_json,author_json,owner_telegram_id,status,created_at,published_at) VALUES (?,?,?,?,?,?,?,?,'published',?,?)")
        .bind(storyId, content.title, content.summary, json(content.image || null), "[]", "[]", json({ mode: authorMode, name: authorName }), row.telegram_id, now(), now()),
      c.env.DB.prepare("INSERT INTO story_modules (story_id,module_id,slot,position) VALUES (?,?,?,0)").bind(storyId, settingId, "setting"),
      c.env.DB.prepare("INSERT INTO story_modules (story_id,module_id,slot,position) VALUES (?,?,?,0)").bind(storyId, plotId, "plot"),
      ...characterIds.map((characterId, index) => c.env.DB.prepare("INSERT INTO story_modules (story_id,module_id,slot,position) VALUES (?,?,?,?)").bind(storyId, characterId, "character", index)),
    ];
    publishStatements.push(...storyStatements);
  }
  const status = action === "approve" ? "approved" : "rejected";
  const moderatorId = body.moderator_telegram_id || Number(c.env.SUPERADMIN_ID);
  await c.env.DB.batch([
    ...publishStatements,
    c.env.DB.prepare("UPDATE submissions SET status=?,moderator_note=?,decided_at=? WHERE id=?").bind(status, body.note || null, now(), row.id),
    c.env.DB.prepare("INSERT INTO moderation_events (id,submission_id,moderator_telegram_id,action,note,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), row.id, moderatorId, status, body.note || null, now()),
  ]);
  return c.json({ id: row.id, status });
});

app.post("/v1/admin/catalog", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{ stories?: Array<Record<string, unknown>>; modules?: Array<Record<string, unknown>> }>();
  if (!Array.isArray(body.stories) || !Array.isArray(body.modules)) return c.json({ error: "invalid catalog" }, 400);
  const timestamp = now();
  const statements: D1PreparedStatement[] = [];
  for (const module of body.modules) {
    statements.push(c.env.DB.prepare(
      `INSERT INTO modules (id,type,title,summary,description,image_json,tags_json,seed_json,author_json,status,created_at,published_at)
       VALUES (?,?,?,?,?,?,?,?,?,'published',?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,title=excluded.title,
       summary=excluded.summary,description=excluded.description,image_json=excluded.image_json,tags_json=excluded.tags_json,
       seed_json=excluded.seed_json,author_json=excluded.author_json,status='published',published_at=excluded.published_at`,
    ).bind(module.id, module.type, module.title, module.summary, module.description, json(module.image || null), json(module.tags || []), json(module.seed || {}), json(module.author || { mode: "curated", name: "Команда Сорассказчика" }), timestamp, timestamp));
  }
  for (const story of body.stories) {
    statements.push(c.env.DB.prepare(
      `INSERT INTO stories (id,title,summary,cover_json,categories_json,tags_json,author_json,sort_order,status,created_at,published_at)
       VALUES (?,?,?,?,?,?,?,?,'published',?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,summary=excluded.summary,
       cover_json=excluded.cover_json,categories_json=excluded.categories_json,tags_json=excluded.tags_json,
       author_json=excluded.author_json,sort_order=excluded.sort_order,status='published',published_at=excluded.published_at`,
    ).bind(story.id, story.title, story.summary, json(story.cover || null), json(story.categories || []), json(story.tags || []), json(story.author || {}), story.sort_order || 0, timestamp, timestamp));
    statements.push(c.env.DB.prepare("DELETE FROM story_modules WHERE story_id=?").bind(story.id));
    statements.push(c.env.DB.prepare("INSERT INTO story_modules (story_id,module_id,slot,position) VALUES (?,?,?,0)").bind(story.id, story.setting_id, "setting"));
    statements.push(c.env.DB.prepare("INSERT INTO story_modules (story_id,module_id,slot,position) VALUES (?,?,?,0)").bind(story.id, story.plot_id, "plot"));
    for (const [index, characterId] of ((story.character_ids as string[]) || []).entries()) statements.push(c.env.DB.prepare("INSERT INTO story_modules (story_id,module_id,slot,position) VALUES (?,?,?,?)").bind(story.id, characterId, "character", index));
  }
  if (statements.length) await c.env.DB.batch(statements);
  return c.json({ ok: true, stories: body.stories.length, modules: body.modules.length });
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "Внутренняя ошибка каталога" }, 500);
});

export default app;
