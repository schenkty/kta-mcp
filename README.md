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

### Configure (Recommended: Both MCP Servers)

Agents building on Keeta should use **two MCP servers together**:

1. **`keeta-docs`** — The Keeta documentation MCP (hosted by GitBook) provides searchable protocol knowledge: architecture, anchor system, SDK references, tutorials
2. **`keeta-sdk`** — This server provides the tools to execute operations on the network

#### Claude Code

```bash
# Add the Keeta docs MCP (read the docs, understand the protocol)
claude mcp add --transport http keeta-docs https://docs.keeta.com/~gitbook/mcp

# Add the Keeta SDK MCP (execute operations on the network)
claude mcp add keeta-sdk node /absolute/path/to/kta-mcp/build/index.js
```

#### Claude Desktop / Other MCP Clients

```json
{
  "mcpServers": {
    "keeta-docs": {
      "type": "url",
      "url": "https://docs.keeta.com/~gitbook/mcp"
    },
    "keeta-sdk": {
      "command": "node",
      "args": ["/absolute/path/to/kta-mcp/build/index.js"]
    }
  }
}
```

> **Why both?** The docs MCP gives agents the *knowledge* to build correctly (protocol rules, anchor architecture, metadata formats, compliance requirements). The SDK MCP gives agents the *tools* to execute. Using only the SDK server without understanding the protocol is like having a hammer without knowing what you're building.

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
│  DISCOVERY TOOL (runtime introspection)                              │
│  keeta_list_sdk_methods      → introspect any SDK object:           │
│    "AnchorCatalog"           → auto-discover ALL anchor services    │
│    "AnchorService:<Name>"    → drill into any service by name       │
│    "AnchorLib:<Name>"        → drill into any lib module by name    │
│    "Client/UserClient/..."   → core SDK introspection               │
├─────────────────────────────────────────────────────────────────────┤
│  EXECUTION TOOLS (generic, call any SDK method by name)             │
│  keeta_client_execute        → read-only network queries            │
│  keeta_user_client_execute   → authenticated account operations     │
│  keeta_builder_execute       → batch operations → publish           │
│  keeta_anchor_execute        → ANY anchor service or lib module     │
│    subtarget: "service"      → dynamic: FX, KYC, AssetMovement...  │
│    subtarget: "lib"          → dynamic: Resolver, Certificates...   │
│    subtarget: "metadata"     → Resolver.Metadata shortcuts          │
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

### Step 0: Read the Documentation (keeta-docs MCP)

**Before writing any code**, use the Keeta docs MCP server to understand the protocol:

```
# Via the keeta-docs MCP server (https://docs.keeta.com/~gitbook/mcp):
# - Search for "anchors" to understand the anchor system
# - Search for "block operations" to understand transaction types
# - Search for "permissions" to understand access control
# - Search for "certificates" to understand KYC/identity
# - Search for "tokenization" to understand native token creation
```

The docs MCP provides full access to https://docs.keeta.com/ — architecture guides, anchor system documentation, SDK references, and tutorials. This is essential context for building anything beyond basic transfers.

You can also read the `keeta://docs/mcp-config` resource from this server for setup details and key documentation links.

### Step 1: Discover What's Available

Introspect the SDK to understand current capabilities:

```
keeta_list_sdk_methods({ target: "AnchorCatalog" }) → all anchor services & lib modules
keeta_list_sdk_methods({ target: "Client" })        → read-only methods
keeta_list_sdk_methods({ target: "UserClient" })     → authenticated methods
keeta_list_sdk_methods({ target: "Builder" })        → builder/batch methods
keeta_list_sdk_methods({ target: "Account" })        → account utilities + enums
keeta_list_sdk_methods({ target: "Block" })          → block types + operation types
keeta_list_sdk_methods({ target: "Config" })         → network configuration
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
1. keeta_anchor_execute({ network: "test", subtarget: "service", serviceName: "FX", method: "getQuotes", args: [{ from: "keeta_kta...", to: "$USDC", amount: "BIGINT:1000000", affinity: "from" }] })
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
  subtarget: "lib",
  libModule: "Resolver",
  method: "getRootMetadata",
  args: []
})
```

### KYC Identity Verification

```
// Discover KYC methods first
keeta_list_sdk_methods({ target: "AnchorKYCClient" })

// Start a KYC verification request
keeta_anchor_execute({
  network: "test", seed, subtarget: "service", serviceName: "KYC",
  method: "createVerification",
  args: [{ account: "keeta_user...", countryCodes: ["US"] }]
})

// Get supported countries
keeta_anchor_execute({ network: "test", subtarget: "service", serviceName: "KYC", method: "getSupportedCountries", args: [] })
```

### Cross-Chain Asset Movement

```
// Find providers for a specific asset transfer
keeta_anchor_execute({
  network: "test", seed, subtarget: "service", serviceName: "AssetMovement",
  method: "getProvidersForTransfer",
  args: [{ asset: { token: "keeta_usdc..." }, from: { location: "keeta" }, to: { location: "base" } }]
})

// Provider methods (after getting a provider): initiateTransfer, getTransferStatus,
// createPersistentForwardingAddress, listForwardingAddresses, listTransactions, shareKYCAttributes
```

### Username Management

