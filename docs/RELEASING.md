# Releasing

A release is a Git tag and a GitHub release with two tarballs. Nothing goes to npm, and both
packages stay `"private": true`.

## Create a release

These steps release `0.1.0`. For another version, replace `0.1.0` everywhere. They require Node
24, pnpm 12.15.0 and the GitHub CLI.

1. Check that `version` in both `packages/*/package.json` files and the provider's peer dependency
   on `@distilled.cloud/netbird` match the release version. If they do not, change them on `main`
   first.
2. Create a working copy on `main` and install the dependencies:

   ```sh
   jj new main
   pnpm install --frozen-lockfile
   ```

3. Run the checks, including the server tests:

   ```sh
   pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:server
   ```

4. Build and pack both packages:

   ```sh
   pnpm release:pack
   ```

   `release/` now contains `distilled.cloud-netbird-0.1.0.tgz` and `alchemy.run-netbird-0.1.0.tgz`.

5. Tag `main` and push the tag:

   ```sh
   jj tag set v0.1.0 -r main
   jj git push --remote origin --tag v0.1.0
   ```

6. Create the GitHub release with both tarballs:

   ```sh
   gh release create v0.1.0 --repo trucke/alchemy-netbird --verify-tag --title v0.1.0 \
     --generate-notes \
     release/distilled.cloud-netbird-0.1.0.tgz release/alchemy.run-netbird-0.1.0.tgz
   ```

Never replace the tarballs of a published release. A project's lockfile pins each tarball's
integrity hash, so a changed file fails its next install. Release a new version instead.

## Install a release

pnpm accepts tarball URLs only in a project's own dependencies, not in dependencies of
dependencies. The provider therefore declares the SDK as a peer dependency, and a project lists
both tarballs. `alchemy` and `effect` are peer dependencies too, so the packages use the
project's copies; the provider is tested with `alchemy` 2.0.0-beta.84:

```json
{
  "dependencies": {
    "@alchemy.run/netbird": "https://github.com/trucke/alchemy-netbird/releases/download/v0.1.1/alchemy.run-netbird-0.1.1.tgz",
    "@distilled.cloud/netbird": "https://github.com/trucke/alchemy-netbird/releases/download/v0.1.1/distilled.cloud-netbird-0.1.1.tgz",
    "alchemy": "2.0.0-beta.84",
    "effect": "4.0.5"
  }
}
```

`pnpm install` records the integrity hash of each tarball in `pnpm-lock.yaml`. Commit the
lockfile, so that later installs fail if a tarball changes.

Then write a stack as in the [example](../README.md#example) and set up
[authentication](../packages/alchemy-netbird/README.md#authentication).
