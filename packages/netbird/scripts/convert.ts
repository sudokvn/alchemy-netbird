// Converts specs/openapi.yml into the Smithy model in .generated-specs/netbird.json, applying
// patches/*.patch.json. scripts/generate.ts runs this first.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { runOpenApiConvert } from "@distilled.cloud/core/codegen/openapi-cli";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "..");
const source: { tag: string; sha256: string } = JSON.parse(
  readFileSync(path.join(root, "specs/source.json"), "utf8"),
);
// Generate only from the file that specs:fetch recorded.
const actual = createHash("sha256")
  .update(readFileSync(path.join(root, "specs/openapi.yml")))
  .digest("hex");
if (actual !== source.sha256)
  throw new Error(
    `specs/openapi.yml does not match specs/source.json (${source.tag}); run pnpm specs:fetch`,
  );

await runOpenApiConvert({
  root,
  specs: [{ name: "netbird", specPath: "specs/openapi.yml" }],
  parse: (text) => parse(text),
  patchesDir: "patches",
  options: {
    namespace: "io.netbird.api",
    serviceName: "NetBird",
    skipDeprecated: true,
  },
});
