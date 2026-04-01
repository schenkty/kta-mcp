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

  // ── Anchor Execute (resolver, FX, metadata) ────────────────────────
  server.tool(
    "keeta_anchor_execute",
    `Execute anchor and FX operations on the Keeta Network.

Subtargets:
  - "resolver" → call methods on AnchorResolver (getRootMetadata, etc.)
  - "fx_client" → call methods on FX.Client (getQuotes, listPossibleConversions, createExchange, etc.)
  - "metadata" → call static methods on Resolver.Metadata (formatMetadata, fullyResolveValuizable, etc.)

Use keeta_list_sdk_methods with targets "AnchorResolver", "AnchorFXClient", or "AnchorMetadata" to discover methods.

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
        .enum(["resolver", "fx_client", "metadata"])
        .describe("Which anchor subsystem to operate on"),
      method: z.string().describe("Method name to call"),
      args: z
        .array(z.any())
        .default([])
        .describe("Arguments array"),
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
        case "resolver": {
          const resolver = new KeetaAnchor.lib.Resolver({
            root,
            client: userClient,
            trustedCAs: [],
          });
          const fn = (resolver as any)[method];
          if (typeof fn !== "function") {
            throw new Error(
              `"${method}" is not a method on Resolver. Use keeta_list_sdk_methods with target "AnchorResolver".`
            );
          }
          result = await fn.apply(resolver, resolved);
          break;
        }
        case "fx_client": {
          const fxClient = new KeetaAnchor.FX.Client(userClient, { root });
          const fn = (fxClient as any)[method];
          if (typeof fn !== "function") {
            // Also check fxClient.resolver
            const resolverFn = (fxClient as any).resolver?.[method];
            if (typeof resolverFn === "function") {
              result = await resolverFn.apply(
                (fxClient as any).resolver,
                resolved
              );
              break;
            }
            throw new Error(
              `"${method}" is not a method on FX.Client. Use keeta_list_sdk_methods with target "AnchorFXClient".`
            );
          }
          result = await fn.apply(fxClient, resolved);
          break;
        }
        case "metadata": {
          const fn = (KeetaAnchor.lib.Resolver.Metadata as any)[method];
          if (typeof fn !== "function") {
            throw new Error(
              `"${method}" is not a static method on Resolver.Metadata. Use keeta_list_sdk_methods with target "AnchorMetadata".`
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
