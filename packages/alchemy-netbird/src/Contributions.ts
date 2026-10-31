import * as Contributions from "alchemy/Contributions";

/** What the Alchemy CLI loads from this package without a stack: the NetBird login. */
export default Contributions.make({
  name: "netbird",
  auth: Contributions.lazy(
    () => import("./AuthProvider.ts"),
    (module) => module.NetBirdAuth,
  ),
});
