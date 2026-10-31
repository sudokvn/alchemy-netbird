/** What the test server holds before the first test runs (see globalSetup.ts). */
export const GROUPS = ["admins", "servers", "monitoring"] as const;
export const PEERS = ["peer-a", "peer-b"] as const;

declare module "vitest" {
  export interface ProvidedContext {
    /** The throwaway server's address and its owner's API token. */
    netbird: { url: string; token: string };
  }
}
