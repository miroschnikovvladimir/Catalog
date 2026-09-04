(() => {
  const telegram = window.Telegram?.WebApp;
  telegram?.ready();
  telegram?.expand();

  const elements = {
    catalog: document.querySelector("#catalog-view"),
    detail: document.querySelector("#detail-view"),
    search: document.querySelector("#search-input"),
    categoryFilters: document.querySelector("#category-filters"),
    tagFilters: document.querySelector("#tag-filters"),
    status: document.querySelector("#catalog-status"),
    cards: document.querySelector("#cards"),
  };
  const state = { items: [], query: "", category: "", tag: "", likes: new Set() };
  const likesKey = "storyteller-catalog-likes";

  try {
    const storedLikes = JSON.parse(localStorage.getItem(likesKey) || "[]");
    if (Array.isArray(storedLikes)) state.likes = new Set(storedLikes.filter((id) => typeof id === "string"));
  } catch (error) {
    console.warn("Не удалось прочитать лайки каталога", error);
  }

  const textForSearch = (item) => [
    item.title,
    item.summary,
    ...(item.categories || []),
    ...(item.tags || []),
  ].join(" ").toLocaleLowerCase("ru");

  const categoryKey = (item) => (item.categories || []).join("/");
  const saveLikes = () => {
    try {
      localStorage.setItem(likesKey, JSON.stringify([...state.likes]));
    } catch (error) {
      console.warn("Не удалось сохранить лайки каталога", error);
    }
  };
  const setStatus = (text, error = false) => {
    elements.status.textContent = text;
    elements.status.classList.toggle("is-error", error);
  };

  const createFilter = (label, active, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter${active ? " is-active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  };

  const renderFilters = () => {
    const categories = [...new Set(state.items.map(categoryKey).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
    const tags = [...new Set(state.items.flatMap((item) => item.tags || []))].sort((a, b) => a.localeCompare(b, "ru"));
    elements.categoryFilters.replaceChildren(
      createFilter("Все", !state.category, () => { state.category = ""; render(); }),
      ...categories.map((category) => createFilter(category.replaceAll("/", " / "), state.category === category, () => {
        state.category = category;
        render();
      })),
    );
    elements.tagFilters.replaceChildren(
      createFilter("Все", !state.tag, () => { state.tag = ""; render(); }),
      ...tags.map((tag) => createFilter(tag, state.tag === tag, () => { state.tag = tag; render(); })),
    );
  };

  const openDetail = (item) => {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "back";
    back.textContent = "← К каталогу";
    back.addEventListener("click", () => {
      elements.detail.hidden = true;
      elements.catalog.hidden = false;
      window.scrollTo(0, 0);
    });
    const image = document.createElement("img");
    image.className = "detail-cover";
    image.src = item.cover;
    image.alt = `Обложка истории «${item.title}»`;
    const breadcrumbs = document.createElement("p");
    breadcrumbs.className = "breadcrumbs";
    breadcrumbs.textContent = (item.categories || []).join(" / ") || "История";
    const title = document.createElement("h2");
    title.textContent = item.title;
    const summary = document.createElement("p");
    summary.className = "detail-summary";
    summary.textContent = item.summary;
    const chips = document.createElement("div");
    chips.className = "chips";
    (item.tags || []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = tag;
      chips.append(chip);
    });
    const actionBar = document.createElement("div");
    actionBar.className = "detail-actions";

    const likeButton = document.createElement("button");
    likeButton.type = "button";
    likeButton.className = `like-action${state.likes.has(item.id) ? " is-liked" : ""}`;
    likeButton.textContent = state.likes.has(item.id) ? "♥ Нравится" : "♡ Лайк";
    likeButton.setAttribute("aria-pressed", state.likes.has(item.id) ? "true" : "false");
    likeButton.addEventListener("click", () => {
      if (state.likes.has(item.id)) {
        state.likes.delete(item.id);
      } else {
        state.likes.add(item.id);
      }
      saveLikes();
      openDetail(item);
    });

    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className = "detail-action";
    const canImport = typeof telegram?.sendData === "function";
    importButton.textContent = canImport ? "Выбрать для игры" : "Открой в Telegram";
    importButton.disabled = !canImport;
    importButton.addEventListener("click", () => {
      try {
        telegram.sendData(JSON.stringify({ action: "import", story_id: item.id }));
      } catch (error) {
        console.error("Не удалось передать выбранную историю боту", error);
        importButton.textContent = "Не удалось передать выбор — попробуй ещё раз";
      }
    });
    actionBar.append(likeButton, importButton);
    elements.detail.replaceChildren(back, image, breadcrumbs, title, summary, chips, actionBar);
    elements.catalog.hidden = true;
    elements.detail.hidden = false;
    window.scrollTo(0, 0);
  };

  const createCard = (item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    const image = document.createElement("img");
    image.className = "cover";
    image.src = item.cover;
    image.alt = `Обложка истории «${item.title}»`;
    image.addEventListener("error", () => { image.remove(); });
    const copy = document.createElement("div");
    copy.className = "card-copy";
    const title = document.createElement("h3");
    title.textContent = item.title;
    copy.append(title);
    card.append(image, copy);
    card.addEventListener("click", () => openDetail(item));
    return card;
  };

  const filteredItems = () => state.items.filter((item) => {
    const queryMatches = !state.query || textForSearch(item).includes(state.query);
    const categoryMatches = !state.category || categoryKey(item) === state.category;
    const tagMatches = !state.tag || (item.tags || []).includes(state.tag);
    return queryMatches && categoryMatches && tagMatches;
  });

  const render = () => {
    renderFilters();
    const items = filteredItems();
    elements.cards.replaceChildren(...items.map(createCard));
    setStatus(items.length ? "" : "Ничего не найдено. Попробуй изменить поиск или фильтры.");
  };

  const loadCatalog = async () => {
    try {
      const response = await fetch("./catalog.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.items)) throw new Error("В catalog.json нет массива items");
      state.items = payload.items.filter((item) => (
        item && typeof item.id === "string" && typeof item.title === "string"
        && typeof item.summary === "string" && typeof item.cover === "string"
      ));
      render();
    } catch (error) {
      console.error("Не удалось загрузить каталог", error);
      elements.cards.replaceChildren();
      setStatus("Не удалось загрузить каталог. Обнови страницу или попробуй позже.", true);
    }
  };

  elements.search.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLocaleLowerCase("ru");
    render();
  });
  loadCatalog();
})();
