import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as KeetaAnchor from "@keetanetwork/anchor";
import {
  accountFromSeed,
  accountFromPublicKey,
  validateNetwork,
  formatResult,
  getTokenDecimals,
  DPO,
} from "./helpers.js";

const Account = KeetaAnchor.KeetaNet.lib.Account;

export function registerAnchorTools(server: McpServer) {
  server.tool(
    "keeta_resolve_anchor_metadata",
    "Resolve anchor metadata from a root account. Returns the full anchor service registry including currency maps and available FX services. Useful for discovering what tokens and swap pairs an anchor supports.",
    {
      network: z.enum(["main", "test"]).describe("Network to query"),
      rootAddress: z
        .string()
        .optional()
        .describe(
          "Root account address for the anchor. If omitted, uses the network's default root."
        ),
    },
    async ({ network, rootAddress }) => {
      const net = validateNetwork(network);
      const userClient = KeetaAnchor.KeetaNet.UserClient.fromNetwork(net, null);

      const root = rootAddress
        ? accountFromPublicKey(rootAddress)
        : userClient.networkAddress;

      const resolver = new KeetaAnchor.lib.Resolver({
        root,
        client: userClient,
        trustedCAs: [],
      });

      const metadata = await resolver.getRootMetadata();
      const resolved =
        await KeetaAnchor.lib.Resolver.Metadata.fullyResolveValuizable(
          metadata
        );

      await userClient.destroy();

      return {
        content: [{ type: "text", text: formatResult(resolved) }],
      };
    }
  );

  server.tool(
    "keeta_list_anchor_tokens",
    "List all available tokens registered with an FX anchor. Returns token names, addresses, and their swap pairs.",
    {
      network: z.enum(["main", "test"]).describe("Network to query"),
      rootAddress: z
        .string()
        .optional()
        .describe("Anchor root address. Defaults to network root."),
    },
    async ({ network, rootAddress }) => {
      const net = validateNetwork(network);
      await using userClient = KeetaAnchor.KeetaNet.UserClient.fromNetwork(
        net,
        null
      );

      const root = rootAddress
        ? accountFromPublicKey(rootAddress)
        : userClient.networkAddress;

      const fxClient = new KeetaAnchor.FX.Client(userClient, { root });
      const tokens = await fxClient.resolver.listTokens();

      return {
        content: [{ type: "text", text: formatResult(tokens) }],
      };
    }
  );

  server.tool(
    "keeta_list_conversion_pairs",
    "List all possible FX conversion pairs for a given source token on an anchor.",
    {
      network: z.enum(["main", "test"]).describe("Network to query"),
      fromToken: z
        .string()
        .describe("Source token address to find conversion pairs for"),
      rootAddress: z
        .string()
        .optional()
        .describe("Anchor root address. Defaults to network root."),
    },
    async ({ network, fromToken, rootAddress }) => {
      const net = validateNetwork(network);
      await using userClient = KeetaAnchor.KeetaNet.UserClient.fromNetwork(
        net,
        null
      );

      const root = rootAddress
        ? accountFromPublicKey(rootAddress)
        : userClient.networkAddress;

      const fxClient = new KeetaAnchor.FX.Client(userClient, { root });
      const from = accountFromPublicKey(fromToken);
      const conversions = await fxClient.listPossibleConversions({ from: from as any });

      return {
        content: [{ type: "text", text: formatResult(conversions) }],
      };
    }
  );

  server.tool(
    "keeta_get_fx_quote",
    "Get FX (foreign exchange) quotes from anchor providers for a token swap. Returns rate, converted amount, and provider details. Use affinity='from' to specify amount you're sending, or 'to' for amount you want to receive.",
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      seed: z.string().describe("Seed of the account requesting the quote"),
      index: z.number().int().min(0).describe("Account index"),
      fromToken: z.string().describe("Token address to send"),
      toToken: z
        .string()
        .describe(
          "Token address to receive. Can be a currency code like $USDC if registered in anchor metadata."
        ),
      amount: z
        .string()
        .describe("Amount in human-readable units"),
      affinity: z
        .enum(["from", "to"])
        .describe(
          "'from' = amount applies to token you send; 'to' = amount applies to token you receive"
        ),
      rootAddress: z
        .string()
        .optional()
        .describe("Anchor root address. Defaults to network root."),
    },
    async ({
      network,
      seed,
      index,
      fromToken,
      toToken,
      amount,
      affinity,
      rootAddress,
    }) => {
      const net = validateNetwork(network);
      const account = accountFromSeed(seed, index);
      await using userClient = KeetaAnchor.KeetaNet.UserClient.fromNetwork(
        net,
        account
      );

      const root = rootAddress
        ? accountFromPublicKey(rootAddress)
        : userClient.networkAddress;

      const fxClient = new KeetaAnchor.FX.Client(userClient, { root });

      // Determine if fromToken is the base token or a specific address
      const fromAddr = fromToken.startsWith("keeta_")
        ? fromToken
        : userClient.baseToken.publicKeyString.get();

      const decimals = await getTokenDecimals(net, fromAddr);
      const scale = decimals !== null ? decimals : 0;
      const rawAmount = Number(amount) * 10 ** scale;

      const quotes = await fxClient.getQuotes({
        from: fromAddr,
        to: toToken,
        amount: BigInt(Math.round(rawAmount)),
        affinity,
      } as any);

      if (!quotes || quotes.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "No FX providers available for this swap pair" },
                null,
                2
              ),
            },
          ],
        };
      }

      const quoteSummaries = quotes.map((q: any) => ({
        provider: q.quote.account,
        convertedAmount: q.quote.convertedAmount,
        cost: q.quote.cost,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                fromToken: fromAddr,
                toToken,
                amount,
                affinity,
                quotes: quoteSummaries,
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
    "keeta_execute_fx_swap",
    "Execute a token swap through an FX anchor provider. Gets a quote and immediately executes the exchange. This is an atomic operation — either both sides of the swap complete or neither does.",
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      seed: z.string().describe("Seed of the account executing the swap"),
      index: z.number().int().min(0).describe("Account index"),
      fromToken: z.string().describe("Token address to send"),
      toToken: z
        .string()
        .describe("Token address or currency code to receive"),
      amount: z
        .string()
        .describe("Amount in human-readable units"),
      affinity: z
        .enum(["from", "to"])
        .describe("Direction: 'from' = specifying send amount, 'to' = specifying receive amount"),
      rootAddress: z
        .string()
        .optional()
        .describe("Anchor root address. Defaults to network root."),
    },
    async ({
      network,
      seed,
      index,
      fromToken,
      toToken,
      amount,
      affinity,
      rootAddress,
    }) => {
      const net = validateNetwork(network);
      const account = accountFromSeed(seed, index);
      await using userClient = KeetaAnchor.KeetaNet.UserClient.fromNetwork(
        net,
        account
      );

      const root = rootAddress
        ? accountFromPublicKey(rootAddress)
        : userClient.networkAddress;

      const fxClient = new KeetaAnchor.FX.Client(userClient, { root });

      const fromAddr = fromToken.startsWith("keeta_")
        ? fromToken
        : userClient.baseToken.publicKeyString.get();

      const decimals = await getTokenDecimals(net, fromAddr);
      const scale = decimals !== null ? decimals : 0;
      const rawAmount = Number(amount) * 10 ** scale;

      const initialBalances = await userClient.allBalances();

      const quotes = await fxClient.getQuotes({
        from: fromAddr,
        to: toToken,
        amount: BigInt(Math.round(rawAmount)),
        affinity,
      } as any);

      if (!quotes || quotes.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "No FX providers available for this swap" },
                null,
                2
              ),
            },
          ],
        };
      }

      const provider = quotes[0];
      if (!provider) {
        throw new Error("FX provider is undefined");
      }

      await provider.createExchange();

      const finalBalances = await userClient.allBalances();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "swap_completed",
                fromToken: fromAddr,
                toToken,
                amount,
                affinity,
                quote: {
                  provider: provider.quote.account,
                  convertedAmount: provider.quote.convertedAmount,
                },
                balancesBefore: DPO(initialBalances),
                balancesAfter: DPO(finalBalances),
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
    "keeta_set_anchor_metadata",
    "Configure anchor metadata on an account, registering currency maps and FX service endpoints. This makes the account discoverable as an anchor root by other participants.",
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      seed: z.string().describe("Seed of the anchor root account"),
      index: z.number().int().min(0).describe("Account index"),
      name: z.string().describe("Anchor display name"),
      description: z.string().describe("Anchor description"),
      currencyMap: z
        .record(z.string())
        .describe(
          "Map of currency codes to token addresses, e.g. { '$KTA': 'keeta_...', '$USDC': 'keeta_...' }"
        ),
      fxServiceName: z
        .string()
        .describe("Name of the FX service provider"),
      fxPairs: z
        .array(
          z.object({
            from: z
              .array(z.string())
              .describe("Token addresses that can be sent"),
            to: z
              .array(z.string())
              .describe("Token addresses that can be received"),
          })
        )
        .describe("FX conversion pairs"),
      fxServerUrl: z
        .string()
        .describe("Base URL of the FX HTTP server"),
    },
    async ({
      network,
      seed,
      index,
      name,
      description,
      currencyMap,
      fxServiceName,
      fxPairs,
      fxServerUrl,
    }) => {
      const net = validateNetwork(network);
      const account = accountFromSeed(seed, index);
      await using userClient = KeetaAnchor.KeetaNet.UserClient.fromNetwork(
        net,
        account
      );

      const fromEntries = fxPairs.map((pair) => ({
        currencyCodes: pair.from,
        to: pair.to,
      }));

      await userClient.setInfo({
        description,
        name,
        metadata: KeetaAnchor.lib.Resolver.Metadata.formatMetadata({
          version: 1,
          currencyMap,
          services: {
            fx: {
              [fxServiceName]: {
                from: fromEntries,
                operations: {
                  getEstimate: `${fxServerUrl}/api/getEstimate`,
                  getQuote: `${fxServerUrl}/api/getQuote`,
                  createExchange: `${fxServerUrl}/api/createExchange`,
                  getExchangeStatus: `${fxServerUrl}/api/getExchangeStatus/{exchangeID}`,
                },
              },
            },
          },
        }),
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                anchorRoot: account.publicKeyString.get(),
                name,
                description,
                currencyMap,
                fxService: fxServiceName,
                pairs: fxPairs,
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
