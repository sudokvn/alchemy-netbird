# Testing

`pnpm test` runs the offline tests: the SDK's hand-written credentials, and the pure parts of the
Policy resource (reading NetBird responses, building requests and checking declarations). Like
distilled's own SDKs, the generated operations have no tests of their own; the server tests use
them.

`pnpm test:server` runs the Policy resource through the real Alchemy plan and apply against a
NetBird server that exists only for the run. It never contacts a real NetBird account.

## Run the server tests

Requires Podman with a running machine (`podman machine start` on macOS) and network access to
Docker Hub.

```sh
pnpm test:server
```

The setup in `packages/alchemy-netbird/test/server/globalSetup.ts`:

1. Creates a pod named `alchemy-netbird-test-<pid>` that publishes the server on a random
   `127.0.0.1` port.
2. Starts `netbirdio/netbird-server` with its data in memory and creates the owner and an API
   token through `POST /api/setup`.
3. Removes the Default policy, creates the groups `admins`, `servers` and `monitoring`, and
   enrolls two client containers as the peers `peer-a` and `peer-b`.

The pod and its files under `.local/test-server/` are removed when the run ends, also after a
failure. Before each test, every policy is deleted.

The tests record every write the provider sends, so they can prove that an unchanged deploy or a
matching adoption writes nothing. One test uses the package's `providers()` and logs in through
`NETBIRD_API_TOKEN` and `NETBIRD_API_URL`, as a stack does.

Set `NETBIRD_TEST_VERSION` to test another NetBird release, for example `0.81.5`. The server and
client images use the same version.

After an interrupted run, remove leftover pods:

```sh
podman pod ls --filter name=alchemy-netbird-test --format '{{.Name}}' | xargs -r podman pod rm -f
```
