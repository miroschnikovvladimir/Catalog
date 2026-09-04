export type ModuleType = "setting" | "plot" | "character";

export interface CatalogImage {
  thumbnail: string;
  detail: string;
  width: number;
  height: number;
  alt: string;
}

export interface Author {
  mode: "curated" | "telegram" | "pseudonym" | "anonymous";
  name: string;
}

export interface StoryModule {
  id: string;
  type: ModuleType;
  title: string;
  summary: string;
  description: string;
  image: CatalogImage | null;
  tags: string[];
  author: Author;
  likes?: number;
}

export interface Story {
  id: string;
  title: string;
  summary: string;
  cover: CatalogImage;
  categories: string[];
  tags: string[];
  sort_order: number;
  author: Author;
  setting_id: string;
  plot_id: string;
  character_ids: string[];
  likes?: number;
}

export interface CatalogData {
  version: number;
  stories: Story[];
  modules: StoryModule[];
}

export interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  sendData(data: string): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}
