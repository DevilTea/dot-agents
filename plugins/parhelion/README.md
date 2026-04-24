# Parhelion Plugin

## VS Code Settings

The following settings **must** be configured for Orbit to function correctly:

```jsonc
{
  // Required: enable plugin support in Copilot Chat so that the Orbit agent
  // is discovered and available in the chat panel.
  "chat.plugins.enabled": true,

  // Required: Specify the marketplaces where the Orbit plugin can be found.
  "chat.plugins.marketplaces": [
    // other marketplaces ...
    "DevilTea/dot-agents",
  ],

  // Required: allows subagents (Orbit Round, Planner, Execute, etc.) to invoke
  // their own nested subagents. Without this, the Round cannot dispatch Planner,
  // Execute, Review, or Next Advisor.
  "chat.subagents.allowInvocationsFromSubagents": true,
}
```
