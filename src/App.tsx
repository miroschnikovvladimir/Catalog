import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { CatalogData, CatalogImage, ModuleType, Story, StoryModule } from "./types";

type Route =
  | { page: "catalog" }
  | { page: "story"; id: string }
  | { page: "module"; id: string }
  | { page: "favorites" }
  | { page: "builder" }
  | { page: "submit" };

const EMPTY: CatalogData = { version: 2, stories: [], modules: [] };
const FAVORITES_KEY = "storyteller-catalog-favorites-v2";
const typeLabels: Record<ModuleType, string> = {
  setting: "Сеттинг",
  plot: "Сюжет",
  character: "Персонаж",
};

function routeFromHash(): Route {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "stories" && parts[1]) return { page: "story", id: parts[1] };
  if (parts[0] === "modules" && parts[1]) return { page: "module", id: parts[1] };
  if (parts[0] === "favorites") return { page: "favorites" };
  if (parts[0] === "builder") return { page: "builder" };
  if (parts[0] === "submit") return { page: "submit" };
  return { page: "catalog" };
}

function useRoute() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  useEffect(() => {
    const change = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return route;
}

function loadLocalFavorites() {
  try {
    const values = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set<string>(Array.isArray(values) ? values.filter((value) => typeof value === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function CatalogPicture({ image, className, priority = false }: { image: CatalogImage | null; className: string; priority?: boolean }) {
  if (!image) return <div className={`${className} image-placeholder`} aria-hidden="true" />;
  return (
    <img
      className={className}
      src={image.thumbnail}
      srcSet={`${image.thumbnail} 480w, ${image.detail} 1120w`}
      sizes={className.includes("cover-card") ? "(min-width: 800px) 230px, 46vw" : "(min-width: 800px) 640px, 100vw"}
      width={image.width}
      height={image.height}
      alt={image.alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
    />
  );
}

function Heart({ id, active, count, toggle, disabled }: {
  id: string; active: boolean; count?: number; toggle: (id: string) => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`heart ${active ? "is-active" : ""}`}
      aria-label={active ? "Убрать из сохранённых" : "Сохранить"}
      aria-pressed={active}
      disabled={disabled}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggle(id); }}
    >
      <span aria-hidden="true">{active ? "♥" : "♡"}</span>{typeof count === "number" && <small>{count}</small>}
    </button>
  );
}

function ModuleDialog({ module, close, favorite, toggle }: {
  module: StoryModule; close: () => void; favorite: boolean; toggle: (id: string) => void;
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [close]);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <article className={`dialog ${module.image ? "" : "without-image"}`} role="dialog" aria-modal="true" aria-labelledby="module-dialog-title">
        <button className="dialog-close" type="button" onClick={close} aria-label="Закрыть">×</button>
        {module.image && <CatalogPicture image={module.image} className="dialog-image" />}
        <div className="dialog-copy">
          <p className="eyebrow">{typeLabels[module.type]}</p>
          <h2 id="module-dialog-title">{module.title}</h2>
          <p className="long-copy">{module.description}</p>
          <div className="dialog-footer">
            <span className="author">{module.author.name}</span>
            <Heart id={module.id} active={favorite} count={module.likes} toggle={toggle} />
          </div>
        </div>
      </article>
    </div>
  );
}

function ModuleCard({ module, favorite, toggle, open }: {
  module: StoryModule; favorite: boolean; toggle: (id: string) => void; open: (module: StoryModule) => void;
}) {
  return (
    <article className="module-card">
      <button type="button" className={`module-open ${module.image ? "" : "without-image"}`} onClick={() => open(module)}>
        {module.image && <CatalogPicture image={module.image} className="module-image" />}
        <span className="module-copy">
          <span className="eyebrow">{typeLabels[module.type]}</span>
          <strong>{module.title}</strong>
          <span>{module.summary}</span>
        </span>
      </button>
      <Heart id={module.id} active={favorite} count={module.likes} toggle={toggle} />
    </article>
  );
}

function StoryDetail({ story, data, favorites, toggle }: {
  story: Story; data: CatalogData; favorites: Set<string>; toggle: (id: string) => void;
}) {
  const modules = new Map(data.modules.map((module) => [module.id, module]));
  const setting = modules.get(story.setting_id);
  const plot = modules.get(story.plot_id);
  const characters = story.character_ids.map((id) => modules.get(id)).filter(Boolean) as StoryModule[];
  const [opened, setOpened] = useState<StoryModule | null>(null);
  const telegram = window.Telegram?.WebApp;
  const importStory = () => telegram?.sendData(JSON.stringify({ action: "import", story_id: story.id }));
  return (
    <main className="detail-page">
      <a className="back-link" href="#/">← Каталог</a>
      <section className="story-hero">
        <CatalogPicture image={story.cover} className="story-cover" priority />
        <div className="story-intro">
          <p className="eyebrow">{story.categories.join(" / ") || "История"}</p>
          <h1>{story.title}</h1>
          <p className="story-summary">{story.summary}</p>
          <p className="author">Автор: {story.author.name}</p>
          <div className="chips">{story.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <div className="hero-actions">
            <Heart id={story.id} active={favorites.has(story.id)} count={story.likes} toggle={toggle} />
            <button className="primary-action" type="button" onClick={importStory} disabled={!telegram?.sendData}>
              {telegram?.sendData ? "Играть эту историю" : "Открой в Telegram"}
            </button>
          </div>
        </div>
      </section>
      <section className="story-parts" aria-label="Части истории">
        {setting && <ModuleCard module={setting} favorite={favorites.has(setting.id)} toggle={toggle} open={setOpened} />}
        <div className="section-heading"><p className="eyebrow">Действующие лица</p><h2>Персонажи</h2></div>
        <div className="character-grid">
          {characters.map((character) => <ModuleCard key={character.id} module={character} favorite={favorites.has(character.id)} toggle={toggle} open={setOpened} />)}
        </div>
        {plot && <ModuleCard module={plot} favorite={favorites.has(plot.id)} toggle={toggle} open={setOpened} />}
      </section>
      {opened && <ModuleDialog module={opened} close={() => setOpened(null)} favorite={favorites.has(opened.id)} toggle={toggle} />}
    </main>
  );
}

function CatalogHome({ data, favorites, toggle }: { data: CatalogData; favorites: Set<string>; toggle: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const categories = [...new Set(data.stories.flatMap((story) => story.categories))];
  const stories = data.stories.filter((story) => {
    const haystack = [story.title, story.summary, ...story.tags, ...story.categories].join(" ").toLocaleLowerCase("ru");
    return (!query || haystack.includes(query.toLocaleLowerCase("ru"))) && (!category || story.categories.includes(category));
  });
  return (
    <main className="catalog-page">
      <section className="catalog-tools">
        <div><p className="eyebrow">Сорассказчик</p><h1>Выбери историю</h1></div>
        <label className="search"><span aria-hidden="true">⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название, жанр или тег" /></label>
        <div className="filters">
          <button className={!category ? "active" : ""} onClick={() => setCategory("")}>Все</button>
          {categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
        </div>
      </section>
      <section className="story-grid" aria-live="polite">
        {stories.map((story, index) => (
          <a className="story-card" href={`#/stories/${story.id}`} key={story.id}>
            <div className="cover-wrap">
              <CatalogPicture image={story.cover} className="cover-card" priority={index < 2} />
              <Heart id={story.id} active={favorites.has(story.id)} count={story.likes} toggle={toggle} />
            </div>
            <p>{story.categories[0]}</p><h2>{story.title}</h2><span>{story.summary}</span>
          </a>
        ))}
        {!stories.length && <div className="empty"><h2>Ничего не нашлось</h2><p>Попробуй другой запрос или категорию.</p></div>}
      </section>
    </main>
  );
}

function FavoritesPage({ data, favorites, toggle }: { data: CatalogData; favorites: Set<string>; toggle: (id: string) => void }) {
  const stories = data.stories.filter((story) => favorites.has(story.id));
  const modules = data.modules.filter((module) => favorites.has(module.id));
  const [opened, setOpened] = useState<StoryModule | null>(null);
  return (
    <main className="content-page">
      <p className="eyebrow">Личная коллекция</p><h1>Сохранённое</h1>
      {!stories.length && !modules.length && <div className="empty"><h2>Пока пусто</h2><p>Нажимай на сердце у историй и частей — они появятся здесь.</p></div>}
      {!!stories.length && <><h2>Истории</h2><div className="compact-list">{stories.map((story) => <a href={`#/stories/${story.id}`} key={story.id}><strong>{story.title}</strong><span>{story.summary}</span></a>)}</div></>}
      {!!modules.length && <><h2>Части для конструктора</h2><div className="module-list">{modules.map((module) => <ModuleCard key={module.id} module={module} favorite toggle={toggle} open={setOpened} />)}</div></>}
      {opened && <ModuleDialog module={opened} close={() => setOpened(null)} favorite toggle={toggle} />}
    </main>
  );
}

function BuilderPage({ data, favorites, authenticated }: { data: CatalogData; favorites: Set<string>; authenticated: boolean }) {
  const available = data.modules.filter((module) => favorites.has(module.id));
  const byType = (type: ModuleType) => available.filter((module) => module.type === type);
  const [title, setTitle] = useState("");
  const [setting, setSetting] = useState("");
  const [plot, setPlot] = useState("");
  const [characters, setCharacters] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!setting || !plot || !characters.length) return setStatus("Выбери сеттинг, сюжет и хотя бы одного персонажа.");
    if (!authenticated) return setStatus("Открой каталог внутри Telegram — там сборку можно передать боту.");
    try {
      const result = await api.createImport({ title: title.trim() || "Моя сборка", setting_id: setting, plot_id: plot, character_ids: characters });
      window.Telegram?.WebApp?.sendData(JSON.stringify({ action: "import_request", import_id: result.import_id }));
    } catch (error) { setStatus(error instanceof Error ? error.message : "Не удалось создать сборку"); }
  };
  const select = (label: string, type: ModuleType, value: string, setValue: (value: string) => void) => (
    <label><span>{label}</span><select value={value} onChange={(e) => setValue(e.target.value)}><option value="">Не выбрано</option>{byType(type).map((m) => <option value={m.id} key={m.id}>{m.title}</option>)}</select></label>
  );
  return (
    <main className="content-page narrow"><p className="eyebrow">Новая комбинация</p><h1>Конструктор</h1><p className="lead">Соедини сохранённые части как есть. Героя ты создашь уже в боте.</p>
      <form className="editor-form" onSubmit={create}>
        <label><span>Название</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, Дождь над Багровой гаванью" /></label>
        {select("Сеттинг", "setting", setting, setSetting)}
        {select("Сюжет", "plot", plot, setPlot)}
        <fieldset><legend>Персонажи</legend>{byType("character").map((character) => <label className="check" key={character.id}><input type="checkbox" checked={characters.includes(character.id)} onChange={(e) => setCharacters(e.target.checked ? [...characters, character.id] : characters.filter((id) => id !== character.id))} /><span>{character.title}</span></label>)}</fieldset>
        {!available.length && <p className="form-note">Сначала сохрани несколько частей историй сердцем.</p>}
        {status && <p className="form-status" role="status">{status}</p>}
        <button className="primary-action" type="submit">Собрать и отправить боту</button>
      </form>
    </main>
  );
}

function SubmitPage({ authenticated, data, favorites }: { authenticated: boolean; data: CatalogData; favorites: Set<string> }) {
  const [kind, setKind] = useState<"story" | "module">("module");
  const [moduleType, setModuleType] = useState<ModuleType>("setting");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [openingScene, setOpeningScene] = useState("");
  const [authorMode, setAuthorMode] = useState<"telegram" | "pseudonym" | "anonymous">("telegram");
  const [pseudonym, setPseudonym] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [setting, setSetting] = useState("");
  const [plot, setPlot] = useState("");
  const [characters, setCharacters] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!authenticated) return setStatus("Публикация доступна только внутри Telegram.");
    try {
      setStatus("Подготавливаю материал…");
      const uploaded = image ? await api.uploadImage(image) : undefined;
      if (kind === "story" && (!setting || !plot || !characters.length)) throw new Error("Для истории выбери сеттинг, сюжет и персонажей");
      await api.createSubmission({
        kind, module_type: kind === "module" ? moduleType : undefined, title, summary, description,
        author_mode: authorMode, pseudonym: authorMode === "pseudonym" ? pseudonym : undefined,
        image: uploaded?.image, setting_id: kind === "story" ? setting : undefined,
        plot_id: kind === "story" ? plot : undefined, character_ids: kind === "story" ? characters : undefined,
        opening_scene: kind === "module" && moduleType === "plot" ? openingScene : undefined,
      });
      setStatus("Материал отправлен на ручную модерацию.");
      setTitle(""); setSummary(""); setDescription(""); setOpeningScene(""); setImage(null);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Не удалось отправить материал"); }
  };
  const savedModules = data.modules.filter((module) => favorites.has(module.id));
  const options = (type: ModuleType) => savedModules.filter((module) => module.type === type);
  return (
    <main className="content-page narrow"><p className="eyebrow">UGC</p><h1>Предложить материал</h1><p className="lead">Заполни карточку — после отправки её вручную проверит модератор.</p>
      <form className="editor-form" onSubmit={submit}>
        <label><span>Что публикуем</span><select value={kind} onChange={(e) => setKind(e.target.value as "story" | "module")}><option value="module">Отдельную часть</option><option value="story">Полную историю</option></select></label>
        {kind === "module" && <label><span>Тип части</span><select value={moduleType} onChange={(e) => setModuleType(e.target.value as ModuleType)}><option value="setting">Сеттинг</option><option value="plot">Сюжет</option><option value="character">Персонаж</option></select></label>}
        <label><span>Название</span><input required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label><span>Коротко</span><textarea required maxLength={400} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
        <label><span>Полное описание</span><textarea required maxLength={10000} rows={10} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        {kind === "module" && moduleType === "plot" && <label><span>Первая сцена</span><textarea maxLength={2000} rows={5} value={openingScene} onChange={(e) => setOpeningScene(e.target.value)} placeholder="С чего начинается история после импорта" /></label>}
        {kind === "story" && <fieldset>
          <legend>Состав истории</legend>
          <label><span>Сеттинг</span><select required value={setting} onChange={(e) => setSetting(e.target.value)}><option value="">Не выбран</option>{options("setting").map((module) => <option key={module.id} value={module.id}>{module.title}</option>)}</select></label>
          <label><span>Сюжет</span><select required value={plot} onChange={(e) => setPlot(e.target.value)}><option value="">Не выбран</option>{options("plot").map((module) => <option key={module.id} value={module.id}>{module.title}</option>)}</select></label>
          {options("character").map((module) => <label className="check" key={module.id}><input type="checkbox" checked={characters.includes(module.id)} onChange={(e) => setCharacters(e.target.checked ? [...characters, module.id] : characters.filter((id) => id !== module.id))} /><span>{module.title}</span></label>)}
          {!savedModules.length && <p className="form-note">Сначала сохрани части историй сердцем.</p>}
        </fieldset>}
        <label><span>Авторство</span><select value={authorMode} onChange={(e) => setAuthorMode(e.target.value as typeof authorMode)}><option value="telegram">Публичный Telegram-профиль</option><option value="anonymous">Анонимно</option><option value="pseudonym">Под псевдонимом</option></select></label>
        {authorMode === "pseudonym" && <label><span>Псевдоним</span><input required maxLength={60} value={pseudonym} onChange={(e) => setPseudonym(e.target.value)} /></label>}
        <label><span>Иллюстрация</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setImage(e.target.files?.[0] || null)} /><small>JPEG, PNG или WebP до 8 МБ. Метаданные удалятся при подготовке.</small></label>
        {status && <p className="form-status" role="status">{status}</p>}
        <button className="primary-action" type="submit">Отправить на модерацию</button>
      </form>
    </main>
  );
}

export function App() {
  const route = useRoute();
  const [data, setData] = useState<CatalogData>(EMPTY);
  const [favorites, setFavorites] = useState(loadLocalFavorites);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    (async () => {
      try {
        const telegramData = window.Telegram?.WebApp?.initData || "";
        const authed = await api.authenticate(telegramData);
        if (current) setAuthenticated(authed);
        if (authed) {
          const cloud = await api.favorites();
          if (current) setFavorites(new Set(cloud.ids));
        }
        const catalog = await api.catalog();
        if (current) setData(catalog);
      } catch (caught) {
        if (current) setError(caught instanceof Error ? caught.message : "Не удалось загрузить каталог");
      } finally { if (current) setLoading(false); }
    })();
    return () => { current = false; };
  }, []);

  const entities = useMemo(() => new Map([
    ...data.stories.map((item) => [item.id, "story"] as const),
    ...data.modules.map((item) => [item.id, "module"] as const),
  ]), [data]);
  const toggle = async (id: string) => {
    const next = !favorites.has(id);
    if (api.configured && !authenticated) return;
    setFavorites((previous) => {
      const copy = new Set(previous); next ? copy.add(id) : copy.delete(id);
      if (!api.configured) localStorage.setItem(FAVORITES_KEY, JSON.stringify([...copy]));
      return copy;
    });
    if (authenticated) {
      try { await api.setFavorite(entities.get(id) || "module", id, next); }
      catch { setFavorites((previous) => { const copy = new Set(previous); next ? copy.delete(id) : copy.add(id); return copy; }); }
    }
  };

  const story = route.page === "story" ? data.stories.find((item) => item.id === route.id) : undefined;
  const module = route.page === "module" ? data.modules.find((item) => item.id === route.id) : undefined;
  return (
    <div className="app-shell">
      <header className="topbar"><a className="brand" href="#/">С<span>о</span>рассказчик</a><nav aria-label="Основное меню"><a href="#/favorites">Сохранённое</a><a href="#/builder">Конструктор</a><a href="#/submit">Предложить</a></nav></header>
      {loading && <main className="content-page"><div className="loading-card">Загружаю миры…</div></main>}
      {error && <main className="content-page"><div className="empty"><h1>Каталог не загрузился</h1><p>{error}</p></div></main>}
      {!loading && !error && route.page === "catalog" && <CatalogHome data={data} favorites={favorites} toggle={toggle} />}
      {!loading && story && <StoryDetail story={story} data={data} favorites={favorites} toggle={toggle} />}
      {!loading && module && <main className="content-page"><ModuleDialog module={module} close={() => { window.location.hash = "/"; }} favorite={favorites.has(module.id)} toggle={toggle} /></main>}
      {!loading && route.page === "favorites" && <FavoritesPage data={data} favorites={favorites} toggle={toggle} />}
      {!loading && route.page === "builder" && <BuilderPage data={data} favorites={favorites} authenticated={authenticated} />}
      {!loading && route.page === "submit" && <SubmitPage authenticated={authenticated} data={data} favorites={favorites} />}
      {!loading && ((route.page === "story" && !story) || (route.page === "module" && !module)) && <main className="content-page"><div className="empty"><h1>Такой страницы нет</h1><a href="#/">Вернуться в каталог</a></div></main>}
    </div>
  );
}
