import {
  Credentials,
  DEFAULT_API_BASE_URL,
  normalizeApiBaseUrl,
} from "@distilled.cloud/netbird/credentials";
import {
  deferUntilFirstUse,
  orDieCredentialsUnavailable,
  resolveProviderConfig,
} from "alchemy/Auth/Resolve";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  NETBIRD_AUTH_PROVIDER_NAME,
  type NetBirdAuthConfig,
  type NetBirdResolvedCredentials,
} from "./AuthProvider.ts";

export {
  Credentials,
  CredentialsFromEnv,
  fromApiToken,
} from "@distilled.cloud/netbird/credentials";

/**
 * The SDK's `Credentials` from the Alchemy login: `NETBIRD_API_TOKEN` and `NETBIRD_API_URL` when
 * set, otherwise the selected profile. Resolved on first use, so building the layer never needs a
 * configured login.
 */
export const fromAuthProvider = () =>
  Layer.effect(
    Credentials,
    Effect.gen(function* () {
      const resolve = yield* resolveProviderConfig<NetBirdAuthConfig, NetBirdResolvedCredentials>(
        NETBIRD_AUTH_PROVIDER_NAME,
      ).pipe(
        Effect.flatMap(({ resolve }) => resolve),
        Effect.flatMap(({ apiToken, apiUrl }) =>
          Effect.map(normalizeApiBaseUrl(apiUrl ?? DEFAULT_API_BASE_URL), (apiBaseUrl) => ({
            apiToken,
            apiBaseUrl,
          })),
        ),
        deferUntilFirstUse,
      );
      return yield* resolve.pipe(
        orDieCredentialsUnavailable(NETBIRD_AUTH_PROVIDER_NAME),
        Effect.cached,
      );
    }),
  );
