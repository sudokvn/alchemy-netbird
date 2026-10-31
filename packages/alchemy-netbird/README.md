# @alchemy.run/netbird

Alchemy resources for [NetBird](https://netbird.io), built on the
[`@distilled.cloud/netbird`](../netbird/README.md) SDK.

> [!WARNING]
> Not published to npm, and the API can still change. The repository README explains how to
> install a release.

`NetBird.Policy` manages one access policy with one rule. Its source and destination are groups
or single peers, referenced by name. Groups, peers, networks and every other NetBird setting stay
as they are: the provider only reads them to look up IDs.

Requires `alchemy` 2.0.0-beta.84, Effect 4.0.5 and Node 24. Tested with self-hosted NetBird
0.82.0; read-only plans also ran against NetBird Cloud.

## Example

```ts
import * as Alchemy from "alchemy";
import * as NetBird from "@alchemy.run/netbird";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
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
    // Never deleted by Alchemy, even when removed from the stack.
    yield* NetBird.Policy("workstations", {
      name: "laptop <-> desktop",
      from: { peer: "laptop" },
      to: { peer: "desktop" },
      protocol: "all",
      bidirectional: true,
    }).pipe(RemovalPolicy.retain());
    return {};
  }),
);
```

## Authentication

The provider uses a NetBird access token from environment variables or from an Alchemy profile.
When `NETBIRD_API_TOKEN` is set, the variables take precedence over the profile.

| Variable            | Required | Value                                                                       |
| ------------------- | -------- | --------------------------------------------------------------------------- |
| `NETBIRD_API_TOKEN` | Yes      | Access token of a service user with the `Network Admin` role or higher      |
| `NETBIRD_API_URL`   | No       | Management server origin. Default: `https://api.netbird.io` (NetBird Cloud) |

The variables are read through Effect `Config`, so a stack's `secrets` can supply them. The token
is resolved on first use and never written to state, logs or errors. `NETBIRD_API_URL` must be
an HTTPS origin without a path, such as `https://netbird.example.com`. Plain HTTP is accepted
only for `127.0.0.1`, `localhost` and `[::1]`.

To store the token in a profile instead, set `NETBIRD_API_TOKEN`, then run this from the directory
that contains your `alchemy.run.ts`:

```sh
pnpm exec alchemy profile create netbird
pnpm exec alchemy profile edit --profile netbird --add NetBird --method stored \
  --set apiToken=env:NETBIRD_API_TOKEN
```

The `env:` reference reads the token from the variable, so it never appears in the command. For
a self-hosted server, add `--set apiUrl=https://netbird.example.com`. Afterwards, unset the
variable and pass `--profile netbird` to `pnpm exec alchemy plan` and `deploy`.

A `Network Admin` can change groups, policies, routes and DNS of the whole account but can only
read peers. NetBird has no narrower role for policies.

One stack manages one account. Do not point an existing stack at another account: its state
holds policy IDs of the first one.

## Policy properties

| Property        | Default | Meaning                                                                                        |
| --------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `name`          |         | Name in NetBird, also used for the rule. Keep it unique: a policy without state is found by it |
| `description`   | `""`    | Policy description                                                                             |
| `enabled`       | `true`  | Policy switch                                                                                  |
| `from`, `to`    |         | `{ groups: ["a", "b"] }` or `{ peer: "name" }`                                                 |
| `bidirectional` | `false` | Whether `to` may also open connections to `from`                                               |
| `protocol`      |         | `"tcp"`, `"udp"`, `"icmp"` or `"all"`                                                          |
| `ports`         | all     | TCP and UDP only, for example `[22, 443]`                                                      |

Attributes contain `policyId` and the policy as NetBird reports it, with groups and peers by
name.

Every deploy looks up group and peer IDs by name and fails before writing anything if a name is
missing or shared by several groups or peers. NetBird itself accepts unknown IDs and silently
drops them, so the provider also checks every write against what NetBird stored.

## Changes, adoption and deletion

- **Changes** are always made in place. A policy keeps its ID when anything changes, including
  its name. A plan compares the declaration with Alchemy's state, not with NetBird; `alchemy
  drift` shows changes made in the dashboard.
- **Adoption:** NetBird policies carry no ownership marker, and NetBird allows duplicate names.
  A policy that exists without state therefore needs `--adopt`. Adoption refuses a policy whose
  access differs from the declaration: it may rename the rule and change descriptions, but
  never `enabled`, `from`, `to`, `bidirectional`, `protocol` or `ports`. `plan --adopt` already
  fails for such a policy. Make the declaration match NetBird first.
- **Unsupported settings:** the provider refuses to change a policy that has posture checks,
  several rules, a disabled rule, port ranges, a `drop` action, SSH user mappings or a network
  resource as an endpoint, because writing it would drop those settings.
- **Deletion:** a policy removed from the stack is deleted in NetBird. Alchemy creates new
  policies before it deletes removed ones, so a replacement exists before the old policy goes.
  To keep a policy when it leaves the stack, pipe it through `RemovalPolicy.retain()`.
- **Renaming a logical ID** creates a new policy and deletes the old one. Use `renamedFrom` from
  `alchemy/Rename` to move the state instead.

`alchemy unsafe nuke` never deletes NetBird policies: without an ownership marker, the provider
cannot tell which policies are Alchemy's, so it lists none.

[docs/DESIGN.md](../../docs/DESIGN.md) explains these decisions, and
[docs/TESTING.md](../../docs/TESTING.md) describes the tests.
