import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  generateSeed,
  accountFromSeed,
  validateNetwork,
  createUserClient,
  formatResult,
  KeetaNet,
} from "./helpers.js";

export function registerBootstrapTools(server: McpServer) {
  server.tool(
    "keeta_generate_seed",
    `Generate a new random cryptographic seed for the Keeta Network.

This is the starting point for all Keeta operations. A seed can derive unlimited accounts via keeta_derive_account.
Store the seed securely — it controls all derived accounts and their funds.

Returns: { seed: string }`,
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
    `Derive a Keeta account (public/private keypair) from a seed and index.

Each unique (seed, index, algorithm) combination produces a deterministic account.
The returned address (keeta_...) is used in all other tools as account/token identifiers.

Supported algorithms:
  - SECP256K1 (default) — most common, Ethereum-compatible
  - SECP256R1 — WebAuthn/passkey compatible
  - ED25519 — fast signatures

Returns: { address: string, algorithm: string, index: number }`,
    {
      seed: z.string().describe("Seed string from keeta_generate_seed"),
      index: z.number().int().min(0).describe("Derivation index (0, 1, 2, ...)"),
      algorithm: z
        .enum(["SECP256K1", "SECP256R1", "ED25519"])
        .optional()
        .describe("Key algorithm — defaults to SECP256K1"),
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
    "keeta_request_test_tokens",
    `Request free KTA tokens from the Keeta test network faucet.

Only works on the test network. Sends 5 KTA to the given address for development/testing.
KTA is needed for transaction fees on the network.

Returns: { status, address, amountRequested, currentBalance }`,
    {
      address: z.string().describe("Keeta address (keeta_...) to fund"),
    },
    async ({ address }) => {
      try {
        const params = new URLSearchParams();
        params.append("address", address);
        params.append("amount", "5");
        const response = await fetch("https://faucet.test.keeta.com", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });

        if (!response.ok) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: `Faucet returned status ${response.status}`,
                  address,
                }),
              },
            ],
          };
        }

        await new Promise((r) => setTimeout(r, 2000));
        await using userClient = createUserClient(validateNetwork("test"), null);
        const balance = await (userClient as any).client.getBalance(
          address,
          (userClient as any).baseToken
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
              text: JSON.stringify({
                error: `Faucet request failed: ${err instanceof Error ? err.message : String(err)}`,
                address,
              }),
            },
          ],
        };
      }
    }
  );

  server.tool(
    "keeta_get_network_config",
    `Get the configuration for a Keeta network, including the network ID, base token address, and network account address.

This is useful for understanding the network you are operating on before making transactions.

Returns: { networkAlias, networkId, baseToken, networkAddress }`,
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
                baseToken: (userClient as any).baseToken.publicKeyString.get(),
                networkAddress: (userClient as any).networkAddress.publicKeyString.get(),
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
