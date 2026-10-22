/**
 * The one upstream revision this adapter release was tested against.
 * Adapter semantic versions move independently of these values.
 */
export const CERTIFIED = {
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  commit: "eb4db2b55b2b7dec3d9282754cddf0a56bf4ff10",
  pluginPath: "pstack",
  pstackVersion: "0.15.30",
  skillCount: 57,
  agentCount: 2,
} as const;
