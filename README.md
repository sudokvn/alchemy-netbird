# alchemy-netbird

Manage [NetBird](https://netbird.io) access policies as code with [Alchemy](https://alchemy.run).

> [!WARNING]
> Early. Nothing is published to npm, and the API can still change. Tagged releases
> can be [installed as tarballs](docs/RELEASING.md#install-a-release).

| Package                                                      | Contents                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [`@alchemy.run/netbird`](packages/alchemy-netbird/README.md) | Alchemy resource for NetBird access policies                                    |
| [`@distilled.cloud/netbird`](packages/netbird/README.md)     | Effect client for the NetBird API, generated from NetBird's OpenAPI description |

## Example

```ts
import * as NetBird from "@alchemy.run/netbird";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "netbird",
  { providers: NetBird.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    yield* NetBird.Policy("admins-servers", {
      name: "admins -> servers (SSH)",
      from: { groups: ["admins"] },
      to: { groups: ["servers"] },
      protocol: "tcp",
      ports: [22],
    });
    return {};
  }),
);
```

With `NETBIRD_API_TOKEN` set, `alchemy deploy` looks up the IDs of the groups `admins` and
`servers` and creates the policy in NetBird Cloud. A policy of that name that already exists needs
`--adopt` and is taken over only if its access matches.

## Development

Requires Node 24 and pnpm 12.15.0.

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

`pnpm test` runs offline. `pnpm test:server` runs the provider's lifecycle tests against a
throwaway NetBird server in Podman; see [docs/TESTING.md](docs/TESTING.md).
[docs/DESIGN.md](docs/DESIGN.md) explains how both packages are built.

## License

Apache-2.0. See [NOTICE](NOTICE) for the origin of the NetBird API description.
