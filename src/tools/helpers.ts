import * as KeetaNet from "@keetanetwork/keetanet-client";
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

export function createUserClient(
  network: NetworkAlias,
  account: unknown
) {
  return KeetaNet.UserClient.fromNetwork(network, account as any);
}

export function accountFromSeed(seed: string, index: number, algorithm?: string) {
  const algo = resolveKeyAlgorithm(algorithm);
  // Cast needed: SDK uses branded types (Account<ECDSA_SECP256K1>) but fromSeed
  // returns Account<AccountKeyAlgorithm> when algorithm is dynamic
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

export function resolveKeyAlgorithm(
  algorithm?: string
): typeof KeetaNet.lib.Account.AccountKeyAlgorithm[keyof typeof KeetaNet.lib.Account.AccountKeyAlgorithm] {
  if (!algorithm) return KeetaNet.lib.Account.AccountKeyAlgorithm.ECDSA_SECP256K1;
  const upper = algorithm.toUpperCase();
  const mapping: Record<string, typeof KeetaNet.lib.Account.AccountKeyAlgorithm[keyof typeof KeetaNet.lib.Account.AccountKeyAlgorithm]> = {
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

export async function getAccountMetadata(
  network: NetworkAlias,
  account?: unknown
): Promise<unknown> {
  await using userClient = createUserClient(network, null);
  const accountInfo = await userClient.client.getAccountInfo(
    (account ?? userClient.baseToken) as any
  );
  const metadataBuffer = Buffer.from(accountInfo.info.metadata, "base64");
  const networkMetadata =
    KeetaNet.lib.Utils.Helper.bufferToArrayBuffer(metadataBuffer);
  let metadataUncompressed: ArrayBuffer;
  try {
    metadataUncompressed =
      KeetaNet.lib.Utils.Buffer.ZlibInflate(networkMetadata);
  } catch {
    metadataUncompressed = networkMetadata;
  }
  const metadataBytes = Buffer.from(metadataUncompressed);
  return JSON.parse(metadataBytes.toString("utf-8"));
}

export async function getTokenDecimals(
  network: NetworkAlias,
  token?: unknown
): Promise<number | null> {
  const tokenMetadata = await getAccountMetadata(network, token);
  if (
    tokenMetadata &&
    typeof tokenMetadata === "object" &&
    "decimalPlaces" in tokenMetadata &&
    (typeof tokenMetadata.decimalPlaces === "number" ||
      typeof tokenMetadata.decimalPlaces === "string")
  ) {
    return Number(tokenMetadata.decimalPlaces);
  }
  return null;
}

export function formatResult(data: unknown): string {
  return JSON.stringify(DPO(data), null, 2);
}

export { KeetaNet };
