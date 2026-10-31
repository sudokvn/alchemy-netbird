import { CredentialsStoreLive } from "alchemy/Auth/Credentials";
import { ProfileStoreLive } from "alchemy/Auth/Profile";
import * as Provider from "alchemy/Provider";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { NetBirdAuth } from "./AuthProvider.ts";
import { fromAuthProvider } from "./Credentials.ts";
import { Policy, PolicyProvider } from "./Policy.ts";

export class Providers extends Provider.ProviderCollection<Providers>()("NetBird") {}

/**
 * The Policy provider with the NetBird login: `NETBIRD_API_TOKEN` and `NETBIRD_API_URL` when set,
 * otherwise the selected Alchemy profile. The credentials and the HTTP client stay in the stack's
 * context because the engine runs lifecycle operations there.
 */
export const providers = () =>
  Layer.effect(Providers, Provider.collection([Policy])).pipe(
    Layer.provide(PolicyProvider()),
    Layer.provideMerge(fromAuthProvider()),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(NetBirdAuth),
    Layer.provideMerge(ProfileStoreLive),
    Layer.provideMerge(CredentialsStoreLive),
    Layer.orDie,
  );
