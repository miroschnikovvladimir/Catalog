export interface TelegramUser {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
}

const encoder = new TextEncoder();

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64url(value: ArrayBuffer | string) {
  const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function decodeBase64url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}

async function hmac(key: ArrayBuffer | string, value: string) {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

export async function validateTelegramInitData(initData: string, botToken: string, maxAgeSeconds = 3600) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash") || "";
  params.delete("hash");
  params.delete("signature");
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = await hmac("WebAppData", botToken);
  const calculatedHash = bytesToHex(await hmac(secret, dataCheckString));
  if (!receivedHash || !safeEqual(calculatedHash, receivedHash)) throw new Error("invalid signature");
  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate > now + 30 || now - authDate > maxAgeSeconds) throw new Error("expired init data");
  const rawUser = params.get("user");
  if (!rawUser) throw new Error("missing user");
  const user = JSON.parse(rawUser) as TelegramUser;
  if (!Number.isSafeInteger(user.id) || !user.first_name) throw new Error("invalid user");
  return user;
}

export async function issueSession(telegramId: number, secret: string, lifetimeSeconds = 3600) {
  const payload = JSON.stringify({ sub: telegramId, exp: Math.floor(Date.now() / 1000) + lifetimeSeconds });
  return `${base64url(payload)}.${base64url(await hmac(secret, payload))}`;
}

export async function verifySession(token: string, secret: string) {
  const [rawPayload, rawSignature] = token.split(".");
  if (!rawPayload || !rawSignature) throw new Error("invalid session");
  const payload = decodeBase64url(rawPayload);
  const expected = base64url(await hmac(secret, payload));
  if (!safeEqual(expected, rawSignature)) throw new Error("invalid session");
  const parsed = JSON.parse(payload) as { sub: number; exp: number };
  if (!Number.isSafeInteger(parsed.sub) || parsed.exp < Math.floor(Date.now() / 1000)) throw new Error("expired session");
  return parsed.sub;
}
