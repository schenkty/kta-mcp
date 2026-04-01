import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  accountFromSeed,
  accountFromPublicKey,
  validateNetwork,
  createUserClient,
  createClient,
  formatResult,
  KeetaNet,
} from "./helpers.js";

export function registerTransactionTools(server: McpServer) {
  server.tool(
    "keeta_get_block",
    "Fetch a specific block by its hash from an account's chain.",
    {
      network: z.enum(["main", "test"]).describe("Network to query"),
      address: z.string().describe("Account address whose chain to query"),
      blockHash: z.string().describe("Block hash to retrieve"),
    },
    async ({ network, address, blockHash }) => {
      const net = validateNetwork(network);
      const client = createClient(net);
      const block = await client.getBlock(address, blockHash as any);
      return {
        content: [{ type: "text", text: formatResult(block) }],
      };
    }
  );

  server.tool(
    "keeta_get_chain_info",
    "Get chain information for the connected network including network ID, version, and capabilities.",
    {
      network: z.enum(["main", "test"]).describe("Network to query"),
    },
    async ({ network }) => {
      const net = validateNetwork(network);
      await using userClient = createUserClient(net, null);
      const chainInfo = await userClient.chain();
      return {
        content: [{ type: "text", text: formatResult(chainInfo) }],
      };
    }
  );

  server.tool(
    "keeta_create_swap_request",
    "Create an atomic swap request between two tokens. This builds a swap block that can be used for peer-to-peer or anchor-based exchanges. The swap is atomic — either both sides complete or neither does.",
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      seed: z.string().describe("Seed of the initiating account"),
      index: z.number().int().min(0).describe("Account index"),
      fromToken: z
        .string()
        .describe("Token address you are sending"),
      fromAmount: z
        .string()
        .describe("Raw amount to send (already scaled by decimals)"),
      toAccount: z
        .string()
        .describe("Counterparty account address"),
      toToken: z
        .string()
        .describe("Token address you want to receive"),
      toAmount: z
        .string()
        .describe("Raw amount to receive (already scaled by decimals)"),
    },
    async ({
      network,
      seed,
      index,
      fromToken,
      fromAmount,
      toAccount,
      toToken,
      toAmount,
    }) => {
      const net = validateNetwork(network);
      const account = accountFromSeed(seed, index);
      await using userClient = createUserClient(net, account);

      const swapBlock = await userClient.createSwapRequest({
        from: {
          account,
          token: accountFromPublicKey(fromToken) as any,
          amount: BigInt(fromAmount),
        },
        to: {
          account: accountFromPublicKey(toAccount),
          token: accountFromPublicKey(toToken) as any,
          amount: BigInt(toAmount),
        },
      } as any);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "swap_request_created",
                blockHash: swapBlock.hash?.toString() ?? null,
                from: {
                  account: account.publicKeyString.get(),
                  token: fromToken,
                  amount: fromAmount,
                },
                to: {
                  account: toAccount,
                  token: toToken,
                  amount: toAmount,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "keeta_update_permissions",
    "Update permissions on an account or token. Can grant or revoke permissions for a principal (another account). Common permissions: ACCESS, ADMIN, SEND, RECEIVE.",
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      seed: z.string().describe("Seed of the account that owns the target"),
      index: z.number().int().min(0).describe("Account index"),
      targetAddress: z
        .string()
        .describe("The account/token to modify permissions on"),
      principalAddress: z
        .string()
        .describe("The account to grant/revoke permissions for"),
      permissions: z
        .array(z.string())
        .describe("List of permission flags to set (e.g. ['ADMIN', 'ACCESS'])"),
      method: z
        .enum(["SET", "ADD", "REMOVE"])
        .default("SET")
        .describe(
          "How to apply: SET replaces all, ADD appends, REMOVE revokes"
        ),
    },
    async ({
      network,
      seed,
      index,
      targetAddress,
      principalAddress,
      permissions,
      method,
    }) => {
      const net = validateNetwork(network);
      const account = accountFromSeed(seed, index);
      await using userClient = createUserClient(net, account);

      const principal = accountFromPublicKey(principalAddress);
      const target = accountFromPublicKey(targetAddress);
      const adjustMethod =
        method === "ADD"
          ? KeetaNet.lib.Block.AdjustMethod.ADD
          : KeetaNet.lib.Block.AdjustMethod.SET;

      await userClient.updatePermissions(
        principal,
        new KeetaNet.lib.Permissions(permissions as any),
        undefined,
        adjustMethod,
        { account: target as any }
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                targetAddress,
                principalAddress,
                permissions,
                method,
                status: "published",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "keeta_set_account_info",
    "Set or update the info (name, description, metadata) on an account or token.",
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      seed: z.string().describe("Seed of the account"),
      index: z.number().int().min(0).describe("Account index"),
      targetAddress: z
        .string()
        .optional()
        .describe(
          "Address of the account/token to update. Defaults to the derived account."
        ),
      name: z.string().optional().describe("Account name"),
      description: z.string().optional().describe("Account description"),
      metadata: z
        .string()
        .optional()
        .describe(
          "JSON string of metadata to store (will be base64 encoded)"
        ),
    },
    async ({ network, seed, index, targetAddress, name, description, metadata }) => {
      const net = validateNetwork(network);
      const account = accountFromSeed(seed, index);
      await using userClient = createUserClient(net, account);

      const info: Record<string, unknown> = {};
      if (name !== undefined) info.name = name;
      if (description !== undefined) info.description = description;
      if (metadata !== undefined) {
        info.metadata = Buffer.from(metadata, "utf-8").toString("base64");
      }

      const options = targetAddress
        ? { account: accountFromPublicKey(targetAddress) }
        : undefined;

      await userClient.setInfo(info as any, options as any);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                address: targetAddress ?? account.publicKeyString.get(),
                ...info,
                status: "published",
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
