import { describe, expect, it } from "vitest";
import { issueSession, validateTelegramInitData, verifySession } from "./auth";

const encoder = new TextEncoder();

async function sign(key: ArrayBuffer | string, value: string) {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encoder.encode(value));
}

function hex(value: ArrayBuffer) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function initData(botToken: string) {
  const values = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "test-query",
    user: JSON.stringify({ id: 42, first_name: "Тест", username: "tester" }),
  });
  const check = [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = await sign("WebAppData", botToken);
  values.set("hash", hex(await sign(secret, check)));
  return values.toString();
}

describe("Telegram authentication", () => {
  it("validates signed initData", async () => {
    const data = await initData("123456:test-token");
    await expect(validateTelegramInitData(data, "123456:test-token")).resolves.toMatchObject({ id: 42, username: "tester" });
  });

  it("rejects a signature made for another bot", async () => {
    const data = await initData("123456:other-token");
    await expect(validateTelegramInitData(data, "123456:test-token")).rejects.toThrow("invalid signature");
  });

  it("issues and verifies a short session", async () => {
    const token = await issueSession(42, "session-secret");
    await expect(verifySession(token, "session-secret")).resolves.toBe(42);
    await expect(verifySession(token, "wrong-secret")).rejects.toThrow("invalid session");
  });

  it("rejects an expired session", async () => {
    const token = await issueSession(42, "session-secret", -1);
    await expect(verifySession(token, "session-secret")).rejects.toThrow("expired session");
  });
});
