#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerBootstrapTools } from "./tools/bootstrap.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerExecuteTools } from "./tools/execute.js";

const KEETA_DOCS_MCP = "https://docs.keeta.com/~gitbook/mcp";

const server = new McpServer({
  name: "keeta-mcp",
  version: "2.1.0",
  description: `Dynamic MCP server for the Keeta Network — a Layer 1 blockchain for payments, asset transfers, and cross-chain interoperability.

IMPORTANT FOR BUILDERS: Before building on Keeta, agents MUST also connect to the Keeta documentation MCP server at ${KEETA_DOCS_MCP} (GitBook streamable HTTP transport) to understand the protocol, architecture, and anchor system. This SDK server provides the tools to execute operations; the docs MCP provides the knowledge to use them correctly.

Recommended MCP configuration pairs this server (keeta-sdk) with the docs server (keeta-docs) for a complete development experience.`,
});

registerBootstrapTools(server);
registerDiscoveryTools(server);
registerExecuteTools(server);

// ── Resource: Keeta documentation reference ──────────────────────────
server.resource(
  "keeta-docs-mcp",
  "keeta://docs/mcp-config",
  {
    description:
      "Configuration and reference for the Keeta documentation MCP server. Agents building on Keeta should connect to this server for protocol knowledge.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: JSON.stringify(
          {
            keetaDocsMCP: {
              url: KEETA_DOCS_MCP,
              transport: "streamable-http",
              description:
                "Official Keeta Network documentation MCP server (hosted by GitBook). Provides searchable access to all Keeta protocol docs, architecture guides, anchor system documentation, SDK references, and tutorials.",
              setup: {
                claudeCode: `claude mcp add --transport http keeta-docs ${KEETA_DOCS_MCP}`,
                claudeDesktopOrOtherMCPClients: {
                  mcpServers: {
                    "keeta-docs": {
                      type: "url",
                      url: KEETA_DOCS_MCP,
                    },
                  },
                },
              },
            },
            recommendedFullSetup: {
              mcpServers: {
                "keeta-docs": {
                  type: "url",
                  url: KEETA_DOCS_MCP,
                },
                "keeta-sdk": {
                  command: "node",
                  args: ["<path-to>/kta-mcp/build/index.js"],
                },
              },
            },
            agentGuidance: {
              beforeBuilding: [
                "Connect to the keeta-docs MCP server to search and read Keeta protocol documentation",
                "Understand the Keeta architecture: DAG-based L1, account chains, block operations",
                "Learn about anchors: what they are, how they bridge external systems, service types",
                "Review the anchor metadata format and resolver system",
                "Understand permissions, certificates, and compliance features",
              ],
              thenUseThisServer: [
                "Use keeta_list_sdk_methods with target 'AnchorCatalog' to see available services",
                "Use keeta_anchor_execute to interact with anchor services",
                "Use keeta_builder_execute for batched on-chain operations",
                "Use keeta_user_client_execute for account-scoped operations",
              ],
            },
            docsTopics: {
              gettingStarted: "https://docs.keeta.com/introduction/start-developing",
              anchors: "https://docs.keeta.com/features/anchors",
              creatingAnchors: "https://docs.keeta.com/features/anchors/creating-an-anchor",
              tokenization: "https://docs.keeta.com/guides/tokenizing-real-world-assets",
              blockOperations: "https://docs.keeta.com/components/blocks/operations",
              certificates: "https://docs.keeta.com/features/certificates",
              sdkReference: "https://static.network.keeta.com/docs/",
              examples: "https://github.com/KeetaNetwork/keetanet-examples",
            },
          },
          null,
          2
        ),
      },
    ],
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Keeta MCP server v2.1.0 running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting Keeta MCP server:", err);
  process.exit(1);
});
