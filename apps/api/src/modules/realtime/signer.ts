import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';

/**
 * SigV4 signing for the two AWS calls this app makes directly: SQS SendMessageBatch
 * from the API, and AppSync EventPublish from the publisher.
 *
 * Signing by hand rather than pulling in @aws-sdk/client-sqs or an AppSync client is
 * a deliberate continuation of the policy lambda.ts sets out at length: secrets are
 * fetched over plain fetch from the Secrets extension specifically to keep "1-3 MB
 * of SDK added to the bundle and parsed on every cold start" off the critical path.
 * Both calls here are a single signed POST, so a service client would be almost
 * entirely packaging. @smithy/signature-v4 is ~150 KB and does the one hard part.
 *
 * @smithy/signature-v4, NOT @aws-sdk/signature-v4: the latter is now a deprecated
 * re-export shim around exactly this package.
 *
 * Credentials come straight from the environment rather than through
 * @aws-sdk/credential-providers. The Lambda runtime always populates these three,
 * and the provider chain's fallbacks (IMDS probing, config-file parsing) are pure
 * cost for a process that will never need them.
 */

export interface SignedRequestInit {
  method: 'POST';
  hostname: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface Signer {
  sign(req: SignedRequestInit): Promise<Record<string, string>>;
}

export function createSigner(service: string, region: string): Signer {
  // Constructed lazily by the caller, never at module scope of anything statically
  // imported by lambda.ts - that module fetches secrets and assigns process.env
  // AFTER its own imports evaluate.
  const signer = new SignatureV4({
    service,
    region,
    sha256: Sha256,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      sessionToken: process.env.AWS_SESSION_TOKEN,
    },
  });

  return {
    async sign(req) {
      const signed = await signer.sign({
        method: req.method,
        protocol: 'https:',
        hostname: req.hostname,
        path: req.path,
        // `host` must be present and must match the hostname, or the signature is
        // computed over a different canonical request than the one AWS reconstructs
        // and the call fails as an opaque 403.
        headers: { ...req.headers, host: req.hostname },
        body: req.body,
      } as Parameters<typeof signer.sign>[0]);

      return (signed as { headers: Record<string, string> }).headers;
    },
  };
}
