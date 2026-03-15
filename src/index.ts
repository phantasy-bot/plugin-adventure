import { BasePlugin, type PluginTool } from "@phantasy/agent/plugins";

export class AdventurePlugin extends BasePlugin {
  name = "adventure";
  version = "2.0.0";
  description = "Interactive adventure runtime plugin for Phantasy companions.";

  protected displayName = "Adventure";
  protected category = "games";
  protected tags = ["adventure","story","interactive","companion"];
  protected permissions = [];
  protected workspace = "character" as const;
  protected extensionKind = "behavior" as const;
  protected adminSurface =   {
    "tabId": "adventure",
    "label": "Adventure",
    "section": "character",
    "workspace": "character",
    "kind": "generic",
    "keywords": [
      "adventure",
      "story",
      "interactive",
      "companion"
    ]
  } as const;
  protected configSchema =   {
    "type": "object",
    "properties": {
      "enabled": {
        "type": "boolean",
        "default": true
      }
    }
  };

  getTools(): PluginTool[] {
    return [];
  }
}

export default AdventurePlugin;
