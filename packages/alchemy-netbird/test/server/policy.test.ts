// The Policy resource through the real Alchemy plan and apply, against the test server.
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";
import { beforeEach, describe, expect, it } from "vitest";
import { observe } from "../../src/Policy.ts";
import * as NetBird from "../../src/index.ts";
import { dashboard, deleteAllPolicies, harness, idOf, policies, policyNamed } from "./harness.ts";

const https = ({
  name = "admins -> servers (HTTPS)",
  to = { groups: ["servers"] } as NetBird.Endpoint,
  ports = [443, 22] as readonly [number, ...number[]],
} = {}) =>
  NetBird.Policy("admins-servers", {
    name,
    from: { groups: ["admins"] },
    to,
    protocol: "tcp",
    ports,
  });

/** A policy created outside Alchemy, as in the dashboard. */
async function seed(name: string, rule: Record<string, unknown>) {
  return dashboard<{ id: string }>("POST", "/policies", {
    name,
    enabled: true,
    rules: [
      {
        name,
        enabled: true,
        action: "accept",
        bidirectional: false,
        protocol: "tcp",
        ports: ["443", "22"],
        sources: [await idOf("groups", "admins")],
        destinations: [await idOf("groups", "servers")],
        ...rule,
      },
    ],
  });
}

const peerNames = async () =>
  new Map(
    (await dashboard<{ id: string; name: string }[]>("GET", "/peers")).map((peer) => [
      peer.id,
      peer.name,
    ]),
  );

const CREATE = "POST /api/policies";

beforeEach(deleteAllPolicies);

