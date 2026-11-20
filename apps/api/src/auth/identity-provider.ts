import { compare, hash } from "bcryptjs";

export const PASSWORD_IDENTITY_PROVIDER = Symbol("PASSWORD_IDENTITY_PROVIDER");

/** Verified external identity. RDPS authorization roles remain local to RDPS. */
export type ExternalIdentity = {
  issuer: string;
  subject: string;
  email: string;
  displayName: string;
};

/** Authorization-code contract for provider adapters that join the local identity lifecycle. */
export interface ExternalIdentityProvider {
  readonly providerId: string;
  createAuthorizationUrl(input: {
    redirectUri: string;
    state: string;
    nonce: string;
  }): Promise<string>;
  exchangeAuthorizationCode(input: {
    code: string;
    redirectUri: string;
    state: string;
    expectedState: string;
    nonce: string;
  }): Promise<ExternalIdentity>;
}

export interface PasswordIdentityProvider {
  hashPassword(password: string, cost: number): Promise<string>;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
}

/** Local password implementation behind the same service boundary. */
export class LocalPasswordIdentityProvider implements PasswordIdentityProvider {
  hashPassword(password: string, cost: number) {
    return hash(password, cost);
  }

  verifyPassword(password: string, passwordHash: string) {
    return compare(password, passwordHash);
  }
}