```
// Resolve a username to an account
keeta_anchor_execute({
  network: "test", subtarget: "service", serviceName: "Username",
  method: "resolve",
  args: ["alice@provider"]
})

// Search usernames
keeta_anchor_execute({
  network: "test", subtarget: "service", serviceName: "Username",
  method: "search",
  args: [{ search: "alice" }]
})

// Claim a username (requires funded account)
keeta_anchor_execute({
  network: "test", seed, subtarget: "service", serviceName: "Username",
  method: "claimUsername",
  args: ["alice@provider", { account: "keeta_user..." }]
})
```

### Push Notifications

```
// Get notification providers
keeta_anchor_execute({
  network: "test", subtarget: "service", serviceName: "Notification",
  method: "getProviders",
  args: []
})
// Provider methods: registerTarget, listTargets, deleteTarget,
// createSubscription, listSubscriptions, deleteSubscription
```

### Encrypted Containers & Certificates

```
// Create an encrypted container for sensitive data
keeta_anchor_execute({
  network: "test", subtarget: "lib", libModule: "EncryptedContainer",
  method: "fromPlaintext",
  args: ["BUFFER_B64:aGVsbG8gd29ybGQ="]
})

// Parse a Keeta URI
keeta_anchor_execute({
  network: "test", subtarget: "lib", libModule: "URI",
  method: "parseKeetaURI",
  args: ["keeta://..."]
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

### Core SDK

| Target | What It Exposes | When To Use |
|---|---|---|
| `Client` | Read-only methods: `getAccountInfo`, `getBalance`, `getAllBalances`, `getHeadBlock`, `getBlock`, `getHistory`, `getTokenSupply`, `getNetworkStatus`, `getPeers`, `getVersion`, `getLedgerChecksum`, `getAllCertificates`, `getAllRepresentativeInfo` | Querying the network without an account |
| `UserClient` | All Client methods plus: `send`, `setInfo`, `generateIdentifier`, `allBalances`, `balance`, `head`, `chain`, `history`, `state`, `updatePermissions`, `createSwapRequest`, `transmit`, `listACLsByPrincipal`, `getCertificates`, `modifyCertificate`, `sync` | Any operation requiring an account |
| `Builder` | Batch operations: `send`, `receive`, `setInfo`, `modifyTokenSupply`, `modifyTokenBalance`, `computeBlocks`, `publish` | Multi-step operations that should execute atomically |
| `Account` | Static utilities: `fromSeed`, `fromPublicKeyString`, `generateRandomSeed`, `generateNetworkAddress`, `seedFromPassphrase`, `isIdentifierKeyType` + `AccountKeyAlgorithm` enum | Account creation and key management |
| `Block` | Block construction: `Builder`, `OperationType` enum, `AdjustMethod` enum, `NO_PREVIOUS` | Low-level block building |
| `Permissions` | Permission construction methods | Access control |
| `Config` | `getDefaultConfig` | Network configuration |

### Anchor SDK (Fully Dynamic)

Anchor services and lib modules are **not hardcoded** — they are auto-discovered from SDK exports at runtime. When the SDK adds new services, they appear automatically.

**Discovery flow:**
```
keeta_list_sdk_methods({ target: "AnchorCatalog" })
  → lists all services and lib modules with their methods

keeta_list_sdk_methods({ target: "AnchorService:FX" })
  → drill into a specific service

keeta_list_sdk_methods({ target: "AnchorLib:Resolver" })
  → drill into a specific lib module
```

**Execution flow:**
```
keeta_anchor_execute({
  subtarget: "service",
  serviceName: "FX",        ← any service name from the catalog
  method: "getQuotes",
  args: [...]
})

keeta_anchor_execute({
  subtarget: "lib",
  libModule: "Resolver",    ← any lib module from the catalog
  method: "getRootMetadata",
  args: []
})
```

**Currently discovered services** (as of anchor SDK v0.0.49):

| Service | Methods | Purpose |
|---|---|---|
| `FX` | `getQuotes`, `getEstimates`, `getPrices`, `listPossibleConversions`, etc. | Foreign exchange and token swaps |
| `KYC` | `createVerification`, `getCertificates`, `getSupportedCountries` | Identity verification |
| `AssetMovement` | `getProvidersForTransfer`, `getProviderByID` → provider: `initiateTransfer`, `createPersistentForwardingAddress`, `listTransactions`, `shareKYCAttributes` | Cross-chain/cross-rail transfers |
| `Username` | `resolve`, `resolveMulti`, `claimUsername`, `search`, `signUsernameTransfer` | On-chain usernames |
| `Notification` | `getProviders`, `getProvider` → provider: `registerTarget`, `createSubscription`, `listSubscriptions` | Push notifications |

**Currently discovered lib modules:**

| Module | Type | Key Members |
|---|---|---|
| `Resolver` | class | `getRootMetadata`, `lookup`, `listTokens`, `listTransferableAssets`, `clearCache`, `Metadata` (static) |
| `Certificates` | namespace | `Certificate`, `CertificateBuilder`, `SensitiveAttribute`, `SharableCertificateAttributes` |
| `EncryptedContainer` | class | `fromPlaintext`, `fromEncryptedBuffer`, `grantAccess`, `revokeAccess`, `getPlaintext`, `verifySignature` |
| `URI` | namespace | `parseKeetaURI`, `encodeKeetaURI`, `assertKeetaURIString` |

**Future services and modules will auto-appear in the catalog without MCP server changes.**

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
- [`@keetanetwork/anchor`](https://github.com/KeetaNetwork/anchor) — Anchor SDK (FX, KYC, asset movement, usernames, notifications, resolver, certificates, encrypted containers, URI)
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
