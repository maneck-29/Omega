/**
 * OpenNext configuration for the Omega deploy adapter (see omega.jsonc).
 *
 * The node wrapper and converter run the Next.js server as a plain Node handler
 * rather than the default Lambda-shaped one.
 */
const config = {
  default: { override: { wrapper: "node", converter: "node" } },
};

export default config;
