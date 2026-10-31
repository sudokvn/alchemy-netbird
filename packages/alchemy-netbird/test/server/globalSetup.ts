// Starts a throwaway self-hosted NetBird server in a Podman pod on this machine, with an owner,
// an API token, two enrolled peers and three groups. Everything lives in memory and is removed
// when the run ends. Nothing here can reach a real NetBird account.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { GROUPS, PEERS } from "./context.ts";

const VERSION = process.env.NETBIRD_TEST_VERSION ?? "0.82.0";
const POD = `alchemy-netbird-test-${process.pid}`;
const DIR = join(import.meta.dirname, "../../../../.local/test-server", POD);

const podman = (...args: string[]) =>
  execFileSync("podman", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const secret = () => randomBytes(16).toString("hex");

async function until<A>(what: string, attempt: () => Promise<A | undefined>, seconds = 60) {
  for (let i = 0; i < seconds * 2; i++) {
    const result = await attempt().catch(() => undefined);
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Test server: timed out waiting for ${what}`);
}

export default async function setup(project: TestProject) {
  try {
    podman("--version");
  } catch {
    throw new Error("The server tests need Podman (https://podman.io) on this machine.");
  }
  mkdirSync(DIR, { recursive: true });
  // The server listens on port 80 inside the pod; peers in the pod reach it there.
  writeFileSync(
    join(DIR, "config.yaml"),
    `server:
  listenAddress: ":80"
  exposedAddress: "http://127.0.0.1:80"
  healthcheckAddress: ":9000"
  metricsPort: 9090
  logLevel: "warn"
  logFile: "console"
  authSecret: "${secret()}"
  dataDir: "/var/lib/netbird/"
  disableAnonymousMetrics: true
  disableGeoliteUpdate: true
  auth:
    issuer: "http://127.0.0.1:80/oauth2"
    localAuthDisabled: false
    dashboardRedirectURIs: []
    cliRedirectURIs: ["http://localhost:53000/"]
  store:
    engine: "sqlite"
    encryptionKey: "${randomBytes(32).toString("base64")}"
`,
  );
  const stop = () => {
    try {
      podman("pod", "rm", "--force", "--time", "0", POD);
    } finally {
      rmSync(DIR, { recursive: true, force: true });
    }
  };
  try {
    podman("pod", "create", "--name", POD, "--publish", "127.0.0.1::80");
    podman(
      "run",
      "--detach",
      "--pod",
      POD,
      "--name",
      `${POD}-server`,
      "--env",
      "NB_SETUP_PAT_ENABLED=true",
      "--tmpfs",
      "/var/lib/netbird",
      "--volume",
      `${join(DIR, "config.yaml")}:/etc/netbird/config.yaml:ro`,
      `docker.io/netbirdio/netbird-server:${VERSION}`,
      "--config",
      "/etc/netbird/config.yaml",
    );
    const port = podman("port", `${POD}-server`, "80/tcp").split(":").at(-1);
    const url = `http://127.0.0.1:${port}`;
    await until("the server", async () =>
      (await fetch(`${url}/api/instance`)).ok ? true : undefined,
    );

    const setupResponse = await fetch(`${url}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "owner@test.invalid",
        name: "Test owner",
        password: secret(),
        create_pat: true,
      }),
    });
    const { personal_access_token: token } = (await setupResponse.json()) as {
      personal_access_token?: string;
    };
    if (token === undefined) throw new Error(`Test server: setup failed (${setupResponse.status})`);
    const api = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${url}/api${path}`, {
        method,
        headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`Test server: ${method} ${path} -> ${response.status}`);
      return response.json() as Promise<unknown>;
    };

    // The server starts with an all-to-all Default policy. The tests list every policy, so
    // remove it.
    for (const policy of (await api("GET", "/policies")) as { id: string }[])
      await api("DELETE", `/policies/${policy.id}`);
    for (const name of GROUPS) await api("POST", "/groups", { name });

    const { key } = (await api("POST", "/setup-keys", {
      name: "test peers",
      type: "reusable",
      expires_in: 86400,
      auto_groups: [],
      usage_limit: 0,
    })) as { key: string };
    for (const peer of PEERS)
      podman(
        "run",
        "--detach",
        "--pod",
        POD,
        "--name",
        `${POD}-${peer}`,
        "--tmpfs",
        "/var/lib/netbird:rw,mode=1777",
        "--env",
        `NB_SETUP_KEY=${key}`,
        "--env",
        "NB_MANAGEMENT_URL=http://127.0.0.1:80",
        "--env",
        `NB_HOSTNAME=${peer}`,
        `docker.io/netbirdio/netbird:${VERSION}-rootless`,
      );
    await until("the peers", async () => {
      const peers = (await api("GET", "/peers")) as { name: string }[];
      return PEERS.every((name) => peers.some((peer) => peer.name === name)) ? true : undefined;
    });

    project.provide("netbird", { url, token });
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
