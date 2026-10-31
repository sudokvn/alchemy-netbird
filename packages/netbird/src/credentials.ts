/**
 * NetBird credentials -- hand-written.
 *
 * The `Credentials` service holds an effect that resolves the credentials on every request; the
 * protocol sends the token as `Authorization: Token <token>`. The token is a personal access
 * token, normally of a service user (Team > Service Users in the dashboard).
 *
 * NetBird Cloud is the default. A self-hosted management server is reached at its own origin.
 * Operation paths already start with `/api`, so the base URL is an origin without a path.
 */
import * as EffectConfig from "@distilled.cloud/core/config";
import { ConfigError } from "@distilled.cloud/core/errors";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";

/** NetBird Cloud's management API. */
export const DEFAULT_API_BASE_URL = "https://api.netbird.io";

export interface Config {
  /** Personal access token, sent as `Authorization: Token <token>`. */
  readonly apiToken: Redacted.Redacted<string>;
  /** Origin of the management server, such as `https://api.netbird.io`. */
  readonly apiBaseUrl: string;
}

export class Credentials
  extends /*@__PURE__*/ Context.Service<Credentials, Effect.Effect<Config, ConfigError>>()(
    "NetBirdCredentials",
  ) {}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Checks a management server address and returns its origin. It must be HTTPS and have no path,
 * query or user info. Plain HTTP is accepted on the loopback interface only, for local servers.
 */
export function normalizeApiBaseUrl(value: string): Effect.Effect<string, ConfigError> {
  const invalid = (reason: string) =>
    Effect.fail(new ConfigError({ message: `NetBird API base URL ${reason}` }));
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid("is not a URL");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    return invalid("must be an origin such as https://api.netbird.io, without a path");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname)))
    return invalid("must use HTTPS");
  return Effect.succeed(url.origin);
}

/** Credentials from a token and an optional management server origin. */
export const fromApiToken = (config: {
  readonly apiToken: Redacted.Redacted<string>;
  readonly apiBaseUrl?: string;
}): Layer.Layer<Credentials> =>
  Layer.succeed(
    Credentials,
    Effect.map(normalizeApiBaseUrl(config.apiBaseUrl ?? DEFAULT_API_BASE_URL), (apiBaseUrl) => ({
      apiToken: config.apiToken,
      apiBaseUrl,
    })),
  );

const envConfig = /*@__PURE__*/ EffectConfig.all({
  apiToken: /*@__PURE__*/ EffectConfig.Redacted("NETBIRD_API_TOKEN"),
  apiBaseUrl: /*@__PURE__*/ EffectConfig.String("NETBIRD_API_URL").pipe(
    /*@__PURE__*/ EffectConfig.withDefault(DEFAULT_API_BASE_URL),
  ),
});

/** Reads `NETBIRD_API_TOKEN` (required) and `NETBIRD_API_URL` (default NetBird Cloud). */
export const CredentialsFromEnv: Layer.Layer<Credentials> = /*@__PURE__*/ Layer.succeed(
  Credentials,
  /*@__PURE__*/ envConfig.pipe(
    /*@__PURE__*/ Effect.mapError(
      () => new ConfigError({ message: "NETBIRD_API_TOKEN environment variable is required" }),
    ),
    /*@__PURE__*/ Effect.flatMap(({ apiToken, apiBaseUrl }) =>
      Effect.map(normalizeApiBaseUrl(apiBaseUrl), (origin) => ({ apiToken, apiBaseUrl: origin })),
    ),
  ),
);
