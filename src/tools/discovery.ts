import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  validateNetwork,
  createClient,
  createUserClient,
  listMethods,
  listProperties,
  discoverAnchorServices,
  discoverAnchorLibModules,
  KeetaNet,
  KeetaAnchor,
} from "./helpers.js";

export function registerDiscoveryTools(server: McpServer) {
  server.tool(
    "keeta_list_sdk_methods",
    `Discover available methods and properties on Keeta SDK objects at runtime. Use this FIRST to understand what operations are available before calling execute tools.

The "target" parameter accepts:

  Core SDK (fixed):
    "Client"      → read-only network queries
    "UserClient"  → authenticated operations
    "Builder"     → batch transaction builder
    "Account"     → account utilities + enums
    "Block"       → block types + operation enums
    "Permissions" → permission construction
    "Config"      → network configuration

  Anchor SDK (dynamic — auto-discovers new services):
    "AnchorCatalog"          → list ALL available anchor services and lib modules (start here!)
    "AnchorService:<Name>"   → methods on a specific anchor service client (e.g. "AnchorService:FX", "AnchorService:KYC", "AnchorService:AssetMovement", "AnchorService:Username", "AnchorService:Notification", or ANY new service the SDK adds)
    "AnchorLib:<Name>"       → methods on a specific anchor lib module (e.g. "AnchorLib:Resolver", "AnchorLib:Certificates", "AnchorLib:EncryptedContainer", "AnchorLib:URI", or ANY new module)

When in doubt, start with "AnchorCatalog" to see everything available, then drill into specific services/modules.`,
    {
      target: z
        .string()
        .describe(
          'SDK target to introspect. Fixed values: "Client", "UserClient", "Builder", "Account", "Block", "Permissions", "Config", "AnchorCatalog". Dynamic: "AnchorService:<Name>" or "AnchorLib:<Name>".'
        ),
      network: z
        .enum(["main", "test"])
        .default("test")
        .describe(
          "Network for instantiation (needed for Client/UserClient/Builder)"
        ),
    },
    async ({ target, network }) => {
      const net = validateNetwork(network);
      let methods: string[] = [];
      let properties: string[] = [];
      let statics: string[] = [];
      let enums: Record<string, unknown> = {};
      let extra: Record<string, unknown> = {};

      // ── Core SDK targets ─────────────────────────────────────────
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
          statics = Object.getOwnPropertyNames(
            KeetaNet.lib.Permissions.prototype
          ).filter((n) => n !== "constructor");
          break;
        }
        case "Config": {
          statics = Object.getOwnPropertyNames(KeetaNet.Client.Config).filter(
            (n) =>
              typeof (KeetaNet.Client.Config as any)[n] === "function"
          );
          break;
        }

        // ── Anchor Catalog (dynamic) ─────────────────────────────────
        case "AnchorCatalog": {
          const services = discoverAnchorServices();
          const libModules = discoverAnchorLibModules();

          const serviceDetails: Record<string, string[]> = {};
          for (const [name, ClientClass] of Object.entries(services)) {
            serviceDetails[name] = Object.getOwnPropertyNames(
              ClientClass.prototype
            ).filter(
              (n: string) => n !== "constructor" && !n.startsWith("_")
            );
          }

          const libDetails: Record<string, { type: string; members: string[] }> = {};
          for (const [name, mod] of Object.entries(libModules)) {
            if (typeof mod === "function") {
              // Class — show prototype methods + static methods
              const proto = mod.prototype
                ? Object.getOwnPropertyNames(mod.prototype).filter(
                    (n: string) => n !== "constructor"
                  )
                : [];
              const staticMethods = Object.getOwnPropertyNames(mod).filter(
                (n: string) =>
                  typeof mod[n] === "function" &&
                  n !== "prototype" &&
                  n !== "length" &&
                  n !== "name"
              );
              libDetails[name] = {
                type: "class",
                members: [...staticMethods.map((s: string) => `static:${s}`), ...proto],
              };
            } else if (typeof mod === "object" && mod !== null) {
              // Namespace — show exports
              const exports = Object.getOwnPropertyNames(mod).filter(
                (n: string) => n !== "default" && n !== "__esModule"
              );
              libDetails[name] = {
                type: "namespace",
                members: exports,
              };
            }
          }

          extra = {
            services: serviceDetails,
            libModules: libDetails,
            usage: {
              drillIntoService:
                'Use target "AnchorService:<Name>" (e.g. "AnchorService:FX") to see full method details',
              drillIntoLib:
                'Use target "AnchorLib:<Name>" (e.g. "AnchorLib:Resolver") to see full method details',
              executeService:
                'Use keeta_anchor_execute with subtarget "service" and serviceName "<Name>" to call service methods',
              executeLib:
                'Use keeta_anchor_execute with subtarget "lib" and libModule "<Name>" to call lib methods',
            },
          };
          break;
        }

        // ── Dynamic anchor service/lib targets ─────────────────────
        default: {
          if (target.startsWith("AnchorService:")) {
            const serviceName = target.slice("AnchorService:".length);
            const services = discoverAnchorServices();
            const ClientClass = services[serviceName];
            if (!ClientClass) {
              throw new Error(
                `Unknown anchor service "${serviceName}". Available: ${Object.keys(services).join(", ")}. Use target "AnchorCatalog" to see all.`
              );
            }
            statics = Object.getOwnPropertyNames(ClientClass.prototype).filter(
              (n) => n !== "constructor"
            );
            // Also check for static methods on the class itself
            const classMethods = Object.getOwnPropertyNames(ClientClass).filter(
              (n) =>
                typeof ClientClass[n] === "function" &&
                n !== "prototype" &&
                n !== "length" &&
                n !== "name"
            );
            if (classMethods.length > 0) {
              extra.classStaticMethods = classMethods;
            }
          } else if (target.startsWith("AnchorLib:")) {
            const moduleName = target.slice("AnchorLib:".length);
            const modules = discoverAnchorLibModules();
            const mod = modules[moduleName];
            if (!mod) {
              throw new Error(
                `Unknown anchor lib module "${moduleName}". Available: ${Object.keys(modules).join(", ")}. Use target "AnchorCatalog" to see all.`
              );
            }
            if (typeof mod === "function") {
              // It's a class
              methods = Object.getOwnPropertyNames(mod.prototype || {}).filter(
                (n) => n !== "constructor"
              );
              statics = Object.getOwnPropertyNames(mod).filter(
                (n) =>
                  typeof mod[n] === "function" &&
                  n !== "prototype" &&
                  n !== "length" &&
                  n !== "name"
              );
            } else if (typeof mod === "object" && mod !== null) {
              // It's a namespace — list its exports with their types
              for (const [k, v] of Object.entries(mod)) {
                if (k === "default" || k === "__esModule") continue;
                if (typeof v === "function") {
                  if (v.prototype && Object.getOwnPropertyNames(v.prototype).length > 1) {
                    // It's a class
                    const classMethods = Object.getOwnPropertyNames(
                      v.prototype
                    ).filter((n: string) => n !== "constructor");
                    statics.push(
                      `${k} [class: ${classMethods.join(", ")}]`
                    );
                  } else {
                    statics.push(`${k} [function]`);
                  }
                } else {
                  properties.push(`${k} [${typeof v}]`);
                }
              }
            }
          } else {
            throw new Error(
              `Unknown target "${target}". Use one of: Client, UserClient, Builder, Account, Block, Permissions, Config, AnchorCatalog, AnchorService:<Name>, AnchorLib:<Name>`
            );
          }
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
                ...(methods.length > 0 ? { methods } : {}),
                ...(properties.length > 0 ? { properties } : {}),
                ...(statics.length > 0 ? { statics } : {}),
                ...(Object.keys(enums).length > 0 ? { enums } : {}),
                ...(Object.keys(extra).length > 0 ? extra : {}),
                hint: 'Use keeta_client_execute, keeta_user_client_execute, keeta_builder_execute, or keeta_anchor_execute to call methods. Auto-resolved prefixes: keeta_ → Account, BIGINT: → BigInt, PERM: → Permissions, ALGO: → AccountKeyAlgorithm, ADJUST: → AdjustMethod, OP: → OperationType, BUFFER_B64: → Buffer.',
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
