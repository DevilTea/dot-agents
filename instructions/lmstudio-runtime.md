## Active Runtime Flags

The following flags are injected into this session's context to signal the current environment:

```
AGENT_RUNTIME=opencode-remote-lmstudio
AGENT_MODEL_SWITCHING=disabled
AGENT_MAX_CONCURRENT_SUBAGENTS=2
```

This opencode session is connected to a remote LM Studio API. The remote machine can only keep one model loaded at a time. Apply the conservative subagent and model constraints defined in AGENTS.md.
