import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  generateSeed,
  accountFromSeed,
  accountFromPublicKey,
  validateNetwork,
  createUserClient,
  formatResult,
  safeSerialize,
  KeetaNet,
  KeetaAnchor,
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

  // ── Register Anchor Metadata ──────────────────────────────────────────
  server.tool(
    "keeta_register_anchor_metadata",
    `Register ServiceMetadata on a KeetaNet account, making an anchor discoverable via the Resolver.

Call this after every anchor deployment. Encodes the metadata JSON using Resolver.Metadata.formatMetadata()
and publishes it to the account via setInfo.

The metadata parameter should match the ServiceMetadata shape:
  {
    "version": 1,
    "currencyMap": { "USD": "keeta_tokenAddress...", "$USDC": "keeta_tokenAddress..." },
    "services": {
      "fx": { "my-provider": { "operations": { "getEstimate": "https://..." }, "from": [...] } }
    }
  }

Returns: { account, status, metadataEncodedSize, blocksPublished }`,
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      seed: z.string().describe("Seed of the anchor account"),
      accountIndex: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Account derivation index"),
      metadata: z
        .record(z.any())
        .describe("ServiceMetadata JSON object (version, currencyMap, services)"),
    },
    async ({ network, seed, accountIndex, metadata }) => {
      const net = validateNetwork(network);
      const account = accountFromSeed(seed, accountIndex);
      const encoded = KeetaAnchor.lib.Resolver.Metadata.formatMetadata(metadata as any);

      await using userClient = createUserClient(net, account);
      const builder = (userClient as any).initBuilder();
      builder.setInfo({ metadata: encoded });
      await builder.computeBlocks();

      if (typeof (userClient as any).publishBuilder === "function") {
        await (userClient as any).publishBuilder(builder);
      } else {
        await (userClient as any).transmit(builder);
      }

      const blocks = builder.blocks || [];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                account: account.publicKeyString.get(),
                status: "metadata_registered",
                metadataEncodedSize: encoded.length,
                blocksPublished: blocks.length,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── Get Token Info ────────────────────────────────────────────────────
  server.tool(
    "keeta_get_token_info",
    `Get token information for a Keeta token address.

Given a token address (keeta_...), returns the token name, description, decimal places, and raw metadata.
Essential when building FX or asset-movement anchors that need to understand token precision.

Returns: { address, name, description, decimalPlaces, metadata }`,
    {
      network: z.enum(["main", "test"]).describe("Network to use"),
      tokenAddress: z.string().describe("Token address (keeta_...) to look up"),
    },
    async ({ network, tokenAddress }) => {
      const net = validateNetwork(network);
      await using userClient = createUserClient(net, null);
      const accountInfo = await (userClient as any).client.getAccountInfo(
        accountFromPublicKey(tokenAddress)
      );

      const tokenInfo: Record<string, unknown> = { address: tokenAddress };

      if (accountInfo?.info) {
        const info = accountInfo.info;
        tokenInfo.name = info.name ?? null;
        tokenInfo.description = info.description ?? null;

        if (info.metadata) {
          try {
            const metaBuf = Buffer.isBuffer(info.metadata)
              ? info.metadata
              : Buffer.from(String(info.metadata), "base64");
            const parsed: unknown = JSON.parse(metaBuf.toString("utf-8"));
            tokenInfo.metadata = parsed;
            if (
              parsed !== null &&
              typeof parsed === "object" &&
              "decimalPlaces" in parsed &&
              typeof (parsed as Record<string, unknown>).decimalPlaces === "number"
            ) {
              tokenInfo.decimalPlaces = (parsed as Record<string, unknown>).decimalPlaces;
            }
          } catch {
            tokenInfo.metadata = safeSerialize(info.metadata);
          }
        }
      } else {
        tokenInfo.error = "Account not found or has no info field";
        tokenInfo.rawAccountInfo = safeSerialize(accountInfo);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(tokenInfo, null, 2),
          },
        ],
      };
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
