// The pure parts of the Policy resource: reading NetBird's responses and building requests.
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vitest";
import type { Policy as ApiPolicy } from "@distilled.cloud/netbird";
import {
  desiredState,
  observe,
  toRequest,
  validate,
  type Directory,
  type PolicyProps,
} from "../../src/Policy.ts";

const directory: Directory = {
  groups: new Map([
    ["admins", ["g-admins"]],
    ["servers", ["g-servers"]],
    ["twins", ["g-twin-1", "g-twin-2"]],
  ]),
  peers: new Map([["peer-a", ["p-a"]]]),
  peerNames: new Map([["p-a", "peer-a"]]),
};

const props: PolicyProps = {
  name: "admins -> servers",
  from: { groups: ["admins"] },
  to: { peer: "peer-a" },
  protocol: "tcp",
  ports: [443, 22, 443],
};

// The shape NetBird returns for a rule whose destination is a single peer.
const response: ApiPolicy = {
  id: "pol-1",
  name: "admins -> servers",
  description: "",
  enabled: true,
  source_posture_checks: null,
  rules: [
    {
      id: "pol-1",
      name: "admins -> servers",
      description: "",
      enabled: true,
      action: "accept",
      bidirectional: false,
      protocol: "tcp",
      ports: ["443", "22"],
      sources: [{ id: "g-admins", name: "admins", peers_count: 2, resources_count: 0 }],
      destinations: null,
      destinationResource: { id: "p-a", type: "peer" },
    },
  ],
};

describe("observe", () => {
  it("reads a response as the declaration it came from", () => {
    expect(observe(response, directory.peerNames)).toEqual(desiredState(props));
  });

  it("lists settings the provider does not manage", () => {
    const [rule] = response.rules;
    if (rule === undefined) throw new Error("fixture has a rule");
    const odd: ApiPolicy = {
      ...response,
      source_posture_checks: ["check-1"],
      rules: [
        {
          ...rule,
          action: "drop",
          enabled: false,
          ports: undefined,
          port_ranges: [{ start: 1, end: 2 }],
          sourceResource: { id: "r-1", type: "subnet" },
        },
        rule,
      ],
    };
    expect(observe(odd, directory.peerNames).unsupported).toEqual([
      "2 rules instead of one",
      "posture checks",
      "a disabled rule",
      "action drop",
      "port ranges",
      "a source resource of type subnet",
    ]);
  });
});

describe("toRequest", () => {
  it("resolves names to IDs and sends a peer as a resource", async () => {
    const request = await Effect.runPromise(toRequest(props, directory, "rule-1"));
    expect(request.rules).toEqual([
      {
        id: "rule-1",
        name: "admins -> servers",
        description: "",
        enabled: true,
        action: "accept",
        bidirectional: false,
        protocol: "tcp",
        ports: ["22", "443"],
        sources: ["g-admins"],
        destinationResource: { id: "p-a", type: "peer" },
      },
    ]);
  });

  it.each([
    [{ groups: ["nobody"] }, 'from group "nobody" does not exist'],
    [{ groups: ["twins"] }, 'from group "twins" is ambiguous (2 groups have this name)'],
    [{ peer: "peer-z" }, 'from peer "peer-z" does not exist'],
  ] as const)("refuses an endpoint it cannot resolve", async (from, message) => {
    const exit = await Effect.runPromiseExit(toRequest({ ...props, from }, directory));
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain(message);
  });
});

describe("validate", () => {
  it("rejects what the types allow but NetBird does not", async () => {
    const exit = await Effect.runPromiseExit(
      validate({ ...props, name: " ", ports: [0, 70000], from: { groups: [""] } }),
    );
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain(
      "name is empty; invalid port 0; invalid port 70000; from has an empty group name",
    );
  });
});
