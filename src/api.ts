import type { CatalogData, ModuleType } from "./types";

const apiBase = (import.meta.env.VITE_CATALOG_API_URL || "").replace(/\/$/, "");

export class CatalogApi {
  private token = "";

  get configured() {
    return Boolean(apiBase);
  }

  get authenticated() {
    return Boolean(this.token);
  }

  async authenticate(initData: string) {
    if (!apiBase || !initData) return false;
    const response = await fetch(`${apiBase}/v1/auth/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ init_data: initData }),
    });
    if (!response.ok) return false;
    const result = await response.json() as { token: string };
    this.token = result.token;
    return true;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...options.headers,
      },
    });
    if (!response.ok) {
      const raw = await response.text();
      try { throw new Error((JSON.parse(raw) as { error?: string }).error || `HTTP ${response.status}`); }
      catch (error) { if (error instanceof SyntaxError) throw new Error(raw || `HTTP ${response.status}`); throw error; }
    }
    return response.json() as Promise<T>;
  }

  async catalog(): Promise<CatalogData> {
    if (apiBase) {
      try { return await this.request<CatalogData>("/v1/catalog"); } catch { /* static fallback */ }
    }
    const response = await fetch(`${import.meta.env.BASE_URL}catalog.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<CatalogData>;
  }

  favorites() {
    return this.request<{ ids: string[] }>("/v1/favorites");
  }

  setFavorite(entityType: "story" | "module", id: string, active: boolean) {
    return this.request<{ active: boolean; likes: number }>(`/v1/favorites/${entityType}/${id}`, {
      method: active ? "PUT" : "DELETE",
    });
  }

  createImport(input: { title: string; setting_id: string; plot_id: string; character_ids: string[] }) {
    return this.request<{ import_id: string }>("/v1/import-requests", {
      method: "POST", body: JSON.stringify(input),
    });
  }

  async uploadImage(file: File) {
    const variants = await prepareImageVariants(file);
    const body = new FormData();
    body.append("thumbnail", variants.thumbnail, "thumbnail.webp");
    body.append("detail", variants.detail, "detail.webp");
    const response = await fetch(`${apiBase}/v1/uploads`, {
      method: "POST",
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
      body,
    });
    if (!response.ok) {
      const raw = await response.text();
      try { throw new Error((JSON.parse(raw) as { error?: string }).error || `HTTP ${response.status}`); }
      catch (error) { if (error instanceof SyntaxError) throw new Error(raw || `HTTP ${response.status}`); throw error; }
    }
    return response.json() as Promise<{ image: { thumbnail: string; detail: string } }>;
  }

  createSubmission(input: {
    kind: "story" | "module";
    module_type?: ModuleType;
    title: string;
    summary: string;
    description: string;
    author_mode: "telegram" | "pseudonym" | "anonymous";
    pseudonym?: string;
    image?: { thumbnail: string; detail: string };
    setting_id?: string;
    plot_id?: string;
    character_ids?: string[];
    opening_scene?: string;
  }) {
    return this.request<{ id: string; status: "pending" }>("/v1/submissions", {
      method: "POST", body: JSON.stringify(input),
    });
  }
}

async function imageBlob(file: File, maxWidth: number, quality: number) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Не удалось подготовить изображение")),
    "image/webp", quality,
  ));
}

export async function prepareImageVariants(file: File) {
  if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
    throw new Error("Нужен файл JPEG, PNG или WebP размером до 8 МБ");
  }
  return {
    thumbnail: await imageBlob(file, 480, 0.8),
    detail: await imageBlob(file, 1120, 0.85),
  };
}

export const api = new CatalogApi();
