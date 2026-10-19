/**
 * The one upstream revision this adapter release was tested against.
 * Adapter semantic versions move independently of these values.
 */
export const CERTIFIED = {
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  commit: "d457567332aa6989e753ea289f30ea2bfbc80bc0",
  pluginPath: "pstack",
  pstackVersion: "0.15.28",
  skillCount: 56,
  agentCount: 2,
} as const;
