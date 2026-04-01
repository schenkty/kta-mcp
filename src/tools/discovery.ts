import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  validateNetwork,
  createClient,
  createUserClient,
  listMethods,
  listProperties,
  KeetaNet,
  KeetaAnchor,
} from "./helpers.js";

export function registerDiscoveryTools(server: McpServer) {
  server.tool(
    "keeta_list_sdk_methods",
    `Discover available methods and properties on Keeta SDK objects at runtime. Use this FIRST to understand what operations are available before calling execute tools.

Targets:
  - "Client" → read-only network client (getAccountInfo, getBalance, getAllBalances, getHeadBlock, getBlock, etc.)
  - "UserClient" → authenticated client (send, setInfo, generateIdentifier, allBalances, head, chain, updatePermissions, createSwapRequest, etc.)
  - "Builder" → transaction builder from UserClient.initBuilder() (send, setInfo, modifyTokenSupply, computeBlocks, publish, etc.)
  - "Account" → static methods on KeetaNet.lib.Account (generateRandomSeed, fromSeed, fromPublicKeyString, generateNetworkAddress, etc.)
  - "Block" → static Block utilities (Builder, OperationType, NO_PREVIOUS, etc.)
  - "Permissions" → Permissions class
  - "AnchorResolver" → anchor metadata resolver (getRootMetadata, etc.)
  - "AnchorFXClient" → FX anchor client (getQuotes, listPossibleConversions, etc.)
  - "AnchorMetadata" → anchor metadata utilities (formatMetadata, fullyResolveValuizable, etc.)
  - "Config" → network configuration (getDefaultConfig, etc.)`,
    {
      target: z
        .enum([
          "Client",
          "UserClient",
          "Builder",
          "Account",
          "Block",
          "Permissions",
          "AnchorResolver",
          "AnchorFXClient",
          "AnchorMetadata",
          "Config",
        ])
        .describe("SDK object to introspect"),
      network: z
        .enum(["main", "test"])
        .default("test")
        .describe("Network to use for instantiation (needed for Client/UserClient/Builder targets)"),
    },
    async ({ target, network }) => {
      const net = validateNetwork(network);
      let methods: string[] = [];
      let properties: string[] = [];
      let statics: string[] = [];
      let enums: Record<string, unknown> = {};

      switch (target) {
        case "Client": {
          const client = createClient(net);
          methods = listMethods(client);
          properties = listProperties(client);
          break;
        }
        case "UserClient": {
          const uc = createUserClient(net, null);
          methods = listMethods(uc);
          properties = listProperties(uc);
          await (uc as any).destroy?.();
          break;
        }
        case "Builder": {
          const uc = createUserClient(net, null);
          const builder = (uc as any).initBuilder();
          methods = listMethods(builder);
          properties = listProperties(builder);
          await (uc as any).destroy?.();
          break;
        }
        case "Account": {
          statics = Object.getOwnPropertyNames(KeetaNet.lib.Account).filter(
            (n) => typeof (KeetaNet.lib.Account as any)[n] === "function"
          );
          enums = {
            AccountKeyAlgorithm: Object.fromEntries(
              Object.entries(KeetaNet.lib.Account.AccountKeyAlgorithm)
            ),
          };
          break;
        }
        case "Block": {
          statics = Object.getOwnPropertyNames(KeetaNet.lib.Block).filter(
            (n) => n !== "prototype" && n !== "length" && n !== "name"
          );
          enums = {
            OperationType: Object.fromEntries(
              Object.entries(KeetaNet.lib.Block.OperationType)
            ),
            AdjustMethod: Object.fromEntries(
              Object.entries(KeetaNet.lib.Block.AdjustMethod)
            ),
          };
          break;
        }
        case "Permissions": {
          // Show how to construct permissions
          statics = Object.getOwnPropertyNames(
            KeetaNet.lib.Permissions.prototype
          ).filter((n) => n !== "constructor");
          break;
        }
        case "AnchorResolver": {
          statics = Object.getOwnPropertyNames(
            KeetaAnchor.lib.Resolver.prototype
          ).filter((n) => n !== "constructor");
          const metadataStatics = Object.getOwnPropertyNames(
            KeetaAnchor.lib.Resolver.Metadata
          ).filter(
            (n) =>
              typeof (KeetaAnchor.lib.Resolver.Metadata as any)[n] ===
              "function"
          );
          properties = metadataStatics;
          break;
        }
        case "AnchorFXClient": {
          statics = Object.getOwnPropertyNames(
            KeetaAnchor.FX.Client.prototype
          ).filter((n) => n !== "constructor");
          break;
        }
        case "AnchorMetadata": {
          statics = Object.getOwnPropertyNames(
            KeetaAnchor.lib.Resolver.Metadata
          ).filter(
            (n) =>
              typeof (KeetaAnchor.lib.Resolver.Metadata as any)[n] ===
              "function"
          );
          break;
        }
        case "Config": {
          statics = Object.getOwnPropertyNames(KeetaNet.Client.Config).filter(
            (n) =>
              typeof (KeetaNet.Client.Config as any)[n] === "function"
          );
          break;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                target,
                methods: methods.length > 0 ? methods : undefined,
                properties: properties.length > 0 ? properties : undefined,
                statics: statics.length > 0 ? statics : undefined,
                enums:
                  Object.keys(enums).length > 0 ? enums : undefined,
                hint: "Use keeta_client_execute, keeta_user_client_execute, keeta_builder_execute, or keeta_anchor_execute to call these methods. Arguments that look like Keeta addresses (keeta_...) are auto-resolved to Account objects. Use prefixes for special types: BIGINT:123, PERM:ACCESS,ADMIN, ALGO:TOKEN, ADJUST:SET, OP:SEND, BUFFER_B64:...",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
