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
  Core SDK:
  - "Client" → read-only network client (getAccountInfo, getBalance, getAllBalances, getHeadBlock, getBlock, etc.)
  - "UserClient" → authenticated client (send, setInfo, generateIdentifier, allBalances, head, chain, updatePermissions, createSwapRequest, etc.)
  - "Builder" → transaction builder from UserClient.initBuilder() (send, setInfo, modifyTokenSupply, computeBlocks, publish, etc.)
  - "Account" → static methods on KeetaNet.lib.Account (generateRandomSeed, fromSeed, fromPublicKeyString, generateNetworkAddress, etc.)
  - "Block" → static Block utilities (Builder, OperationType, NO_PREVIOUS, etc.)
  - "Permissions" → Permissions class
  - "Config" → network configuration (getDefaultConfig, etc.)

  Anchor SDK — Services:
  - "AnchorFXClient" → FX/swap client (getQuotes, listPossibleConversions, createExchange, etc.)
  - "AnchorKYCClient" → KYC identity verification client (createVerification, getCertificates, getSupportedCountries)
  - "AnchorAssetMovementClient" → cross-chain/cross-rail asset transfer client (getProvidersForTransfer, initiateTransfer, createPersistentForwardingAddress, listTransactions, shareKYCAttributes, etc.)
  - "AnchorUsernameClient" → on-chain username management client (resolve, claimUsername, releaseUsername, search, resolveMulti)
  - "AnchorNotificationClient" → push notification client (registerTarget, listTargets, deleteTarget, createSubscription, listSubscriptions, deleteSubscription)

  Anchor SDK — Lib:
  - "AnchorResolver" → anchor metadata resolver (getRootMetadata, lookup, etc.)
  - "AnchorMetadata" → anchor metadata utilities (formatMetadata, fullyResolveValuizable, etc.)
  - "AnchorCertificates" → X.509 certificate utilities for KYC/identity
  - "AnchorEncryptedContainer" → encrypted data container for sensitive attributes
  - "AnchorURI" → URI parsing and construction utilities`,
    {
      target: z
        .enum([
          "Client",
          "UserClient",
          "Builder",
          "Account",
          "Block",
          "Permissions",
          "Config",
          "AnchorFXClient",
          "AnchorKYCClient",
          "AnchorAssetMovementClient",
          "AnchorUsernameClient",
          "AnchorNotificationClient",
          "AnchorResolver",
          "AnchorMetadata",
          "AnchorCertificates",
          "AnchorEncryptedContainer",
          "AnchorURI",
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
        case "AnchorKYCClient": {
          statics = Object.getOwnPropertyNames(
            KeetaAnchor.KYC.Client.prototype
          ).filter((n) => n !== "constructor");
          break;
        }
        case "AnchorAssetMovementClient": {
          statics = Object.getOwnPropertyNames(
            KeetaAnchor.AssetMovement.Client.prototype
          ).filter((n) => n !== "constructor");
          break;
        }
        case "AnchorUsernameClient": {
          statics = Object.getOwnPropertyNames(
            KeetaAnchor.Username.Client.prototype
          ).filter((n) => n !== "constructor");
          break;
        }
        case "AnchorNotificationClient": {
          statics = Object.getOwnPropertyNames(
            KeetaAnchor.Notification.Client.prototype
          ).filter((n) => n !== "constructor");
          break;
        }
        case "AnchorCertificates": {
          statics = Object.getOwnPropertyNames(KeetaAnchor.lib.Certificates).filter(
            (n) => typeof (KeetaAnchor.lib.Certificates as any)[n] === "function"
          );
          // Also show Certificate class methods if available
          if ((KeetaAnchor.lib.Certificates as any).Certificate?.prototype) {
            methods = Object.getOwnPropertyNames(
              (KeetaAnchor.lib.Certificates as any).Certificate.prototype
            ).filter((n) => n !== "constructor");
          }
          break;
        }
        case "AnchorEncryptedContainer": {
          if (KeetaAnchor.lib.EncryptedContainer?.prototype) {
            methods = Object.getOwnPropertyNames(
              KeetaAnchor.lib.EncryptedContainer.prototype
            ).filter((n) => n !== "constructor");
          }
          statics = Object.getOwnPropertyNames(KeetaAnchor.lib.EncryptedContainer).filter(
            (n) =>
              typeof (KeetaAnchor.lib.EncryptedContainer as any)[n] === "function"
          );
          break;
        }
        case "AnchorURI": {
          statics = Object.getOwnPropertyNames(KeetaAnchor.lib.URI).filter(
            (n) => typeof (KeetaAnchor.lib.URI as any)[n] === "function"
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
