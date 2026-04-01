#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerTokenTools } from "./tools/tokens.js";
import { registerTransactionTools } from "./tools/transactions.js";
import { registerAnchorTools } from "./tools/anchors.js";
import { registerNetworkTools } from "./tools/network.js";

const server = new McpServer({
  name: "keeta-mcp",
  version: "1.0.0",
  description:
    "MCP server for the Keeta Network — manage accounts, tokens, transactions, anchors, and FX operations on the KeetaNet L1 blockchain.",
});

registerAccountTools(server);
registerTokenTools(server);
registerTransactionTools(server);
registerAnchorTools(server);
registerNetworkTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Keeta MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting Keeta MCP server:", err);
  process.exit(1);
});
