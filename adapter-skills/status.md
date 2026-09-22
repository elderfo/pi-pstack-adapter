# pstack adapter status

Report what the adapter is actually running, so nobody has to guess whether a pstack workflow
is verified here.

1. Call the adapter tool with `action: "status"`.
2. Show the user the full report. Do not summarize away the trust line, the resolved commit, or
   any `error` diagnostic.
3. If a capability is missing, name the capability, name the workflows it gates, and give the
   install command from the report.
4. If any diagnostic is an `error`, say which upstream resource failed and that the adapter
   skipped it.

To check one workflow before starting it, call the tool with `action: "check"` and the skill
name. That reports the capabilities and executables that workflow needs and whether this
environment has them, before the workflow does any work.

Support tiers mean this.

| tier | meaning |
| --- | --- |
| `native` | adapter-owned content, written for Pi |
| `adapted` | upstream body works once you apply the host mapping |
| `dependency-gated` | needs a capability or an executable that may be absent |
| `experimental` | depends on host behavior with no clean Pi equivalent, may partly work |
| `unsupported` | needs something Pi cannot provide; the workflow cannot reach its purpose |

A tier is a claim about what the adapter verified, not a promise about a given run.
