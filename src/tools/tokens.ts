import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  accountFromSeed,
  accountFromPublicKey,
  validateNetwork,
  createUserClient,
  getTokenDecimals,
  formatResult,
  KeetaNet,
} from "./helpers.js";

export function registerTokenTools(server: McpServer) {
  server.tool(
    "keeta_create_token",
    "Create a new token on the Keeta Network with a name, description, decimal places, and initial supply. The token is created as an identifier under the owning account. Returns the token address. Requires a funded account.",
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      seed: z.string().describe("Seed of the owning account"),
      index: z.number().int().min(0).describe("Account index"),
      name: z
        .string()
        .max(8)
        .describe("Token ticker/name (e.g. USDC, TKNA) — max 8 chars"),
      description: z.string().describe("Human-readable token description"),
      decimalPlaces: z
        .number()
        .int()
        .min(0)
        .max(18)
        .describe("Number of decimal places for the token"),
      initialSupply: z
        .string()
        .describe(
          "Initial supply in human-readable units (e.g. '50000' for 50,000 tokens). Will be scaled by decimalPlaces."
        ),
      publicAccess: z
        .boolean()
        .default(true)
        .describe(
          "Whether to grant public ACCESS permission (default true). If false, only the owner can interact."
        ),
    },
    async ({
      network,
      seed,
      index,
      name,
      description,
      decimalPlaces,
      initialSupply,
      publicAccess,
    }) => {
      const net = validateNetwork(network);
      const account = accountFromSeed(seed, index);
      await using userClient = createUserClient(net, account);

      const { account: token } = await userClient.generateIdentifier(
        KeetaNet.lib.Account.AccountKeyAlgorithm.TOKEN
      );

      if (!token.isToken()) {
        throw new Error("Generated identifier is not a TOKEN type");
      }

      const metadata = Buffer.from(
        JSON.stringify({ decimalPlaces }),
        "utf-8"
      ).toString("base64");

      const builder = userClient.initBuilder();

      const infoOptions: Record<string, unknown> = {
        name,
        description,
        metadata,
      };
      if (publicAccess) {
        infoOptions.defaultPermission = new KeetaNet.lib.Permissions([
          "ACCESS",
        ]);
      }
      builder.setInfo(infoOptions as any, { account: token });

      const rawSupply =
        BigInt(initialSupply) * 10n ** BigInt(decimalPlaces);
      builder.modifyTokenSupply(rawSupply, { account: token });

      await builder.computeBlocks();
      await builder.publish();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                tokenAddress: token.publicKeyString.get(),
                owner: account.publicKeyString.get(),
                name,
                description,
                decimalPlaces,
                initialSupply,
                rawSupply: rawSupply.toString(),
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
    "keeta_mint_tokens",
    "Mint additional supply for an existing token. The caller must be the token owner or have ADMIN permission.",
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      seed: z.string().describe("Seed of the account with mint authority"),
      index: z.number().int().min(0).describe("Account index"),
      tokenAddress: z.string().describe("Token address to mint supply for"),
      amount: z
        .string()
        .describe(
          "Amount to mint in human-readable units. Will be auto-scaled by the token's decimal places."
        ),
    },
    async ({ network, seed, index, tokenAddress, amount }) => {
      const net = validateNetwork(network);
      const account = accountFromSeed(seed, index);
      await using userClient = createUserClient(net, account);

      const token = accountFromPublicKey(tokenAddress);
      const decimals = await getTokenDecimals(net, tokenAddress);
      const scale = decimals !== null ? BigInt(decimals) : 0n;
      const rawAmount = BigInt(amount) * 10n ** scale;

      const builder = userClient.initBuilder();
      builder.modifyTokenSupply(rawAmount, { account: token as any });
      await builder.computeBlocks();
      await builder.publish();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                tokenAddress,
                amountMinted: amount,
                rawAmountMinted: rawAmount.toString(),
                decimalPlaces: decimals,
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
    "keeta_send_tokens",
    "Send tokens from one account to another on the Keeta Network. Supports any token including the native KTA base token.",
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      seed: z.string().describe("Seed of the sending account"),
      index: z.number().int().min(0).describe("Sender account index"),
      to: z.string().describe("Recipient Keeta address"),
      amount: z
        .string()
        .describe("Amount to send in human-readable units"),
      tokenAddress: z
        .string()
        .optional()
        .describe(
          "Token address to send. If omitted, sends the network base token (KTA)."
        ),
    },
    async ({ network, seed, index, to, amount, tokenAddress }) => {
      const net = validateNetwork(network);
      const account = accountFromSeed(seed, index);
      await using userClient = createUserClient(net, account);

      const token = tokenAddress
        ? accountFromPublicKey(tokenAddress)
        : userClient.baseToken;

      const decimals = await getTokenDecimals(
        net,
        tokenAddress ?? userClient.baseToken.publicKeyString.get()
      );
      const scale = decimals !== null ? BigInt(decimals) : 0n;
      const rawAmount = BigInt(amount) * 10n ** scale;

      const recipient = accountFromPublicKey(to);
      const builder = userClient.initBuilder();
      builder.send(recipient, rawAmount, token as any);
      await builder.computeBlocks();
      await builder.publish();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                from: account.publicKeyString.get(),
                to,
                token: token.publicKeyString.get(),
                amount,
                rawAmount: rawAmount.toString(),
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
    "keeta_get_token_info",
    "Get complete token information including name, description, metadata (decimal places, etc.), supply details, and default permissions.",
    {
      network: z.enum(["main", "test"]).describe("Network to query"),
      tokenAddress: z.string().describe("Token address to query"),
    },
    async ({ network, tokenAddress }) => {
      const net = validateNetwork(network);
      const client = KeetaNet.Client.fromNetwork(net);
      const info = await client.getAccountInfo(tokenAddress);
      let metadata: unknown = null;
      try {
        const metadataBuffer = Buffer.from(info.info.metadata, "base64");
        const networkMetadata =
          KeetaNet.lib.Utils.Helper.bufferToArrayBuffer(metadataBuffer);
        let uncompressed: ArrayBuffer;
        try {
          uncompressed =
            KeetaNet.lib.Utils.Buffer.ZlibInflate(networkMetadata);
        } catch {
          uncompressed = networkMetadata;
        }
        metadata = JSON.parse(Buffer.from(uncompressed).toString("utf-8"));
      } catch {
        // metadata might not be JSON
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                tokenAddress,
                name: info.info.name,
                description: info.info.description,
                metadata,
                defaultPermission: info.info.defaultPermission,
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
