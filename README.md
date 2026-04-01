# Keeta MCP Server

An MCP (Model Context Protocol) server that provides AI agents with native access to the [Keeta Network](https://keeta.com/) — a Layer 1 blockchain built for payments, asset transfers, and cross-chain interoperability.

## Features

### Account Management
- **`keeta_generate_seed`** — Generate a cryptographic seed for account derivation
- **`keeta_derive_account`** — Derive accounts with support for SECP256K1, SECP256R1, and ED25519 algorithms
- **`keeta_get_account_info`** — Get account details (name, description, metadata, permissions)
- **`keeta_get_account_metadata`** — Decode compressed/base64 metadata from any account
- **`keeta_get_balance`** — Check token balance for an account
- **`keeta_get_all_balances`** — Get all token balances an account holds
- **`keeta_get_head_block`** — Get the latest block hash on an account's chain
- **`keeta_generate_identifier`** — Create TOKEN, STORAGE, or MULTISIG identifiers

### Token Operations
- **`keeta_create_token`** — Create a new token with name, decimals, supply, and permissions
- **`keeta_mint_tokens`** — Mint additional supply for an existing token
- **`keeta_send_tokens`** — Send tokens (KTA or custom) between accounts
- **`keeta_get_token_info`** — Get full token details including decoded metadata

### Transactions & Permissions
- **`keeta_get_block`** — Fetch a specific block by hash
- **`keeta_get_chain_info`** — Get network chain information
- **`keeta_create_swap_request`** — Create atomic swap blocks for peer-to-peer exchange
- **`keeta_update_permissions`** — Grant or revoke permissions (ACCESS, ADMIN, SEND, etc.)
- **`keeta_set_account_info`** — Update account name, description, and metadata

### Anchor & FX Operations
- **`keeta_resolve_anchor_metadata`** — Discover anchor services, currency maps, and FX providers
- **`keeta_list_anchor_tokens`** — List all tokens available through an anchor
- **`keeta_list_conversion_pairs`** — Find available FX conversion pairs for a token
- **`keeta_get_fx_quote`** — Get exchange rate quotes from FX providers
- **`keeta_execute_fx_swap`** — Execute a token swap atomically through an anchor
- **`keeta_set_anchor_metadata`** — Register an account as an anchor with FX service endpoints

### Network Utilities
- **`keeta_get_network_config`** — Get network configuration (endpoints, base token, network ID)
- **`keeta_get_network_permissions`** — View default network-level permissions
- **`keeta_request_test_tokens`** — Request free KTA from the test network faucet
- **`keeta_lookup_currency_code`** — Resolve currency codes ($KTA, $USDC) to token addresses

## Installation

```bash
npm install
npm run build
```

## Usage

### With Claude Code

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "keeta": {
      "command": "node",
      "args": ["/path/to/keeta-mcp/build/index.js"]
    }
  }
}
```

### With Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "keeta": {
      "command": "node",
      "args": ["/path/to/keeta-mcp/build/index.js"]
    }
  }
}
```

### Development Mode

```bash
npm run dev
```

## Architecture

```
src/
├── index.ts              # MCP server entry point (stdio transport)
└── tools/
    ├── helpers.ts         # Shared SDK wrappers and utilities
    ├── accounts.ts        # Account management tools
    ├── tokens.ts          # Token creation and transfer tools
    ├── transactions.ts    # Block, swap, and permission tools
    ├── anchors.ts         # Anchor resolver and FX tools
    └── network.ts         # Network config and utility tools
```

## About Keeta Network

[Keeta](https://keeta.com/) is a Layer 1 blockchain delivering:
- **10M TPS** with **400ms settlement**
- Native token issuance and atomic swaps
- **Anchors** — regulated entry/exit points connecting blockchains and fiat rails (SWIFT, ACH, FedNow)
- Built-in compliance with X.509 certificate-based identity
- Cross-chain interoperability without third-party bridges

### SDKs Used

- [`@keetanetwork/keetanet-client`](https://github.com/KeetaNetwork/keetanet-client) — Core client SDK
- [`@keetanetwork/anchor`](https://github.com/KeetaNetwork/anchor) — Anchor and FX SDK

### Resources

- [Documentation](https://docs.keeta.com/)
- [SDK Reference](https://static.network.keeta.com/docs/)
- [Examples](https://github.com/KeetaNetwork/keetanet-examples)
- [GitHub](https://github.com/KeetaNetwork)

## License

MIT
