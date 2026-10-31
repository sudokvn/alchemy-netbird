# @distilled.cloud/netbird

Effect-native SDK for the [NetBird](https://netbird.io) management API, generated from NetBird's
[OpenAPI description](https://github.com/netbirdio/netbird/blob/main/shared/management/http/api/openapi.yml)
with the code generator of [distilled](https://github.com/alchemy-run/distilled).

> [!WARNING]
> Not published to npm. The repository README explains how to install a release.

## Quick start

```ts
import * as NetBird from "@distilled.cloud/netbird";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";

const program = Effect.gen(function* () {
  const groups = yield* NetBird.listGroups({});
  const policies = yield* NetBird.listPolicies({});
  return { groups: groups.map((group) => group.name), policies: policies.length };
});

const Live = Layer.mergeAll(
  FetchHttpClient.layer,
  NetBird.CredentialsFromEnv,
  NetBird.NetBirdProtocol,
);

program.pipe(Effect.provide(Live), Effect.runPromise).then(console.log);
```

Every operation of the API is a function on the package root, named after its method and path:
`listPolicies`, `getPolicy`, `createPolicy`, `putPolicy`, `deletePolicy`, `listGroups`,
`listPeers` and 224 more. Request and response types keep NetBird's field names. Failures are
typed: a missing object fails with `NotFound`, a rejected token with `Unauthorized`.

## Auth

| Variable            | Required | Value                                                                       |
| ------------------- | -------- | --------------------------------------------------------------------------- |
| `NETBIRD_API_TOKEN` | Yes      | Personal access token, sent as `Authorization: Token <token>`               |
| `NETBIRD_API_URL`   | No       | Management server origin. Default: `https://api.netbird.io` (NetBird Cloud) |

`fromApiToken({ apiToken, apiBaseUrl })` builds the same credentials from a `Redacted` token.
The base URL must be an HTTPS origin without a path, such as `https://netbird.example.com`.
Plain HTTP is accepted only for `127.0.0.1`, `localhost` and `[::1]`.

Use the token of a service user (Team > Service Users in the dashboard) with the narrowest role
that works: `Network Admin` can change groups, policies, routes and DNS but only read peers.

## Generation

The SDK is generated from one NetBird release, recorded in `specs/source.json`:

```sh
pnpm specs:fetch v0.82.0   # download that release's description into specs/
pnpm generate              # convert, apply patches/, generate src/services/, format
```

`scripts/convert.ts` refuses a `specs/openapi.yml` whose checksum differs from `source.json`.
Generated files are never edited by hand. Where NetBird's description disagrees with what the
server sends, a patch in `patches/` corrects the model, with the evidence in its description:

- `policy-nulls`, `group-nulls`: lists that NetBird sends as `null`.
- `secrets`: tokens and keys that the description does not mark as sensitive. The SDK returns
  them as `Redacted` values.

Responses are not checked against the schema by default. Under `ResponseValidation.strict` from
`@distilled.cloud/core`, these responses decode without errors: the policy, group, peer and
network lists of a NetBird Cloud account, and the policy and group operations of self-hosted
NetBird 0.82.0.
