// Downloads NetBird's OpenAPI description for one release into specs/openapi.yml and records
// where it came from in specs/source.json. Usage: pnpm specs:fetch [<tag>], default: the pinned tag.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse } from "yaml";

const REPOSITORY = "netbirdio/netbird";
const PATH = "shared/management/http/api/openapi.yml";
const specs = new URL("../specs/", import.meta.url);

interface Source {
  readonly repository: string;
  readonly path: string;
  readonly tag: string;
  readonly commit: string;
  readonly sha256: string;
}

const pinnedTag = async () =>
  (JSON.parse(await readFile(new URL("source.json", specs), "utf8")) as Source).tag;
const tag = process.argv[2] ?? (await pinnedTag());
if (!/^v\d+\.\d+\.\d+$/.test(tag))
  throw new Error(`Expected a release tag such as v0.82.0, got ${tag}`);

const fetchOk = async (url: string) => {
  const response = await fetch(url, { headers: { "User-Agent": "alchemy-netbird" } });
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return response;
};

const commit = (
  (await (await fetchOk(`https://api.github.com/repos/${REPOSITORY}/commits/${tag}`)).json()) as {
    sha: string;
  }
).sha;
// The commit, not the tag, so the file cannot change between these two requests.
const text = await (
  await fetchOk(`https://raw.githubusercontent.com/${REPOSITORY}/${commit}/${PATH}`)
).text();

// A rate-limit page or a moved file is still text: check it is the API description.
const spec = parse(text) as { openapi?: unknown; paths?: unknown };
if (typeof spec.openapi !== "string" || typeof spec.paths !== "object" || spec.paths === null)
  throw new Error(`${PATH} at ${tag} is not an OpenAPI document`);

const source: Source = {
  repository: REPOSITORY,
  path: PATH,
  tag,
  commit,
  sha256: createHash("sha256").update(text).digest("hex"),
};
await mkdir(specs, { recursive: true });
await writeFile(new URL("openapi.yml", specs), text);
await writeFile(new URL("source.json", specs), `${JSON.stringify(source, null, 2)}\n`);
console.log(`specs/openapi.yml: NetBird ${tag} (${commit.slice(0, 12)})`);
