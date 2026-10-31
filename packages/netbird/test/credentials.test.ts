// The hand-written credentials: where the token and the server address come from.
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";
import { Credentials, CredentialsFromEnv, normalizeApiBaseUrl } from "../src/credentials.ts";

const fromEnv = (env: Record<string, string>) =>
  Effect.runPromiseExit(
    Effect.flatMap(Credentials, (resolve) => resolve).pipe(
      Effect.map(({ apiToken, apiBaseUrl }) => ({ token: Redacted.value(apiToken), apiBaseUrl })),
      Effect.provide(CredentialsFromEnv),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env })),
    ),
  );

describe("CredentialsFromEnv", () => {
  it("defaults to NetBird Cloud", async () => {
    expect(await fromEnv({ NETBIRD_API_TOKEN: "nbp_test" })).toEqual(
      Exit.succeed({ token: "nbp_test", apiBaseUrl: "https://api.netbird.io" }),
    );
  });

  it("uses NETBIRD_API_URL for a self-hosted server", async () => {
    expect(
      await fromEnv({
        NETBIRD_API_TOKEN: "nbp_test",
        NETBIRD_API_URL: "https://netbird.example.com/",
      }),
    ).toEqual(Exit.succeed({ token: "nbp_test", apiBaseUrl: "https://netbird.example.com" }));
  });

  it("fails without a token", async () => {
    expect(Exit.isFailure(await fromEnv({}))).toBe(true);
  });
});

describe("normalizeApiBaseUrl", () => {
  it.each(["http://127.0.0.1:8080", "http://localhost:8080", "https://netbird.example.com:8443"])(
    "accepts %s",
    async (url) => {
      expect(Exit.isSuccess(await Effect.runPromiseExit(normalizeApiBaseUrl(url)))).toBe(true);
    },
  );

  it.each([
    "http://netbird.example.com",
    "https://netbird.example.com/api",
    "https://user:secret@netbird.example.com",
    "not a url",
  ])("rejects %s", async (url) => {
    expect(Exit.isFailure(await Effect.runPromiseExit(normalizeApiBaseUrl(url)))).toBe(true);
  });
});
