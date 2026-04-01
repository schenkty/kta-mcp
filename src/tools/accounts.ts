import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  generateSeed,
  accountFromSeed,
  accountFromPublicKey,
  validateNetwork,
  createUserClient,
  createClient,
  getAccountMetadata,
  formatResult,
  KeetaNet,
} from "./helpers.js";

export function registerAccountTools(server: McpServer) {
  server.tool(
    "keeta_generate_seed",
    "Generate a new random cryptographic seed for deriving Keeta accounts. Returns a seed string that can be used with keeta_derive_account.",
    {},
    async () => {
      const seed = generateSeed();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ seed }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "keeta_derive_account",
    "Derive a Keeta account (keypair) from a seed and index. Supports multiple key algorithms: SECP256K1 (default), SECP256R1, ED25519. Returns the public key address.",
    {
      seed: z.string().describe("The seed string to derive the account from"),
      index: z
        .number()
        .int()
        .min(0)
        .describe("Account index for HD derivation"),
      algorithm: z
        .enum([
          "SECP256K1",
          "SECP256R1",
          "ED25519",
        ])
        .optional()
        .describe(
          "Key algorithm. Defaults to SECP256K1"
        ),
    },
    async ({ seed, index, algorithm }) => {
      const account = accountFromSeed(seed, index, algorithm);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                address: account.publicKeyString.get(),
                algorithm: algorithm ?? "SECP256K1",
                index,
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
    "keeta_get_account_info",
    "Get detailed info for a Keeta account: name, description, metadata, default permissions, and head block. Works for user accounts, tokens, and identifiers.",
    {
      network: z
        .enum(["main", "test"])
        .describe("Network to query (main or test)"),
      address: z
        .string()
        .describe(
          "The Keeta public key address (starts with keeta_)"
        ),
    },
    async ({ network, address }) => {
      const net = validateNetwork(network);
      const client = createClient(net);
      const accountInfo = await client.getAccountInfo(address);
      return {
        content: [
          {
            type: "text",
            text: formatResult(accountInfo),
          },
        ],
      };
    }
  );

  server.tool(
    "keeta_get_account_metadata",
    "Decode and return the metadata JSON stored on a Keeta account. Handles base64 and zlib-compressed metadata automatically.",
    {
      network: z
        .enum(["main", "test"])
        .describe("Network to query"),
      address: z
        .string()
        .optional()
        .describe(
          "Account address. If omitted, returns the network base token metadata."
        ),
    },
    async ({ network, address }) => {
      const net = validateNetwork(network);
      const metadata = await getAccountMetadata(net, address);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(metadata, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "keeta_get_balance",
    "Get the balance of a specific token for an account.",
    {
      network: z
        .enum(["main", "test"])
        .describe("Network to query"),
      address: z.string().describe("Account address to check balance for"),
      token: z
        .string()
        .optional()
        .describe(
          "Token address. If omitted, returns the network base token (KTA) balance."
        ),
    },
    async ({ network, address, token }) => {
      const net = validateNetwork(network);
      await using userClient = createUserClient(net, null);
      const tokenAccount = token
        ? accountFromPublicKey(token)
        : userClient.baseToken;
      const balance = await userClient.client.getBalance(address, tokenAccount as any);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                address,
                token: token ?? userClient.baseToken.publicKeyString.get(),
                balance: balance.toString(),
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
    "keeta_get_all_balances",
    "Get all token balances for an account across all tokens it holds.",
    {
      network: z
        .enum(["main", "test"])
        .describe("Network to query"),
      address: z.string().describe("Account address"),
    },
    async ({ network, address }) => {
      const net = validateNetwork(network);
      const client = createClient(net);
      const balances = await client.getAllBalances(address);
      return {
        content: [
          {
            type: "text",
            text: formatResult(balances),
          },
        ],
      };
    }
  );

  server.tool(
    "keeta_get_head_block",
    "Get the head (latest) block hash for an account's chain.",
    {
      network: z
        .enum(["main", "test"])
        .describe("Network to query"),
      address: z.string().describe("Account address"),
    },
    async ({ network, address }) => {
      const net = validateNetwork(network);
      const client = createClient(net);
      const head = await client.getHeadBlock(address);
      return {
        content: [
          {
            type: "text",
            text: formatResult(head),
          },
        ],
      };
    }
  );

  server.tool(
    "keeta_generate_identifier",
    "Generate a derived identifier (TOKEN, STORAGE, or MULTISIG) from a user account using the UserClient. Publishes the creation block to the network. Requires a funded account (needs KTA for fees).",
    {
      network: z
        .enum(["main", "test"])
        .describe("Network to use"),
      seed: z.string().describe("Seed of the owning account"),
      index: z.number().int().min(0).describe("Account index"),
      identifierType: z
        .enum(["TOKEN", "STORAGE", "MULTISIG"])
        .describe("Type of identifier to create"),
    },
    async ({ network, seed, index, identifierType }) => {
      const net = validateNetwork(network);
      const account = accountFromSeed(seed, index);
      await using userClient = createUserClient(net, account);
      if (identifierType === "MULTISIG") {
        throw new Error(
          "MULTISIG identifiers require signers and quorum configuration. Use keeta_create_swap_request or build blocks manually."
        );
      }
      const algo =
        identifierType === "TOKEN"
          ? KeetaNet.lib.Account.AccountKeyAlgorithm.TOKEN
          : KeetaNet.lib.Account.AccountKeyAlgorithm.STORAGE;

      const { account: identifier } =
        await userClient.generateIdentifier(algo);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                identifierType,
                address: identifier.publicKeyString.get(),
                owner: account.publicKeyString.get(),
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
