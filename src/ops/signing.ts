/**
 * ECDSA P-256 signing with WebCrypto. The private key is generated in this browser
 * session and is non-extractable: page code can ask it to sign but cannot read it.
 *
 * Limit, stated plainly: the guard, the agent and the executor all run in the same
 * page here, so this proves the executor checks Edge Guard's signature, not that the
 * signer is isolated from the agent. In production the signer belongs in a separate
 * trust boundary (a server or an extension) whose public key the executor pins.
 */
export const SIGNATURE_ALGORITHM = "ecdsa-p256-sha256";

export interface Signer {
  sign(message: string): Promise<string>;
  verify(message: string, signature: string): Promise<boolean>;
}

const keyParams = { name: "ECDSA", namedCurve: "P-256" } as const;
const signParams = { name: "ECDSA", hash: "SHA-256" } as const;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) return new Uint8Array(0);
  return new Uint8Array(hex.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? []);
}

export async function createSigner(): Promise<Signer> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(keyParams, false, [
    "sign",
    "verify",
  ]);
  const encode = (message: string) => new TextEncoder().encode(message);

  return {
    async sign(message) {
      return toHex(await crypto.subtle.sign(signParams, privateKey, encode(message)));
    },
    async verify(message, signature) {
      try {
        return await crypto.subtle.verify(signParams, publicKey, fromHex(signature), encode(message));
      } catch {
        return false;
      }
    },
  };
}
