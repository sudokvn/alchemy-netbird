/**
 * NetBirdProtocol -- hand-written.
 *
 * NetBird speaks token-authenticated JSON REST without a response envelope, so the protocol is
 * one `makeRestProtocol` call:
 *
 *   request:  `Authorization: Token <token>` and the base URL from the credentials, resolved on
 *             the calling fiber for every request
 *   response: a 2xx JSON body is the payload, with sensitive members delivered as `Redacted`;
 *             a non-2xx `{ message, code }` body maps to the typed error classes by status, then
 *             to {@link UnknownNetBirdError}
 */
import type * as API from "@distilled.cloud/core/api";
import type { API_ERRORS, ConfigError } from "@distilled.cloud/core/errors";
import { makeRestProtocol } from "@distilled.cloud/core/protocol-rest";
import * as Effect from "effect/Effect";
import type * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import type * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { Credentials, type Config } from "./credentials.ts";
import { NetBirdParseError, UnknownNetBirdError } from "./errors.ts";

/** Error channel shared by every generated NetBird operation. */
export type NetBirdOpError =
  | InstanceType<(typeof API_ERRORS)[number]>
  | UnknownNetBirdError
  | ConfigError
  | HttpClientError.HttpClientError
  | NetBirdParseError;

/** Requirements shared by every generated NetBird operation. */
export type NetBirdOpContext = Credentials | HttpClient.HttpClient;

export const NetBirdProtocol: Layer.Layer<API.Protocol> = /*@__PURE__*/ makeRestProtocol<Config>({
  credentials: /*@__PURE__*/ Effect.flatMap(Credentials, (resolve) => resolve),
  baseUrl: (credentials) => credentials.apiBaseUrl,
  headers: (credentials) => ({
    Authorization: `Token ${Redacted.value(credentials.apiToken)}`,
  }),
  // NetBird's error body is `{ message, code }`, which the default envelope reads.
  unknownError: ({ code, message, body }) =>
    new UnknownNetBirdError({
      code: typeof code === "string" ? code : code !== undefined ? String(code) : undefined,
      message,
      body,
    }),
  parseError: ({ body, cause }) => new NetBirdParseError({ body, cause }),
});