describe("NetBird.Policy", () => {
  it("creates a policy from names, then plans no changes and writes nothing", async () => {
    const stack = harness();
    await stack.deploy(https());
    const policy = await policyNamed("admins -> servers (HTTPS)");
    const [rule] = policy.rules;
    expect(rule).toMatchObject({
      name: "admins -> servers (HTTPS)",
      action: "accept",
      bidirectional: false,
      protocol: "tcp",
      ports: ["22", "443"],
      sources: [{ id: await idOf("groups", "admins"), name: "admins" }],
      destinations: [{ id: await idOf("groups", "servers"), name: "servers" }],
    });
    expect(stack.writes).toEqual([CREATE]);

    const plan = await stack.plan(https({ ports: [22, 443] }));
    expect(plan.resources["admins-servers"]?.action).toBe("noop");
    await stack.deploy(https());
    expect(stack.writes).toHaveLength(1);
    // Drift compares what read observes with these attributes.
    expect((await stack.attributes())["admins-servers"]).toEqual({
      policyId: policy.id,
      ...observe(policy, await peerNames()),
    });
  });

  it("logs in through NETBIRD_API_TOKEN and NETBIRD_API_URL with the default providers", async () => {
    const stack = harness({ login: true });
    await stack.deploy(https());
    expect((await policies()).map((policy) => policy.name)).toEqual(["admins -> servers (HTTPS)"]);
    await stack.destroy();
    expect(await policies()).toEqual([]);
  });

  it("changes a policy in place and keeps its ID", async () => {
    const stack = harness();
    await stack.deploy(https());
    const before = await policyNamed("admins -> servers (HTTPS)");
    await stack.deploy(https({ name: "admins -> servers (SSH)", ports: [22] }));
    const after = await policyNamed("admins -> servers (SSH)");
    expect(after.id).toBe(before.id);
    expect(after.rules[0]).toMatchObject({ name: "admins -> servers (SSH)", ports: ["22"] });
    expect(stack.writes).toEqual([CREATE, `PUT /api/policies/${before.id}`]);
  });

  it("accepts single peers as source and destination", async () => {
    const stack = harness();
    await stack.deploy(
      Effect.all([
        NetBird.Policy("pair", {
          name: "peer-a <-> peer-b",
          from: { peer: "peer-a" },
          to: { peer: "peer-b" },
          protocol: "all",
          bidirectional: true,
        }),
        NetBird.Policy("health", {
          name: "monitoring -> peer-b (health)",
          from: { groups: ["monitoring"] },
          to: { peer: "peer-b" },
          protocol: "tcp",
          ports: [9787],
        }),
      ]),
    );
    const peerB = { id: await idOf("peers", "peer-b"), type: "peer" };
    expect((await policyNamed("peer-a <-> peer-b")).rules[0]).toMatchObject({
      protocol: "all",
      bidirectional: true,
      sourceResource: { id: await idOf("peers", "peer-a"), type: "peer" },
      destinationResource: peerB,
    });
    expect((await policyNamed("monitoring -> peer-b (health)")).rules[0]).toMatchObject({
      sources: [{ name: "monitoring" }],
      destinationResource: peerB,
      ports: ["9787"],
    });
  });

  it("fails before writing anything when a group does not exist", async () => {
    const stack = harness();
    const failure = await stack.deployFailure(https({ to: { groups: ["typo"] } }));
    expect(failure).toContain("NetBirdPolicyInvalid");
    expect(failure).toContain('to group "typo" does not exist');
    expect(stack.writes).toEqual([]);
    expect(await policies()).toEqual([]);
  });

  it("takes over an existing policy only with --adopt, without changing access", async () => {
    const { id } = await seed("admins -> servers (HTTPS)", { name: "an older rule name" });
    const stack = harness();
    expect(await stack.deployFailure(https())).toContain("OwnedBySomeoneElse");
    expect(stack.writes).toEqual([]);

    await stack.deploy(https(), true);
    // Only the rule's name changed.
    expect(stack.writes).toEqual([`PUT /api/policies/${id}`]);
    const policy = await policyNamed("admins -> servers (HTTPS)");
    expect(policy.id).toBe(id);
    expect(policy.rules[0]?.name).toBe("admins -> servers (HTTPS)");
    expect((await stack.plan(https())).resources["admins-servers"]?.action).toBe("noop");
  });

  it("adopting a policy that already matches writes nothing", async () => {
    await seed("admins -> servers (HTTPS)", {});
    const stack = harness();
    expect((await stack.plan(https(), true)).resources["admins-servers"]?.action).toBe("adopted");
    await stack.deploy(https(), true);
    expect(stack.writes).toEqual([]);
  });

  it("refuses to adopt a policy whose access differs from the declaration", async () => {
    await seed("admins -> servers (HTTPS)", { ports: ["22"] });
    const stack = harness();
    // The plan already shows it.
    expect(await stack.planFailure(https(), true)).toContain("NetBirdPolicyRefused");
    const failure = await stack.deployFailure(https(), true);
    expect(failure).toContain("NetBirdPolicyRefused");
    expect(failure).toContain("ports: [22,443] -> [22]");
    expect(stack.writes).toEqual([]);
    expect((await policyNamed("admins -> servers (HTTPS)")).rules[0]?.ports).toEqual(["22"]);
  });

  it("refuses to change a policy with settings it does not manage", async () => {
    await seed("admins -> servers (HTTPS)", {
      ports: undefined,
      port_ranges: [{ start: 8000, end: 8100 }],
    });
    const stack = harness();
    const failure = await stack.deployFailure(https(), true);
    expect(failure).toContain("NetBirdPolicyRefused");
    expect(failure).toContain("port ranges");
    expect(stack.writes).toEqual([]);
  });

  it("refuses a name that several policies share", async () => {
    await seed("admins -> servers (HTTPS)", {});
    await seed("admins -> servers (HTTPS)", {});
    const failure = await harness().deployFailure(https(), true);
    expect(failure).toContain('NetBird has 2 policies named "admins -> servers (HTTPS)"');
  });

  it("deletes a removed policy unless it is retained", async () => {
    const stack = harness();
    await stack.deploy(
      Effect.all([
        https(),
        NetBird.Policy("break-glass", {
          name: "admins -> servers (all)",
          from: { groups: ["admins"] },
          to: { groups: ["servers"] },
          protocol: "all",
        }).pipe(RemovalPolicy.retain()),
      ]),
    );
    await stack.deploy(Effect.void);
    expect((await policies()).map((policy) => policy.name)).toEqual(["admins -> servers (all)"]);
  });

  it("creates a replacement before deleting the policy it replaces", async () => {
    const stack = harness();
    await stack.deploy(https());
    const old = await policyNamed("admins -> servers (HTTPS)");
    await stack.deploy(
      NetBird.Policy("admins-servers-v2", {
        name: "admins -> servers (HTTPS, v2)",
        from: { groups: ["admins"] },
        to: { groups: ["servers"] },
        protocol: "tcp",
        ports: [443],
      }),
    );
    expect(stack.writes).toEqual([CREATE, CREATE, `DELETE /api/policies/${old.id}`]);
  });
});
