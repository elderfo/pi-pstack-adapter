/**
 * The one upstream revision this adapter release was tested against.
 * Adapter semantic versions move independently of these values.
 */
export const CERTIFIED = {
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  commit: "e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a",
  pluginPath: "pstack",
  pstackVersion: "0.15.9",
  skillCount: 50,
  agentCount: 2,
} as const;
