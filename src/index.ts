import { BasePlugin, PluginManifest, PluginTool } from "@phantasy/core";

export class UadventurePlugin extends BasePlugin {
  readonly name = "adventure";
  readonly version = "1.0.0";

  getManifest(): PluginManifest {
    return {
      name: this.name,
      version: this.version,
      description: "adventure plugin for Phantasy",
      author: "Phantasy",
      license: "BUSL-1.1",
      repository: "https://github.com/phantasy-bot/plugin-adventure",
    };
  }

  getTools(): PluginTool[] {
    return [];
  }

  async initialize(): Promise<void> {
    console.log("[UadventurePlugin] Initialized");
  }
}

export default UadventurePlugin;
