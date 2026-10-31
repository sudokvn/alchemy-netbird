import * as NetBird from "@distilled.cloud/netbird";
import { Unowned } from "alchemy/AdoptPolicy";
import { deepEqual, isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/** The source or destination of a policy: one or more groups, or a single peer, by name. */
export type Endpoint =
  | { readonly groups: readonly [string, ...string[]]; readonly peer?: never }
  | { readonly peer: string; readonly groups?: never };

/** `ports` narrows TCP and UDP rules; without it, a rule covers every port. */
export type Traffic =
  | {
      /** Traffic the rule covers. */
      readonly protocol: "all" | "icmp";
      readonly ports?: never;
    }
  | {
      /** Traffic the rule covers. */
      readonly protocol: "tcp" | "udp";
      /**
       * Destination ports, for example `[22, 443]`.
       * @default every port
       */
      readonly ports?: readonly [number, ...number[]];
    };

export type PolicyProps = {
  /**
   * The policy's name in NetBird, also used for its rule. A policy without Alchemy state is
   * found by this name, so keep it unique in the account.
   */
  readonly name: string;
  /**
   * The policy's description in NetBird.
   * @default ""
   */
  readonly description?: string;
  /**
   * Whether the policy is active.
   * @default true
   */
  readonly enabled?: boolean;
  /** Who may open connections. The provider looks up the IDs on every deploy. */
  readonly from: Endpoint;
  /** What they may connect to. */
  readonly to: Endpoint;
  /**
   * Whether `to` may also open connections to `from`.
   * @default false
   */
  readonly bidirectional?: boolean;
} & Traffic;

/** An endpoint as NetBird reports it, by name. */
export type ObservedEndpoint = { readonly groups: readonly string[] } | { readonly peer: string };

export interface PolicyAttributes {
  /** NetBird's ID of the policy. It never changes. */
  readonly policyId: string;
  /** The policy's name in NetBird. */
  readonly name: string;
  /** The policy's description. */
  readonly description: string;
  /** Whether the policy is active. */
  readonly enabled: boolean;
  /** The source, with group names sorted. */
  readonly from: ObservedEndpoint;
  /** The destination, with group names sorted. */
  readonly to: ObservedEndpoint;
  /** Whether `to` may also open connections to `from`. */
  readonly bidirectional: boolean;
  /** `all`, `tcp`, `udp`, `icmp` or a protocol the provider does not manage. */
  readonly protocol: string;
  /** Sorted destination ports. Empty means every port. */
  readonly ports: readonly number[];
  /** The name of the policy's one rule. The provider keeps it equal to `name`. */
  readonly ruleName: string;
  /** Settings the provider does not manage, such as posture checks. It refuses to change such a policy. */
  readonly unsupported: readonly string[];
}

/** A policy's content without its ID, for comparing declarations with NetBird. */
export type PolicyState = Omit<PolicyAttributes, "policyId">;

export type Policy = Resource<
  "NetBird.Policy",
  PolicyProps,
  PolicyAttributes,
  never,
  import("./Providers.ts").Providers
>;

/**
 * A NetBird access policy with one rule. Its source and destination are groups or single peers,
 * referenced by name. Groups and peers themselves are not managed.
 *
 * NetBird policies have no labels or tags, so the provider marks nothing as owned. A policy that
 * exists without Alchemy state is found by its name and needs `--adopt`, and adoption refuses a
 * policy whose access differs from the declaration. Changes are always made in place; the
 * policy keeps its ID, also when its name changes.
 *
 * **Example:** SSH from one group to another
 * ```typescript
 * yield* NetBird.Policy("admins-servers", {
 *   name: "admins -> servers (SSH)",
 *   from: { groups: ["admins"] },
 *   to: { groups: ["servers"] },
 *   protocol: "tcp",
 *   ports: [22],
 * });
 * ```
 *
 * **Example:** all traffic between two peers, never deleted by Alchemy
 * ```typescript
 * yield* NetBird.Policy("workstations", {
 *   name: "laptop <-> desktop",
 *   from: { peer: "laptop" },
 *   to: { peer: "desktop" },
 *   protocol: "all",
 *   bidirectional: true,
 * }).pipe(RemovalPolicy.retain());
 * ```
 * @resource
 */
export const Policy = Resource<Policy>("NetBird.Policy");

/** The declaration is invalid, or names a group or peer that does not exist. */
export class NetBirdPolicyInvalid extends Data.TaggedError("NetBirdPolicyInvalid")<{
  message: string;
}> {}

/** NetBird holds a policy the provider must not change. Nothing was written. */
export class NetBirdPolicyRefused extends Data.TaggedError("NetBirdPolicyRefused")<{
  message: string;
}> {}

/** NetBird stored something other than what was sent, or answered without a policy ID. */
export class NetBirdPolicyMismatch extends Data.TaggedError("NetBirdPolicyMismatch")<{
  message: string;
}> {}

/** A policy as the list, get, create and update operations return it. */
type LivePolicy = NetBird.Policy;
type LiveRule = LivePolicy["rules"][number];

const PROTOCOLS: ReadonlySet<string> = new Set(["all", "tcp", "udp", "icmp"]);

const uniqueSorted = <A extends string | number>(values: Iterable<A>): A[] =>
  [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const endpointState = (endpoint: Endpoint): ObservedEndpoint =>
  endpoint.peer !== undefined ? { peer: endpoint.peer } : { groups: uniqueSorted(endpoint.groups) };

/** What NetBird should hold for a declaration. Pure, so plans can compare declarations. */
export const desiredState = (props: PolicyProps): PolicyState => ({
  name: props.name,
  description: props.description ?? "",
  enabled: props.enabled ?? true,
  from: endpointState(props.from),
  to: endpointState(props.to),
  bidirectional: props.bidirectional ?? false,
  protocol: props.protocol,
  ports: uniqueSorted(props.ports ?? []),
  ruleName: props.name,
  unsupported: [],
});

/** A policy as NetBird reports it, by name, with everything the provider does not manage listed. */
export function observe(policy: LivePolicy, peerNames: ReadonlyMap<string, string>): PolicyState {
  const unsupported: string[] = [];
  if (policy.rules.length !== 1) unsupported.push(`${policy.rules.length} rules instead of one`);
  if ((policy.source_posture_checks ?? []).length > 0) unsupported.push("posture checks");
  const rule = policy.rules[0];
  const base = {
    name: policy.name,
    description: policy.description ?? "",
    enabled: policy.enabled,
  };
  if (rule === undefined)
    return {
      ...base,
      from: { groups: [] },
      to: { groups: [] },
      bidirectional: false,
      protocol: "all",
      ports: [],
      ruleName: "",
      unsupported,
    };
  if (!rule.enabled) unsupported.push("a disabled rule");
  if (rule.action !== "accept") unsupported.push(`action ${rule.action}`);
  if (!PROTOCOLS.has(rule.protocol)) unsupported.push(`protocol ${rule.protocol}`);
  if ((rule.port_ranges ?? []).length > 0) unsupported.push("port ranges");
  if (Object.keys(rule.authorized_groups ?? {}).length > 0) unsupported.push("SSH user mappings");
  const ports = (rule.ports ?? []).map(Number);
  if (!ports.every(Number.isInteger)) unsupported.push(`ports ${(rule.ports ?? []).join(",")}`);
  const endpoint = (
    side: "source" | "destination",
    groups: LiveRule["sources"],
    resource: LiveRule["sourceResource"],
  ): ObservedEndpoint => {
    if (resource == null)
      return { groups: uniqueSorted((groups ?? []).map((group) => group.name)) };
    if (resource.type !== "peer") {
      unsupported.push(`a ${side} resource of type ${String(resource.type)}`);
      return { groups: [] };
    }
    return { peer: peerNames.get(resource.id) ?? `unknown peer ${resource.id}` };
  };
  return {
    ...base,
    from: endpoint("source", rule.sources, rule.sourceResource),
    to: endpoint("destination", rule.destinations, rule.destinationResource),
    bidirectional: rule.bidirectional,
    protocol: rule.protocol,
    ports: uniqueSorted(ports.filter(Number.isInteger)),
    ruleName: rule.name,
    unsupported,
  };
}

/** The parts of a policy that decide who can reach what. */
const access = ({ name: _n, description: _d, ruleName: _r, ...rest }: PolicyState) => rest;

/** Every field of `a` that differs from `b`, as `field: a -> b`. */
const differences = (a: object, b: object) =>
  Object.keys(a)
    .filter((key) => !deepEqual(Reflect.get(a, key), Reflect.get(b, key)))
    .map(
      (key) =>
        `${key}: ${JSON.stringify(Reflect.get(a, key))} -> ${JSON.stringify(Reflect.get(b, key))}`,
    )
    .join("; ");

/** Rejects declarations that the types allow but NetBird does not, such as port 0. */
export function validate(props: PolicyProps): Effect.Effect<void, NetBirdPolicyInvalid> {
  const problems: string[] = [];
  if (props.name.trim() === "") problems.push("name is empty");
  if (!PROTOCOLS.has(props.protocol)) problems.push(`unknown protocol ${props.protocol}`);
  const ports = props.ports ?? [];
  if (ports.length > 0 && props.protocol !== "tcp" && props.protocol !== "udp")
    problems.push(`ports need protocol tcp or udp, not ${props.protocol}`);
  for (const port of ports)
    if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push(`invalid port ${port}`);
  for (const [side, endpoint] of [
    ["from", props.from],
    ["to", props.to],
  ] as const) {
    const groups = endpoint.groups ?? [];
    if (endpoint.peer !== undefined && endpoint.groups !== undefined)
      problems.push(`${side} names both groups and a peer`);
    else if (endpoint.peer !== undefined ? endpoint.peer.trim() === "" : groups.length === 0)
      problems.push(`${side} names no group or peer`);
    if (groups.some((group) => group.trim() === ""))
      problems.push(`${side} has an empty group name`);
  }
  return problems.length === 0
    ? Effect.void
    : Effect.fail(
        new NetBirdPolicyInvalid({
          message: `NetBird policy "${props.name}": ${problems.join("; ")}`,
        }),
      );
}

/** Group and peer IDs by name, and peer names by ID, read once per operation. */
export interface Directory {
  readonly groups: ReadonlyMap<string, readonly string[]>;
  readonly peers: ReadonlyMap<string, readonly string[]>;
  readonly peerNames: ReadonlyMap<string, string>;
}

const byName = (items: ReadonlyArray<{ readonly id: string; readonly name: string }>) => {
  const map = new Map<string, string[]>();
  for (const { id, name } of items) map.set(name, [...(map.get(name) ?? []), id]);
  return map;
};

const loadDirectory = Effect.all(
  { groups: NetBird.listGroups({}), peers: NetBird.listPeers({}) },
  { concurrency: 2 },
).pipe(
  Effect.map(({ groups, peers }): Directory => ({
    groups: byName(groups),
    peers: byName(peers),
    peerNames: new Map(peers.map((peer) => [peer.id, peer.name])),
  })),
);

/** The policy, or `None` when NetBird does not have it. */
const getPolicy = (policyId: string) =>
  NetBird.getPolicy({ policyId }).pipe(
    Effect.map(Option.some<LivePolicy>),
    Effect.catchTag("NotFound", () => Effect.succeed(Option.none<LivePolicy>())),
  );

/**
 * The live policy for a resource's state. The stored ID is only a cache: a policy deleted in the
 * dashboard, or a resource without state, observes as `None`.
 */
const observeLive = (output: PolicyAttributes | undefined) =>
  output === undefined ? Effect.succeed(Option.none<LivePolicy>()) : getPolicy(output.policyId);

/** The ID of a policy NetBird returned. The API description leaves it optional. */
const idOf = (policy: LivePolicy) =>
  policy.id === undefined
    ? Effect.fail(
        new NetBirdPolicyMismatch({
          message: `NetBird returned policy "${policy.name}" without an ID`,
        }),
      )
    : Effect.succeed(policy.id);

/** The rule endpoint of a request: group IDs or a single peer. */
type EndpointRequest =
  | { readonly groups: string[] }
  | { readonly resource: { readonly id: string; readonly type: "peer" } };

const resolveEndpoint = (
  policy: string,
  side: "from" | "to",
  endpoint: Endpoint,
  directory: Directory,
): Effect.Effect<EndpointRequest, NetBirdPolicyInvalid> => {
  const one = (kind: "group" | "peer", name: string) => {
    const ids = (kind === "group" ? directory.groups : directory.peers).get(name) ?? [];
    const [id] = ids;
    return ids.length === 1 && id !== undefined
      ? Effect.succeed(id)
      : Effect.fail(
          new NetBirdPolicyInvalid({
            message: `NetBird policy "${policy}": ${side} ${kind} "${name}" ${ids.length === 0 ? "does not exist" : `is ambiguous (${ids.length} ${kind}s have this name)`}`,
          }),
        );
  };
  return endpoint.peer !== undefined
    ? Effect.map(one("peer", endpoint.peer), (id) => ({ resource: { id, type: "peer" as const } }))
    : Effect.map(
        Effect.forEach(uniqueSorted(endpoint.groups), (name) => one("group", name)),
        (groups) => ({ groups }),
      );
};

/** A declaration's source and destination with names resolved to IDs. */
export interface ResolvedEndpoints {
  readonly from: EndpointRequest;
  readonly to: EndpointRequest;
}

/** Resolves both endpoints; fails if a name does not exist or several groups or peers share it. */
export const resolveEndpoints = (props: PolicyProps, directory: Directory) =>
  Effect.all({
    from: resolveEndpoint(props.name, "from", props.from, directory),
    to: resolveEndpoint(props.name, "to", props.to, directory),
  });

/** The API request for a declaration with resolved endpoints. */
export function toRequest(
  props: PolicyProps,
  { from, to }: ResolvedEndpoints,
  ruleId?: string,
): NetBird.CreatePolicyRequest {
  const desired = desiredState(props);
  return {
    name: desired.name,
    description: desired.description,
    enabled: desired.enabled,
    source_posture_checks: [],
    rules: [
      {
        ...(ruleId === undefined ? {} : { id: ruleId }),
        name: desired.ruleName,
        description: "",
        enabled: true,
        action: "accept",
        bidirectional: desired.bidirectional,
        protocol: props.protocol,
        ...(desired.ports.length === 0 ? {} : { ports: desired.ports.map(String) }),
        ...("resource" in from ? { sourceResource: from.resource } : { sources: from.groups }),
        ...("resource" in to ? { destinationResource: to.resource } : { destinations: to.groups }),
      },
    ],
  };
}

/** Fails unless NetBird stored the declaration: NetBird silently drops unknown group IDs. */
const verify = (fqn: string, policy: LivePolicy, desired: PolicyState, directory: Directory) =>
  Effect.gen(function* () {
    const policyId = yield* idOf(policy);
    const stored = observe(policy, directory.peerNames);
    if (!deepEqual(stored, desired))
      return yield* new NetBirdPolicyMismatch({
        message: `NetBird policy ${fqn} (${policyId}): NetBird stored something else. ${differences(desired, stored)}`,
      });
    return { policyId, ...stored };
  });

/**
 * Refuses to write over a policy with settings the provider does not manage, and, when
 * `adopting`, over one whose access differs from the declaration. Adoption may rename the rule
 * or change descriptions, but never who can reach what.
 */
const checkWritable = (
  fqn: string,
  policy: LivePolicy,
  current: PolicyState,
  desired: PolicyState,
  adopting: boolean,
) => {
  const label = `NetBird policy ${fqn} ("${policy.name}", ${policy.id})`;
  if (current.unsupported.length > 0)
    return Effect.fail(
      new NetBirdPolicyRefused({
        message: `${label} has settings this provider does not manage: ${current.unsupported.join(", ")}. Writing it would drop them, so nothing was changed. Remove them in NetBird or leave the policy out of the stack.`,
      }),
    );
  if (adopting && !deepEqual(access(current), access(desired)))
    return Effect.fail(
      new NetBirdPolicyRefused({
        message: `${label} differs from the declaration, so it was not taken over: ${differences(access(desired), access(current))} (declared -> NetBird). Make the declaration match NetBird first; adoption must not change access.`,
      }),
    );
  return Effect.void;
};

export const PolicyProvider = () =>
  Provider.succeed(Policy, {
    stables: ["policyId"],
    read: Effect.fn(function* ({ fqn, olds, output }) {
      if (output !== undefined) {
        const live = yield* observeLive(output);
        if (Option.isNone(live)) return undefined;
        const { peerNames } = yield* loadDirectory;
        const policyId = yield* idOf(live.value);
        return { policyId, ...observe(live.value, peerNames) };
      }
      // Policies carry no ownership marker and NetBird allows duplicate names. A policy found
      // by name is therefore never assumed to be ours: taking it over needs --adopt.
      const all = yield* NetBird.listPolicies({});
      const matches = all.filter((policy) => policy.name === olds.name);
      const [match] = matches;
      if (match === undefined) return undefined;
      if (matches.length > 1)
        return yield* new NetBirdPolicyRefused({
          message: `NetBird has ${matches.length} policies named "${olds.name}" (${matches.map((policy) => policy.id).join(", ")}). Rename or remove all but one in NetBird first.`,
        });
      const directory = yield* loadDirectory;
      // Checked here as well as in reconcile, so `plan --adopt` already shows a refused takeover:
      // even a policy that matches must name its groups and peers unambiguously.
      yield* resolveEndpoints(olds, directory);
      const current = observe(match, directory.peerNames);
      yield* checkWritable(fqn, match, current, desiredState(olds), true);
      const policyId = yield* idOf(match);
      return Unowned({ policyId, ...current });
    }),
    // Changes are always made in place: replacing a policy would leave a moment without it.
    diff: ({ olds, news }) =>
      Effect.succeed(
        isResolved(news) && deepEqual(desiredState(olds), desiredState(news))
          ? { action: "noop" as const }
          : { action: "update" as const },
      ),
    reconcile: Effect.fn(function* ({ fqn, news, olds, output }) {
      yield* validate(news);
      const desired = desiredState(news);
      const directory = yield* loadDirectory;
      // Resolved on every path, also when NetBird already matches and nothing is written.
      const endpoints = yield* resolveEndpoints(news, directory);
      const live = yield* observeLive(output);
      if (Option.isNone(live)) {
        // A create is never repeated: if NetBird stored it before a connection failed, a retry
        // would add a second policy with the same name.
        const created = yield* NetBird.createPolicy(toRequest(news, endpoints)).pipe(
          NetBird.Retry.none,
        );
        return yield* verify(fqn, created, desired, directory);
      }
      const current = observe(live.value, directory.peerNames);
      // Without previous props, the engine is adopting the policy.
      yield* checkWritable(fqn, live.value, current, desired, olds === undefined);
      const policyId = yield* idOf(live.value);
      if (deepEqual(current, desired)) return { policyId, ...current };
      const body = toRequest(news, endpoints, live.value.rules[0]?.id);
      const updated = yield* NetBird.putPolicy({ policyId, ...body });
      return yield* verify(fqn, updated, desired, directory);
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* NetBird.deletePolicy({ policyId: output.policyId }).pipe(
        Effect.catchTag("NotFound", () => Effect.void),
      );
    }),
  });
