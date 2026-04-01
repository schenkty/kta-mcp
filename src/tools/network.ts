import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  validateNetwork,
  createClient,
  createUserClient,
  formatResult,
  KeetaNet,
} from "./helpers.js";

export function registerNetworkTools(server: McpServer) {
  server.tool(
    "keeta_get_network_config",
    "Get the network configuration for a Keeta network (main or test). Returns the network ID, endpoints, and base token information.",
    {
      network: z.enum(["main", "test"]).describe("Network alias"),
    },
    async ({ network }) => {
      const net = validateNetwork(network);
      const config = KeetaNet.Client.Config.getDefaultConfig(net);
      await using userClient = createUserClient(net, null);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                networkAlias: network,
                networkId: config.network,
                baseToken: userClient.baseToken.publicKeyString.get(),
                networkAddress: userClient.networkAddress.publicKeyString.get(),
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
    "keeta_get_network_permissions",
    "Get the default permissions configured on the network account. Shows what base permissions apply to all accounts by default.",
    {
      network: z.enum(["main", "test"]).describe("Network alias"),
    },
    async ({ network }) => {
      const net = validateNetwork(network);
      const client = createClient(net);
      const config = KeetaNet.Client.Config.getDefaultConfig(net);
      const networkAccount = KeetaNet.lib.Account.generateNetworkAddress(
        config.network
      );
      const info = await client.getAccountInfo(networkAccount);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                networkAlias: network,
                networkAccount: networkAccount.publicKeyString.get(),
                defaultPermissions:
                  info.info.defaultPermission?.base?.flags ?? null,
                accountInfo: formatResult(info),
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
    "keeta_request_test_tokens",
    "Request free KTA tokens from the test network faucet. Only works on the test network. Sends 5 KTA to the specified address for development and testing.",
    {
      address: z
        .string()
        .describe("Keeta account address to receive test tokens"),
    },
    async ({ address }) => {
      try {
        const params = new URLSearchParams();
        params.append("address", address);
        params.append("amount", "5");
        const response = await fetch("https://faucet.test.keeta.com", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        });

        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: `Faucet request failed with status ${response.status}`,
                    address,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Wait briefly then check balance
        await new Promise((r) => setTimeout(r, 2000));
        await using userClient = createUserClient(
          validateNetwork("test"),
          null
        );
        const balance = await userClient.client.getBalance(
          address,
          userClient.baseToken
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "success",
                  address,
                  amountRequested: "5 KTA",
                  currentBalance: balance.toString(),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: `Faucet request failed: ${err instanceof Error ? err.message : String(err)}`,
                  address,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.tool(
    "keeta_lookup_currency_code",
    "Look up a currency code (like $KTA, $USDC) in the network anchor metadata and return the corresponding token address.",
    {
      network: z.enum(["main", "test"]).describe("Network to query"),
      currencyCode: z
        .string()
        .describe("Currency code to look up (e.g. $KTA, $USDC, $EURC)"),
    },
    async ({ network, currencyCode }) => {
      const net = validateNetwork(network);
      // Use dynamic import for anchor
      const KeetaAnchor = await import("@keetanetwork/anchor");
      await using userClient = KeetaAnchor.KeetaNet.UserClient.fromNetwork(
        net,
        null
      );

      const resolver = new KeetaAnchor.lib.Resolver({
        root: userClient.networkAddress,
        client: userClient,
        trustedCAs: [],
      });

      const metadata = await resolver.getRootMetadata();
      const resolved =
        await KeetaAnchor.lib.Resolver.Metadata.fullyResolveValuizable(
          metadata
        );

      // Search through the resolved metadata for the currency map
      let tokenAddress: string | null = null;
      if (
        resolved &&
        typeof resolved === "object" &&
        "currencyMap" in resolved
      ) {
        const map = (resolved as Record<string, unknown>).currencyMap;
        if (map && typeof map === "object") {
          const entry = (map as Record<string, string>)[currencyCode];
          if (entry) {
            tokenAddress = entry;
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                currencyCode,
                tokenAddress: tokenAddress ?? "not found",
                network,
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
