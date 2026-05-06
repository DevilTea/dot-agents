AGENT_RUNTIME=opencode-remote-lmstudio
AGENT_MODEL_SWITCHING=disabled
AGENT_MAX_CONCURRENT_SUBAGENTS=2

For LM Studio stability:

- Avoid subagents unless necessary.
- Keep responses concise.
- Do not expose reasoning traces.
- Use valid opencode tool-call XML only when calling tools.
