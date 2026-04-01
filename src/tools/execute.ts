import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  validateNetwork,
  createClient,
  createUserClient,
  accountFromSeed,
  accountFromPublicKey,
  resolveArgs,
  resolveArg,
  formatResult,
  createAnchorServiceClient,
  getAnchorLibModule,
  discoverAnchorServices,
  discoverAnchorLibModules,
  KeetaNet,
  KeetaAnchor,
} from "./helpers.js";

export function registerExecuteTools(server: McpServer) {
  // ── Client Execute (read-only, no account needed) ──────────────────
  server.tool(
    "keeta_client_execute",
    `Execute any method on the Keeta Client (read-only network operations).

Use keeta_list_sdk_methods with target "Client" to discover available methods.

Common methods: getAccountInfo, getBalance, getAllBalances, getHeadBlock, getBlock, getHistory, getTokenSupply, getNetworkStatus, getPeers, getVersion, getLedgerChecksum, getAllCertificates, getAllRepresentativeInfo.

Arguments are auto-resolved:
  - Strings starting with "keeta_" become Account objects
  - "BIGINT:123" becomes BigInt(123)
  - "PERM:ACCESS,ADMIN" becomes a Permissions object
  - "ALGO:TOKEN" becomes AccountKeyAlgorithm.TOKEN
  - Plain strings, numbers, booleans, objects, arrays pass through as-is`,
    {
      network: z.enum(["main", "test"]).describe("Network to connect to"),
      method: z.string().describe("Method name to call on Client"),
      args: z
        .array(z.any())
        .default([])
        .describe("Arguments array — each element is auto-resolved"),
    },
    async ({ network, method, args }) => {
      const net = validateNetwork(network);
      const client = createClient(net);
      const fn = (client as any)[method];
      if (typeof fn !== "function") {
        throw new Error(
          `"${method}" is not a method on Client. Use keeta_list_sdk_methods to see available methods.`
        );
      }
      const resolved = resolveArgs(args);
      const result = await fn.apply(client, resolved);
      return {
        content: [{ type: "text", text: formatResult(result) }],
      };
    }
  );

  // ── UserClient Execute (authenticated, account-scoped) ─────────────
  server.tool(
    "keeta_user_client_execute",
    `Execute any method on the Keeta UserClient (authenticated operations requiring an account).

Use keeta_list_sdk_methods with target "UserClient" to discover available methods.

Common methods: allBalances, balance, head, chain, history, state, send, setInfo, generateIdentifier, updatePermissions, createSwapRequest, transmit, listACLsByPrincipal, getCertificates, modifyCertificate, sync.

Properties you can read (pass method "GET_PROPERTY" with args ["propertyName"]): baseToken, networkAddress, network, account, signer.

Arguments are auto-resolved (see keeta_client_execute for resolution rules).`,
    {
      network: z.enum(["main", "test"]).describe("Network to connect to"),
      seed: z
        .string()
        .optional()
        .describe("Seed of the account. Omit for read-only operations (null account)."),
      accountIndex: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Account derivation index"),
      method: z
        .string()
        .describe(
          'Method name to call on UserClient, or "GET_PROPERTY" to read a property'
        ),
      args: z
        .array(z.any())
        .default([])
        .describe("Arguments array — each element is auto-resolved"),
    },
    async ({ network, seed, accountIndex, method, args }) => {
      const net = validateNetwork(network);
      const account = seed ? accountFromSeed(seed, accountIndex) : null;
      await using userClient = createUserClient(net, account);

      // Special: read a property
      if (method === "GET_PROPERTY") {
        const propName = args[0] as string;
        const value = (userClient as any)[propName];
        // If it has .get(), call it (e.g. publicKeyString)
        const resolved =
          value && typeof value === "object" && typeof value.get === "function"
            ? value.get()
            : value;
        return {
          content: [{ type: "text", text: formatResult(resolved) }],
        };
      }

      const fn = (userClient as any)[method];
      if (typeof fn !== "function") {
        throw new Error(
          `"${method}" is not a method on UserClient. Use keeta_list_sdk_methods to see available methods.`
        );
      }
      const resolved = resolveArgs(args);
      const result = await fn.apply(userClient, resolved);
      return {
        content: [{ type: "text", text: formatResult(result) }],
      };
    }
  );

  // ── Builder Execute (batch operations → publish) ───────────────────
  server.tool(
    "keeta_builder_execute",
    `Execute a sequence of operations using the UserClient Builder pattern, then optionally compute and publish.

The builder batches multiple operations into blocks for efficient on-chain execution. Each operation in the "operations" array is an object with "method" and "args".

Use keeta_list_sdk_methods with target "Builder" to discover available methods.

Common builder methods: send, setInfo, modifyTokenSupply, modifyTokenBalance, computeBlocks, receive.

The tool will:
1. Create a UserClient and initialize a builder
2. Call each operation in sequence
3. If autoPublish is true (default): call computeBlocks() then publish()
4. Return all computed block hashes

Example operations:
  [
    { "method": "setInfo", "args": [{ "name": "TKNA", "description": "My Token" }], "options": { "account": "keeta_..." } },
    { "method": "modifyTokenSupply", "args": ["BIGINT:50000000000"], "options": { "account": "keeta_..." } },
    { "method": "send", "args": ["keeta_recipient...", "BIGINT:1000000", "keeta_token..."] }
  ]

Arguments are auto-resolved (see keeta_client_execute for resolution rules).
The "options" field in each operation is passed as the last argument (common for { account: tokenAddress }).`,
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      seed: z.string().describe("Seed of the account"),
      accountIndex: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Account derivation index"),
      operations: z
        .array(
          z.object({
            method: z.string().describe("Builder method name"),
            args: z
              .array(z.any())
              .default([])
              .describe("Method arguments"),
            options: z
              .record(z.any())
              .optional()
              .describe(
                "Options object (e.g. { account: 'keeta_...' }) passed as final argument"
              ),
            computeAfter: z
              .boolean()
              .default(false)
              .describe(
                "If true, call computeBlocks() after this operation (useful for ordering dependencies like supply before send)"
              ),
          })
        )
        .describe("Sequence of builder operations"),
      autoPublish: z
        .boolean()
        .default(true)
        .describe("Automatically compute and publish blocks after all operations"),
    },
    async ({ network, seed, accountIndex, operations, autoPublish }) => {
      const net = validateNetwork(network);
      const account = accountFromSeed(seed, accountIndex);
      await using userClient = createUserClient(net, account);
      const builder = (userClient as any).initBuilder();

      for (const op of operations) {
        const fn = builder[op.method];
        if (typeof fn !== "function") {
          throw new Error(
            `"${op.method}" is not a method on Builder. Use keeta_list_sdk_methods with target "Builder" to see available methods.`
          );
        }
        const resolved = resolveArgs(op.args);
        if (op.options) {
          resolved.push(resolveArg(op.options));
        }
        await fn.apply(builder, resolved);

        if (op.computeAfter) {
          await builder.computeBlocks();
        }
      }

      if (autoPublish) {
        await builder.computeBlocks();
        await builder.publish();
      }

      const blockHashes = (builder.blocks || []).map((b: any) =>
        b.hash?.toString?.() ?? String(b.hash)
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                account: account.publicKeyString.get(),
                operationCount: operations.length,
                blocksPublished: blockHashes.length,
                blockHashes,
                status: autoPublish ? "published" : "built_not_published",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── Anchor Execute (fully dynamic — auto-discovers services & lib) ──
  server.tool(
    "keeta_anchor_execute",
    `Execute ANY anchor operation on the Keeta Network. Fully dynamic — auto-discovers services and lib modules from the SDK at runtime.

subtarget types:
  - "service" → call a method on any anchor service client (FX, KYC, AssetMovement, Username, Notification, or ANY future service). Set serviceName to the service name.
  - "lib" → call a method/function on any anchor lib module (Resolver, Certificates, EncryptedContainer, URI, or ANY future module). Set libModule to the module name.
  - "metadata" → shortcut to call Resolver.Metadata static methods (formatMetadata, fullyResolveValuizable)

Use keeta_list_sdk_methods with target "AnchorCatalog" to discover all available services and lib modules.
Use "AnchorService:<Name>" or "AnchorLib:<Name>" to drill into specific ones.

Arguments are auto-resolved (see keeta_client_execute for resolution rules).`,
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      seed: z
        .string()
        .optional()
        .describe("Seed of the account. Omit for read-only operations."),
      accountIndex: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Account derivation index"),
      subtarget: z
        .enum(["service", "lib", "metadata"])
        .describe('Type of anchor operation: "service" for service clients, "lib" for lib modules, "metadata" for Resolver.Metadata shortcuts'),
      serviceName: z
        .string()
        .optional()
        .describe(
          'Required when subtarget is "service". The anchor service name (e.g. "FX", "KYC", "AssetMovement", "Username", "Notification", or any new service). Use keeta_list_sdk_methods with target "AnchorCatalog" to see available services.'
        ),
      libModule: z
        .string()
        .optional()
        .describe(
          'Required when subtarget is "lib". The lib module name (e.g. "Resolver", "Certificates", "EncryptedContainer", "URI", or any new module). Use keeta_list_sdk_methods with target "AnchorCatalog" to see available modules.'
        ),
      method: z.string().describe("Method name to call on the target"),
      args: z
        .array(z.any())
        .default([])
        .describe("Arguments array — each element is auto-resolved"),
      rootAddress: z
        .string()
        .optional()
        .describe(
          "Anchor root account address. Defaults to the network root."
        ),
    },
    async ({
      network,
      seed,
      accountIndex,
      subtarget,
      serviceName,
      libModule,
      method,
      args,
      rootAddress,
    }) => {
      const net = validateNetwork(network);
      const account = seed ? accountFromSeed(seed, accountIndex) : null;
      await using userClient = KeetaAnchor.KeetaNet.UserClient.fromNetwork(
        net,
        account as any
      );

      const root = rootAddress
        ? accountFromPublicKey(rootAddress)
        : (userClient as any).networkAddress;

      const resolved = resolveArgs(args);
      let result: unknown;

      switch (subtarget) {
        case "service": {
          if (!serviceName) {
            const available = Object.keys(discoverAnchorServices());
            throw new Error(
              `serviceName is required when subtarget is "service". Available: ${available.join(", ")}`
            );
          }
          const client = createAnchorServiceClient(serviceName, userClient, {
            root,
          });
          const fn = (client as any)[method];
          if (typeof fn !== "function") {
            // Also check for sub-objects like client.resolver
            for (const subProp of ["resolver"]) {
              const sub = (client as any)[subProp];
              if (sub && typeof sub[method] === "function") {
                result = await sub[method].apply(sub, resolved);
                return {
                  content: [{ type: "text", text: formatResult(result) }],
                };
              }
            }
            throw new Error(
              `"${method}" is not a method on ${serviceName}.Client. Use keeta_list_sdk_methods with target "AnchorService:${serviceName}" to see available methods.`
            );
          }
          result = await fn.apply(client, resolved);
          break;
        }

        case "lib": {
          if (!libModule) {
            const available = Object.keys(discoverAnchorLibModules());
            throw new Error(
              `libModule is required when subtarget is "lib". Available: ${available.join(", ")}`
            );
          }
          const mod = getAnchorLibModule(libModule);

          if (typeof mod === "function") {
            // It's a class — try static method first, then construct+call
            if (typeof mod[method] === "function") {
              result = await mod[method].apply(mod, resolved);
            } else if (
              mod.prototype &&
              typeof mod.prototype[method] === "function"
            ) {
              const instance = new mod(resolved[0]);
              result = await instance[method].apply(
                instance,
                resolved.slice(1)
              );
            } else {
              throw new Error(
                `"${method}" is not a method on ${libModule}. Use keeta_list_sdk_methods with target "AnchorLib:${libModule}".`
              );
            }
          } else if (typeof mod === "object" && mod !== null) {
            // It's a namespace — look for function or nested class
            const fn = mod[method];
            if (typeof fn === "function") {
              result = await fn.apply(mod, resolved);
            } else {
              // Search for method in sub-classes of the namespace
              let found = false;
              for (const [, v] of Object.entries(mod)) {
                if (
                  typeof v === "function" &&
                  v.prototype &&
                  typeof v.prototype[method] === "function"
                ) {
                  const instance = new (v as any)(resolved[0]);
                  result = await instance[method].apply(
                    instance,
                    resolved.slice(1)
                  );
                  found = true;
                  break;
                }
              }
              if (!found) {
                throw new Error(
                  `"${method}" is not a method on ${libModule}. Use keeta_list_sdk_methods with target "AnchorLib:${libModule}".`
                );
              }
            }
          } else {
            throw new Error(`Lib module "${libModule}" is not an object or class.`);
          }
          break;
        }

        case "metadata": {
          const fn = (KeetaAnchor.lib.Resolver.Metadata as any)[method];
          if (typeof fn !== "function") {
            throw new Error(
              `"${method}" is not a static method on Resolver.Metadata. Use keeta_list_sdk_methods with target "AnchorLib:Resolver".`
            );
          }
          result = await fn.apply(KeetaAnchor.lib.Resolver.Metadata, resolved);
          break;
        }
      }

      return {
        content: [{ type: "text", text: formatResult(result) }],
      };
    }
  );
}
