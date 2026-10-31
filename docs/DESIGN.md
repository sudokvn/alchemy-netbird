# Design

This document explains how the SDK and the provider are built and why. The package READMEs
describe how to use them: [`@distilled.cloud/netbird`](../packages/netbird/README.md) and
[`@alchemy.run/netbird`](../packages/alchemy-netbird/README.md).

The repository follows the layout of `trucke/alchemy-proxmox`: an SDK in distilled's style and an
Alchemy provider that calls only that SDK, as Alchemy's own providers do.

## Toolchain and packaging

Node 24, TypeScript 7, Effect 4.0.5, vitest and pnpm 12.15.0. Dependencies are pinned exactly:
`@distilled.cloud/core` 1.0.0-rc.17 and `alchemy` 2.0.0-beta.84, the versions Alchemy beta.84
itself uses. Inside the repository, both packages export their TypeScript sources; `prepack`
compiles them into `lib/`, and `publishConfig.exports` points the packed packages there.

pnpm refuses tarball sources in dependencies of dependencies, so the provider declares the SDK,
`alchemy` and `effect` as peer dependencies, and a project lists both tarballs. One copy of Alchemy
and Effect in a project keeps the service keys of the provider and the stack identical.

## The SDK

**Source.** NetBird publishes its management API as one OpenAPI 3.1 file in its repository,
`shared/management/http/api/openapi.yml`, under the BSD 3-Clause License. Its `info.version` is
always `0.0.1`, so the SDK is pinned to a NetBird release tag instead. `scripts/fetch-specs.ts`
resolves the tag to a commit, downloads the file at that commit, checks that it is an OpenAPI
document and records the tag, commit and SHA-256 in `specs/source.json`. The file is committed;
`scripts/convert.ts` refuses to run when its checksum differs.

**Generation.** The published `@distilled.cloud/core` contains distilled's OpenAPI converter and
code generator. `scripts/convert.ts` converts the file into a Smithy model and applies the patches;
`scripts/generate.ts` compiles the model into `src/services/`. Both follow distilled's Coolify
package, another token-authenticated JSON API without an envelope. Operation names come from the
converter: NetBird names only 54 of its 231 operations, and the converter names the rest from
method and path (`getPolicy`, `listPeers`).

**Patches.** NetBird's description and its servers disagree in places. The patches correct the
model and record the evidence:

- Lists that come back as `null`: rule `sources` and `destinations` when a rule uses a single peer,
  `source_posture_checks` on self-hosted servers, and group `peers` and `resources`. They were found
  by decoding real responses with distilled's strict response validation: a read-only export of a
  NetBird Cloud account and the operations of a self-hosted 0.82.0 server.
- Credentials the description does not mark as secret: personal access tokens, setup keys, proxy,
  invite and SCIM tokens, and some integration keys. The SDK returns them as `Redacted` values.

Patches target the shape names the converter gives before it renames operations, as distilled
requires.

**Hand-written parts**, as in every distilled package: `credentials.ts` (the token as a
`Redacted` value, the base URL with NetBird Cloud as default, and a check that the URL is an HTTPS
origin), `protocol.ts` (`Authorization: Token <token>` and the error mapping), `errors.ts`,
`traits.ts` and `retry.ts`.

## The provider

**One resource.** `NetBird.Policy` manages one access policy with one rule, the shape the NetBird
dashboard creates. Groups, peers, networks and DNS are not managed. Updating a group replaces its
whole membership, and a group resource that left membership alone would empty the group on its
first update; managing groups therefore means managing their members, which is a separate step.

**Names, not IDs.** Declarations name groups and peers. Every reconcile lists both and resolves
the names; a missing or ambiguous name fails before anything is written. NetBird accepts unknown
group IDs and silently drops them, which would leave a rule without a source, so the provider also
compares every response with the declaration and fails on a difference.

**Comparisons.** `desiredState` (from props) and `observe` (from a response) produce the same
shape, with group names sorted and ports sorted and deduplicated. `diff` compares declarations;
`reconcile` compares the live policy with the declaration and writes only when they differ. The
attributes are the observed shape, so `alchemy drift` shows dashboard edits.

**Never replaced.** Every change is an update in place, including a new name, so a policy never
disappears for a moment. Alchemy creates new policies before it deletes removed ones.

**Ownership.** NetBird policies have no labels or tags, and NetBird allows duplicate names. The
provider marks nothing. A policy found by name without state is returned as `Unowned`, so taking
it over needs `--adopt`, and the provider refuses duplicate names. Adoption must not change access:
it refuses a policy whose `enabled`, endpoints, direction, protocol or ports differ, both in `read`
(so `plan --adopt` shows it) and in `reconcile`. It may rename the rule and change descriptions.
Both also resolve the declared names first, so a matching policy whose group or peer name is
missing or shared is refused, although adopting it would write nothing.
For the same reason the provider implements no `list`, and `alchemy unsafe nuke` deletes nothing.

**Unsupported settings.** A policy with posture checks, several rules, a disabled rule, port
ranges, a `drop` action, SSH user mappings or a network resource as an endpoint is refused, because
writing it would drop those settings.

**Creates are not retried.** The SDK retries transient failures. A create is the exception: if
NetBird stored it before a connection failed, a retry would add a second policy with the same
name, which the provider would then refuse to adopt.

**Login.** The provider registers a stored Alchemy login, so the token can live in an
`alchemy profile`. `NETBIRD_API_TOKEN` and `NETBIRD_API_URL` take precedence and are read through
Effect `Config`, so a stack's `secrets` can supply them. The server address is part of the login,
because a self-hosted server is a different account.

## Testing

The server tests run against a real NetBird server in a local Podman pod, not against a fake:
the silent dropping of unknown IDs and the `null` lists were found that way. NetBird Cloud is
tested only read-only (plans and exports), because there is no test account.
