// Drives the real Alchemy plan and apply against the throwaway test server, with in-memory state.
import type * as Sdk from "@distilled.cloud/netbird";
import { fromApiToken } from "@distilled.cloud/netbird/credentials";
import * as Provider from "alchemy/Provider";
import * as State from "alchemy/State";
import * as Core from "alchemy/Test/Core";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { inject } from "vitest";
import * as NetBird from "../../src/index.ts";
import "./context.ts";

/** Direct API calls, standing in for someone using the NetBird dashboard. */
export async function dashboard<A>(method: string, path: string, body?: unknown): Promise<A> {
  const { url, token } = inject("netbird");
  const response = await fetch(`${url}/api${path}`, {
    method,
    headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status}: ${await response.text()}`);
  return (await response.json()) as A;
}

export const policies = () => dashboard<(Sdk.Policy & { id: string })[]>("GET", "/policies");
export const policyNamed = async (name: string) => {
  const matches = (await policies()).filter((policy) => policy.name === name);
  if (matches.length !== 1) throw new Error(`${matches.length} policies named ${name}`);
  return matches[0]!;
};
export const idOf = async (kind: "groups" | "peers", name: string) => {
  const items = await dashboard<{ id: string; name: string }[]>("GET", `/${kind}`);
  const item = items.find((candidate) => candidate.name === name);
  if (item === undefined) throw new Error(`no ${kind} ${name}`);
  return item.id;
};

export async function deleteAllPolicies() {
  for (const policy of await policies()) await dashboard("DELETE", `/policies/${policy.id}`);
}

/**
 * The Policy provider with the test server's credentials and an HTTP client that records every
 * write as `<method> <path>`, so tests can prove that a deploy wrote nothing.
 */
function recordingProviders(writes: string[]) {
  const { url, token } = inject("netbird");
  const recordingHttp = Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return HttpClient.tapRequest(client, (request) =>
        Effect.sync(() => {
          if (request.method !== "GET")
            writes.push(`${request.method} ${new URL(request.url).pathname}`);
        }),
      );
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
  return Layer.effect(NetBird.Providers, Provider.collection([NetBird.Policy])).pipe(
    Layer.provide(NetBird.PolicyProvider()),
    Layer.provideMerge(fromApiToken({ apiToken: Redacted.make(token), apiBaseUrl: url })),
    Layer.provideMerge(recordingHttp),
  );
}

/** The package's own `providers()`, logged in through `NETBIRD_API_TOKEN` and `NETBIRD_API_URL`. */
function loginProviders() {
  const { url, token } = inject("netbird");
  return NetBird.providers().pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({ env: { NETBIRD_API_URL: url, NETBIRD_API_TOKEN: token } }),
      ),
    ),
  );
}

export function harness({ login = false } = {}) {
  const writes: string[] = [];
  const options = {
    providers: login ? loginProviders() : recordingProviders(writes),
    state: Layer.succeed(State.State, State.InMemoryService({})),
    stage: "test",
  };
  const scratch = Core.scratchStack(options, "netbird");
  const run = <A>(effect: Effect.Effect<A, unknown>, adopt: boolean) =>
    Effect.runPromiseExit(Core.toEffect(effect, { ...options, adopt }));
  const succeed = async <A>(effect: Effect.Effect<A, unknown>, adopt = false) => {
    const exit = await run(effect, adopt);
    if (Exit.isFailure(exit)) throw new Error(`Expected success, got ${String(exit.cause)}`);
    return exit.value;
  };
  return {
    writes,
    deploy: <A, E>(program: Effect.Effect<A, E, NetBird.Providers>, adopt = false) =>
      succeed(scratch.deploy(program), adopt),
    /** Resolves to the failure, so tests can inspect it. */
    deployFailure: async <A, E>(program: Effect.Effect<A, E, NetBird.Providers>, adopt = false) => {
      const exit = await run(scratch.deploy(program), adopt);
      if (Exit.isSuccess(exit)) throw new Error("Expected the deploy to fail");
      return String(exit.cause);
    },
    plan: <A, E>(program: Effect.Effect<A, E, NetBird.Providers>, adopt = false) =>
      succeed(scratch.plan(program), adopt),
    planFailure: async <A, E>(program: Effect.Effect<A, E, NetBird.Providers>, adopt = false) => {
      const exit = await run(scratch.plan(program), adopt);
      if (Exit.isSuccess(exit)) throw new Error("Expected the plan to fail");
      return String(exit.cause);
    },
    destroy: () => succeed(scratch.destroy()),
    /** The attributes Alchemy persisted, by logical ID. */
    attributes: () =>
      succeed(
        Effect.gen(function* () {
          const state = yield* yield* State.State;
          const fqns = yield* state.list({ stack: scratch.name, stage: scratch.stage });
          const rows = yield* Effect.forEach(fqns, (fqn) =>
            state.get({ stack: scratch.name, stage: scratch.stage, fqn }),
          );
          return Object.fromEntries(
            rows.flatMap((row) =>
              row === undefined || !("attr" in row) ? [] : [[row.logicalId, row.attr]],
            ),
          );
        }).pipe(Effect.provide(scratch.state)),
      ),
  };
}
