import * as KeetaNet from "@keetanetwork/keetanet-client";
import * as KeetaAnchor from "@keetanetwork/anchor";
import type { Networks } from "@keetanetwork/keetanet-client/config/index.js";
import type { JSONSerializable } from "@keetanetwork/keetanet-client/lib/utils/conversion.js";

export const DPO: (input: unknown) => JSONSerializable =
  KeetaNet.lib.Utils.Helper.debugPrintableObject.bind(
    KeetaNet.lib.Utils.Helper
  );

export type NetworkAlias = Networks;

const VALID_NETWORKS = ["main", "test"] as const;

export function validateNetwork(network: string): NetworkAlias {
  if (!VALID_NETWORKS.includes(network as (typeof VALID_NETWORKS)[number])) {
    throw new Error(
      `Invalid network "${network}". Must be one of: ${VALID_NETWORKS.join(", ")}`
    );
  }
  return network as NetworkAlias;
}

export function createClient(network: NetworkAlias) {
  return KeetaNet.Client.fromNetwork(network);
}

export function createUserClient(network: NetworkAlias, account: unknown) {
  return KeetaNet.UserClient.fromNetwork(network, account as any);
}

export function accountFromSeed(
  seed: string,
  index: number,
  algorithm?: string
) {
  const algo = resolveKeyAlgorithm(algorithm);
  return KeetaNet.lib.Account.fromSeed(seed, index, algo) as any;
}

export function accountFromPublicKey(publicKey: string) {
  return KeetaNet.lib.Account.fromPublicKeyString(publicKey) as any;
}

export function generateSeed(): string {
  return KeetaNet.lib.Account.generateRandomSeed({
    asString: true,
  }) as string;
}

export function resolveKeyAlgorithm(algorithm?: string) {
  if (!algorithm)
    return KeetaNet.lib.Account.AccountKeyAlgorithm.ECDSA_SECP256K1;
  const upper = algorithm.toUpperCase();
  const mapping: Record<string, any> = {
    ECDSA_SECP256K1: KeetaNet.lib.Account.AccountKeyAlgorithm.ECDSA_SECP256K1,
    SECP256K1: KeetaNet.lib.Account.AccountKeyAlgorithm.ECDSA_SECP256K1,
    ECDSA_SECP256R1: KeetaNet.lib.Account.AccountKeyAlgorithm.ECDSA_SECP256R1,
    SECP256R1: KeetaNet.lib.Account.AccountKeyAlgorithm.ECDSA_SECP256R1,
    ED25519: KeetaNet.lib.Account.AccountKeyAlgorithm.ED25519,
    TOKEN: KeetaNet.lib.Account.AccountKeyAlgorithm.TOKEN,
    STORAGE: KeetaNet.lib.Account.AccountKeyAlgorithm.STORAGE,
    MULTISIG: KeetaNet.lib.Account.AccountKeyAlgorithm.MULTISIG,
  };
  const result = mapping[upper];
  if (result === undefined) {
    throw new Error(
      `Unknown key algorithm "${algorithm}". Valid: ${Object.keys(mapping).join(", ")}`
    );
  }
  return result;
}

/**
 * Resolve a single argument value from its JSON representation.
 * Handles special string patterns:
 *  - "keeta_..." → Account.fromPublicKeyString
 *  - "ALGO:SECP256K1" → AccountKeyAlgorithm enum
 *  - "PERM:ACCESS,ADMIN" → Permissions object
 *  - "BIGINT:12345" → BigInt
 *  - "BUFFER_B64:..." → Buffer from base64
 *  - Plain strings, numbers, booleans, objects, arrays pass through
 */
export function resolveArg(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "boolean" || typeof value === "number") return value;

  if (typeof value === "string") {
    // Keeta address → Account object
    if (value.startsWith("keeta_")) {
      return accountFromPublicKey(value);
    }
    // Algorithm enum
    if (value.startsWith("ALGO:")) {
      return resolveKeyAlgorithm(value.slice(5));
    }
    // Permissions
    if (value.startsWith("PERM:")) {
      const flags = value.slice(5).split(",");
      return new KeetaNet.lib.Permissions(flags as any);
    }
    // BigInt
    if (value.startsWith("BIGINT:")) {
      return BigInt(value.slice(7));
    }
    // Buffer from base64
    if (value.startsWith("BUFFER_B64:")) {
      return Buffer.from(value.slice(11), "base64");
    }
    // AdjustMethod enum
    if (value.startsWith("ADJUST:")) {
      const method = value.slice(7).toUpperCase();
      return (KeetaNet.lib.Block.AdjustMethod as any)[method];
    }
    // OperationType enum
    if (value.startsWith("OP:")) {
      const op = value.slice(3).toUpperCase();
      return (KeetaNet.lib.Block.OperationType as any)[op];
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(resolveArg);
  }

  if (typeof value === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      resolved[k] = resolveArg(v);
    }
    return resolved;
  }

  return value;
}

/**
 * Resolve an array of arguments — each element goes through resolveArg.
 */
export function resolveArgs(args: unknown[]): unknown[] {
  return args.map(resolveArg);
}

/**
 * Introspect an object and return its method names (own + prototype, excluding constructor).
 */
export function listMethods(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];
  const methods = new Set<string>();
  let current = obj;
  while (current && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (
        name !== "constructor" &&
        typeof (obj as any)[name] === "function"
      ) {
        methods.add(name);
      }
    }
    current = Object.getPrototypeOf(current);
  }
  return [...methods].sort();
}

/**
 * Introspect an object and return its non-function property names.
 */
export function listProperties(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];
  const props = new Set<string>();
  let current = obj;
  while (current && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (
        name !== "constructor" &&
        typeof (obj as any)[name] !== "function"
      ) {
        props.add(name);
      }
    }
    current = Object.getPrototypeOf(current);
  }
  return [...props].sort();
}

/**
 * Safely serialize any SDK return value into a JSON-friendly format.
 */
export function safeSerialize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[Function]";
  if (typeof value === "symbol") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");

  // If the value has a toJSON method, use it
  if (typeof value === "object" && value !== null && "toJSON" in value && typeof (value as any).toJSON === "function") {
    return safeSerialize((value as any).toJSON());
  }

  // PublicKeyString objects from the SDK
  if (typeof value === "object" && value !== null && "get" in value && typeof (value as any).get === "function") {
    try {
      return (value as any).get();
    } catch {
      // fall through
    }
  }

  // Use DPO for SDK objects that support it
  try {
    const dpo = DPO(value);
    return dpo;
  } catch {
    // fall through
  }

  if (Array.isArray(value)) {
    return value.map(safeSerialize);
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = safeSerialize(v);
    }
    return result;
  }

  return value;
}

export function formatResult(data: unknown): string {
  return JSON.stringify(safeSerialize(data), null, 2);
}

export { KeetaNet, KeetaAnchor };
