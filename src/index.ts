#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerBootstrapTools } from "./tools/bootstrap.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerExecuteTools } from "./tools/execute.js";

const server = new McpServer({
  name: "keeta-mcp",
  version: "2.0.0",
  description:
    "Dynamic MCP server for the Keeta Network — a Layer 1 blockchain for payments, asset transfers, and cross-chain interoperability. Provides runtime-introspectable tools that auto-adapt to SDK changes. Supports account management, native tokenization, atomic swaps, anchors (cross-chain bridges to SWIFT/ACH/other blockchains), FX operations, permissions, and certificates.",
});

registerBootstrapTools(server);
registerDiscoveryTools(server);
registerExecuteTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Keeta MCP server v2.0.0 running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting Keeta MCP server:", err);
  process.exit(1);
});
