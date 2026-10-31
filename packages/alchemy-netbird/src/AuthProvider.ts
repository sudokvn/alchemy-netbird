import { getEnv, getEnvRedactedRequired } from "alchemy/Auth/Env";
import {
  makeStoredAuthProvider,
  storedSecret,
  storedValueText,
  type StoredAuthConfig,
} from "alchemy/Auth/StoredAuthProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

export const NETBIRD_AUTH_PROVIDER_NAME = "NetBird";
export type NetBirdAuthConfig = StoredAuthConfig;
export interface NetBirdResolvedCredentials {
  readonly type: "token";
  readonly apiToken: Redacted.Redacted<string>;
  /** Management server origin; NetBird Cloud when undefined. */
  readonly apiUrl: string | undefined;
  readonly source: { readonly type: NetBirdAuthConfig["method"] | "env" };
}

const auth = makeStoredAuthProvider<NetBirdResolvedCredentials>({
  provider: NETBIRD_AUTH_PROVIDER_NAME,
  fields: [
    { name: "apiToken", label: "NetBird personal access token", secret: true },
    { name: "apiUrl", label: "Management server origin (empty for NetBird Cloud)", optional: true },
  ],
  toResolved: (values) => ({
    type: "token",
    apiToken: storedSecret(values.apiToken) ?? Redacted.make(""),
    apiUrl: storedValueText(values.apiUrl) || undefined,
    source: { type: "stored" },
  }),
  readEnvironment: Effect.all({
    apiToken: getEnvRedactedRequired("NETBIRD_API_TOKEN"),
    apiUrl: getEnv("NETBIRD_API_URL"),
  }).pipe(
    Effect.map((config) => ({
      ...config,
      type: "token" as const,
      source: { type: "env" as const },
    })),
  ),
  environment: [
    { name: "NETBIRD_API_TOKEN", required: true, secret: true },
    { name: "NETBIRD_API_URL", required: false },
  ],
});

/** Registers the NetBird login for `alchemy profile` and for environment variables in CI. */
export const NetBirdAuth = auth.layer;
