// Compiles the Smithy model that scripts/convert.ts writes into src/services/. Run it through
// `pnpm generate`, which converts first and formats afterwards.
import { runGeneratorCli } from "@distilled.cloud/core/codegen/cli";
import type { SdkSpec } from "@distilled.cloud/core/codegen/generator";
import {
  ERROR_MATCHERS_TRAIT,
  NULLABLE_TRAIT,
  RAW_RESPONSE_TRAIT,
} from "@distilled.cloud/core/codegen/openapi";

const SENSITIVE_TRAIT = "smithy.api#sensitive";

// The settings of distilled's Coolify package, another plain token-authenticated JSON API.
// NetBird keeps its snake_case wire names on the TypeScript surface.
const spec: SdkSpec = {
  nullableTrait: NULLABLE_TRAIT,
  errorMatchersTrait: ERROR_MATCHERS_TRAIT,
  extraBindings: [
    {
      // A bare array or scalar response body becomes the only member of a wrapper shape.
      trait: RAW_RESPONSE_TRAIT,
      binding: "rawResponse",
      pipe: "T.RawResponse()",
      rootPipe: "T.RawResponseRoot()",
    },
  ],
  // Secrets arrive as Redacted values; inputs accept a string or a Redacted value.
  memberTraitPipes: { [SENSITIVE_TRAIT]: "T.SensitiveValue" },
  memberTsType: (member) =>
    SENSITIVE_TRAIT in member.traits
      ? `string | Redacted.Redacted<string>${member.nullable ? " | null" : ""}`
      : undefined,
  // The REST protocol passes union content through as it is.
  union: ({ name, caseTargets, tsRef }) => [
    `export type ${name} = ${caseTargets.map(tsRef).join(" | ") || "unknown"};`,
    `export const ${name} = S.Unknown as any as S.Schema<${name}>;\n`,
  ],
  operationDecl: {
    contextType: "NetBirdOpContext",
    commonErrorType: "NetBirdOpError",
    commonErrorClasses: ["UnknownNetBirdError"],
    protocol: "NetBirdProtocol",
    retry: "Retry.Retry",
  },
  sourceNote: "specs/openapi.yml",
  postProcess: (code) =>
    code.includes("Redacted.Redacted<")
      ? code.replace(
          `import * as S from "@distilled.cloud/core/schema-lite";\n`,
          `import * as S from "@distilled.cloud/core/schema-lite";\nimport * as Redacted from "effect/Redacted";\n`,
        )
      : code,
};

runGeneratorCli({
  description: "Generate the NetBird Effect SDK from the Smithy model",
  root: `${import.meta.dirname}/..`,
  // scripts/convert.ts already applied the patches.
  patchesDir: false,
  spec: () => spec,
});
