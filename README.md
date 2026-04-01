# Keeta Network MCP Server

A dynamic, self-describing [MCP](https://modelcontextprotocol.io/) (Model Context Protocol) server that gives AI agents native access to the **[Keeta Network](https://keeta.com/)** — a Layer 1 blockchain built for payments, asset transfers, cross-chain interoperability, and compliance-ready financial infrastructure.

**This server is designed for autonomous agent use.** It does not require updates when the Keeta SDK is expanded — new SDK methods are automatically discoverable at runtime through built-in introspection tools.

---

## What is Keeta Network?

Keeta is a Layer 1 blockchain purpose-built for the global financial system:

- **10M+ TPS** with **400ms settlement** — faster than any traditional payment rail
- **Native tokenization** — create tokens with built-in rules (transfer restrictions, allowlists, time locks) enforced at protocol level
- **Atomic swaps** — instant exchange between any two assets on the network
- **Anchors** — regulated entry/exit points that bridge Keeta to external systems (SWIFT, ACH, FedNow, other blockchains like Base/Ethereum). Any foreign asset tokenized on Keeta is 1:1 backed and can be returned to its native chain at any time
- **Built-in compliance** — X.509 certificate-based identity for KYC/AML without storing PII on-chain
- **Permissions system** — granular per-account and per-token access controls (ACCESS, ADMIN, SEND, RECEIVE, etc.)
- **DAG architecture** — each account has its own chain, enabling parallel transaction processing
- **Multiple signature algorithms** — ECDSA SECP256K1, SECP256R1 (WebAuthn), ED25519

**Token:** KTA (used for transaction fees and governance)
**Networks:** `main` (production), `test` (development with free faucet)

---

## Quick Start

### Install

```bash
git clone <this-repo>
cd kta-mcp
npm install
npm run build
```

### Configure with Claude Code / Claude Desktop / Any MCP Client

```json
{
  "mcpServers": {
    "keeta": {
      "command": "node",
      "args": ["/absolute/path/to/kta-mcp/build/index.js"]
    }
  }
}
```

### Development

```bash
npm run dev    # Run with tsx (no build step)
npm run build  # Compile TypeScript
npm start      # Run compiled output
```

---

## Architecture: Dynamic & Future-Proof

This MCP server uses a **discover-then-execute** pattern instead of hardcoded tools. When the Keeta SDK adds new methods, classes, or features, agents discover them automatically without any server updates.

### 9 Tools — Organized in 3 Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│  BOOTSTRAP TOOLS (entry points)                                     │
│  keeta_generate_seed         → create a cryptographic seed          │
│  keeta_derive_account        → derive account from seed + index     │
│  keeta_request_test_tokens   → fund an account on testnet           │
│  keeta_get_network_config    → get network ID, base token, etc.     │
├─────────────────────────────────────────────────────────────────────┤
│  DISCOVERY TOOL (introspection)                                     │
│  keeta_list_sdk_methods      → list all methods/properties/enums    │
│                                 on any SDK class at runtime         │
├─────────────────────────────────────────────────────────────────────┤
│  EXECUTION TOOLS (generic, call any SDK method by name)             │
│  keeta_client_execute        → read-only network queries            │
│  keeta_user_client_execute   → authenticated account operations     │
│  keeta_builder_execute       → batch operations → publish           │
│  keeta_anchor_execute        → anchor/FX/resolver operations        │
└─────────────────────────────────────────────────────────────────────┘
```

### Smart Argument Resolution

Arguments passed to execution tools are automatically resolved based on prefixes:

| Pattern | Resolves To | Example |
|---|---|---|
| `keeta_abc123...` | `Account.fromPublicKeyString(...)` | Token/account addresses |
| `BIGINT:50000` | `BigInt(50000)` | Token amounts, supplies |
| `PERM:ACCESS,ADMIN` | `new Permissions(['ACCESS','ADMIN'])` | Permission sets |
| `ALGO:TOKEN` | `AccountKeyAlgorithm.TOKEN` | Key algorithm enums |
| `ADJUST:SET` | `AdjustMethod.SET` | Permission adjustment methods |
| `OP:SEND` | `OperationType.SEND` | Block operation types |
| `BUFFER_B64:aGVsbG8=` | `Buffer.from('aGVsbG8=','base64')` | Binary data |
| Plain values | Pass through unchanged | Strings, numbers, booleans, objects |

---

## Agent Workflow Guide

This section describes the recommended workflow for an AI agent using this MCP server. Follow these patterns for any Keeta operation.

### Step 1: Discover What's Available

Always start by introspecting the SDK to understand current capabilities:

```
keeta_list_sdk_methods({ target: "Client" })       → read-only methods
keeta_list_sdk_methods({ target: "UserClient" })    → authenticated methods
keeta_list_sdk_methods({ target: "Builder" })       → builder/batch methods
keeta_list_sdk_methods({ target: "Account" })       → account utilities + enums
keeta_list_sdk_methods({ target: "Block" })         → block types + operation types
keeta_list_sdk_methods({ target: "AnchorResolver" })→ anchor metadata methods
keeta_list_sdk_methods({ target: "AnchorFXClient" })→ FX swap methods
keeta_list_sdk_methods({ target: "AnchorMetadata" })→ metadata formatting
keeta_list_sdk_methods({ target: "Config" })        → network configuration
```

### Step 2: Create an Account

```
keeta_generate_seed()
→ { seed: "A1B2C3..." }

keeta_derive_account({ seed: "A1B2C3...", index: 0 })
→ { address: "keeta_abc123...", algorithm: "SECP256K1", index: 0 }
```

### Step 3: Fund It (testnet)

```
keeta_request_test_tokens({ address: "keeta_abc123..." })
→ { status: "success", currentBalance: "5000000000000000000" }
```

### Step 4: Perform Operations

**Read-only queries (no account needed):**
```
keeta_client_execute({
  network: "test",
  method: "getAccountInfo",
  args: ["keeta_abc123..."]
})

keeta_client_execute({
  network: "test",
  method: "getAllBalances",
  args: ["keeta_abc123..."]
})
```

**Authenticated operations:**
```
keeta_user_client_execute({
  network: "test",
  seed: "A1B2C3...",
  accountIndex: 0,
  method: "allBalances",
  args: []
})

keeta_user_client_execute({
  network: "test",
  seed: "A1B2C3...",
  method: "generateIdentifier",
  args: ["ALGO:TOKEN"]
})
```

**Read UserClient properties:**
```
keeta_user_client_execute({
  network: "test",
  method: "GET_PROPERTY",
  args: ["baseToken"]
})
```

### Step 5: Batch Operations with Builder

The builder pattern is the most powerful way to perform multiple operations atomically:

```
keeta_builder_execute({
  network: "test",
  seed: "A1B2C3...",
  accountIndex: 0,
  operations: [
    {
      "method": "setInfo",
      "args": [{
        "name": "USDT",
        "description": "Tether USD on Keeta",
        "metadata": "eyJkZWNpbWFsUGxhY2VzIjo2fQ==",
        "defaultPermission": "PERM:ACCESS"
      }],
      "options": { "account": "keeta_token_address..." }
    },
    {
      "method": "modifyTokenSupply",
      "args": ["BIGINT:1000000000000"],
      "options": { "account": "keeta_token_address..." },
      "computeAfter": true
    },
    {
      "method": "send",
      "args": ["keeta_recipient...", "BIGINT:500000000", "keeta_token_address..."]
    }
  ],
  autoPublish: true
})
```

Key builder details:
- `computeAfter: true` forces block computation after that operation (important when later operations depend on earlier ones, e.g., minting supply before sending tokens)
- `options` is passed as the final argument — commonly `{ account: "keeta_..." }` to target a specific token/identifier
- `autoPublish: true` (default) calls `computeBlocks()` and `publish()` after all operations

---

## Common Task Recipes

### Create a Token

```
1. keeta_generate_seed() → seed
2. keeta_derive_account({ seed, index: 0 }) → ownerAddress
3. keeta_request_test_tokens({ address: ownerAddress })
4. keeta_user_client_execute({ network: "test", seed, method: "generateIdentifier", args: ["ALGO:TOKEN"] }) → tokenAddress
5. keeta_builder_execute({
     network: "test", seed,
     operations: [
       { method: "setInfo", args: [{ name: "MYTKN", description: "My Token", metadata: "<base64 of {decimalPlaces:6}>", defaultPermission: "PERM:ACCESS" }], options: { account: tokenAddress } },
       { method: "modifyTokenSupply", args: ["BIGINT:1000000000000"], options: { account: tokenAddress }, computeAfter: true },
       { method: "send", args: [ownerAddress, "BIGINT:100000000", tokenAddress] }
     ]
   })
```

### Send Tokens

```
keeta_builder_execute({
  network: "test", seed,
  operations: [
    { method: "send", args: ["keeta_recipient...", "BIGINT:1000000", "keeta_token..."] }
  ]
})
```

### Atomic Swap

```
keeta_user_client_execute({
  network: "test", seed,
  method: "createSwapRequest",
  args: [{
    from: { account: "keeta_sender...", token: "keeta_tokenA...", amount: "BIGINT:1000" },
    to: { account: "keeta_counterparty...", token: "keeta_tokenB...", amount: "BIGINT:500" }
  }]
})
```

### FX Swap via Anchor

```
1. keeta_anchor_execute({ network: "test", subtarget: "fx_client", method: "getQuotes", args: [{ from: "keeta_kta...", to: "$USDC", amount: "BIGINT:1000000", affinity: "from" }] })
2. Use returned quote to execute the exchange
```

### Update Permissions

```
keeta_user_client_execute({
  network: "test", seed,
  method: "updatePermissions",
  args: ["keeta_principal...", "PERM:ADMIN,ACCESS", null, "ADJUST:SET"],
  // optional: pass { account: "keeta_target..." } to target a specific token
})
```

### Resolve Anchor Metadata

```
keeta_anchor_execute({
  network: "test",
  subtarget: "resolver",
  method: "getRootMetadata",
  args: []
})
```

---

## Building an Anchor (Agent Guide)

An **anchor** bridges the Keeta blockchain to an external system (another blockchain, a bank, a payment processor). Here's how an agent can build one:

### What an Anchor Does

1. **Holds liquidity** — the anchor operator's account holds tokens on both sides
2. **Provides FX quotes** — tells users what exchange rate they'll get
3. **Executes atomic swaps** — uses Keeta's native swap mechanism to guarantee both sides complete
4. **Exposes HTTP endpoints** — `getEstimate`, `getQuote`, `createExchange`, `getExchangeStatus`

### Anchor Architecture

```
External System (e.g., Base chain)
        ↕ (bridge logic you build)
Anchor FX HTTP Server
  ├── /api/getEstimate        → estimate conversion rate
  ├── /api/getQuote           → firm quote with provider signature
  ├── /api/createExchange     → execute the swap atomically
  └── /api/getExchangeStatus  → check swap status
        ↕ (Keeta SDK)
Keeta Network (native atomic swaps)
```

### Steps to Build an Anchor

1. **Create anchor operator account** — generate seed, derive account, fund it
2. **Create or identify token pairs** — the tokens being swapped (e.g., KTA ↔ USDC)
3. **Fund liquidity** — ensure the operator account holds enough of both tokens
4. **Build an FX HTTP server** — use `@keetanetwork/anchor` SDK's `KeetaNetFXAnchorHTTPServer` class, providing your `getConversionRateAndFee` callback
5. **Register anchor metadata** — publish on-chain metadata with `setInfo()` including the currency map and FX service endpoints
6. **Test** — use the FX client tools to get quotes and execute swaps against your anchor

### Registering Anchor Metadata On-Chain

```
keeta_user_client_execute({
  network: "test", seed,
  method: "setInfo",
  args: [{
    name: "MY_ANCHOR",
    description: "My Custom FX Anchor",
    metadata: "<use keeta_anchor_execute with subtarget 'metadata', method 'formatMetadata'>"
  }]
})
```

The metadata includes:
- `currencyMap` — maps human-readable codes (`$KTA`, `$USDC`) to token addresses
- `services.fx.<ProviderName>` — defines available conversion pairs and API endpoint URLs

### Format Anchor Metadata

```
keeta_anchor_execute({
  network: "test",
  subtarget: "metadata",
  method: "formatMetadata",
  args: [{
    version: 1,
    currencyMap: { "$KTA": "keeta_kta...", "$USDC": "keeta_usdc..." },
    services: {
      fx: {
        MyProvider: {
          from: [{ currencyCodes: ["keeta_kta..."], to: ["keeta_usdc..."] }],
          operations: {
            getEstimate: "https://my-anchor.com/api/getEstimate",
            getQuote: "https://my-anchor.com/api/getQuote",
            createExchange: "https://my-anchor.com/api/createExchange",
            getExchangeStatus: "https://my-anchor.com/api/getExchangeStatus/{exchangeID}"
          }
        }
      }
    }
  }]
})
```

---

## SDK Discovery Targets

| Target | What It Exposes | When To Use |
|---|---|---|
| `Client` | Read-only methods: `getAccountInfo`, `getBalance`, `getAllBalances`, `getHeadBlock`, `getBlock`, `getHistory`, `getTokenSupply`, `getNetworkStatus`, `getPeers`, `getVersion`, `getLedgerChecksum`, `getAllCertificates`, `getAllRepresentativeInfo` | Querying the network without an account |
| `UserClient` | All Client methods plus: `send`, `setInfo`, `generateIdentifier`, `allBalances`, `balance`, `head`, `chain`, `history`, `state`, `updatePermissions`, `createSwapRequest`, `transmit`, `listACLsByPrincipal`, `getCertificates`, `modifyCertificate`, `sync` | Any operation requiring an account |
| `Builder` | Batch operations: `send`, `receive`, `setInfo`, `modifyTokenSupply`, `modifyTokenBalance`, `computeBlocks`, `publish` | Multi-step operations that should execute atomically |
| `Account` | Static utilities: `fromSeed`, `fromPublicKeyString`, `generateRandomSeed`, `generateNetworkAddress`, `seedFromPassphrase`, `isIdentifierKeyType` + `AccountKeyAlgorithm` enum | Account creation and key management |
| `Block` | Block construction: `Builder`, `OperationType` enum, `AdjustMethod` enum, `NO_PREVIOUS` | Low-level block building |
| `Permissions` | Permission construction methods | Access control |
| `AnchorResolver` | `getRootMetadata` and resolution methods | Discovering anchor services |
| `AnchorFXClient` | `getQuotes`, `listPossibleConversions`, `createExchange` + `resolver.listTokens` | FX operations and swaps |
| `AnchorMetadata` | `formatMetadata`, `fullyResolveValuizable` | Building and parsing anchor metadata |
| `Config` | `getDefaultConfig` | Network configuration |

---

## Project Structure

```
kta-mcp/
├── package.json              # Dependencies: @keetanetwork/keetanet-client, @keetanetwork/anchor, @modelcontextprotocol/sdk
├── tsconfig.json             # TypeScript ES2022 + Node16 modules
├── src/
│   ├── index.ts              # MCP server entry point (stdio transport)
│   └── tools/
│       ├── helpers.ts        # SDK wrappers, argument resolution, introspection, serialization
│       ├── bootstrap.ts      # Essential tools: seed gen, account derivation, faucet, network config
│       ├── discovery.ts      # keeta_list_sdk_methods — runtime SDK introspection
│       └── execute.ts        # Generic execution: client, user_client, builder, anchor
└── build/                    # Compiled JavaScript output
```

## Dependencies

- [`@keetanetwork/keetanet-client`](https://github.com/KeetaNetwork/keetanet-client) — Core Keeta SDK (accounts, tokens, transactions, permissions)
- [`@keetanetwork/anchor`](https://github.com/KeetaNetwork/anchor) — Anchor SDK (FX, resolver, metadata, cross-chain bridges)
- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) — MCP server framework
- [`zod`](https://zod.dev/) — Schema validation for tool inputs

## Resources

- [Keeta Documentation](https://docs.keeta.com/)
- [SDK API Reference](https://static.network.keeta.com/docs/)
- [SDK Examples](https://github.com/KeetaNetwork/keetanet-examples)
- [Keeta GitHub](https://github.com/KeetaNetwork)
- [Keeta Whitepaper](https://keeta.com/keetanet-whitepaper-20250312.pdf)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)

## License

MIT
