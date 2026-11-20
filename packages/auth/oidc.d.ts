export type OidcTransaction = {
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
  purpose?: "login" | "link";
  userId?: string;
};

export const OIDC_TRANSACTION_TTL_MS: number;
export function createOidcTransactionCookie(
  transaction: Omit<OidcTransaction, "expiresAt">,
  signingKey: string,
  now?: number,
): string;
export function readOidcTransactionCookie(
  cookie: string | undefined,
  signingKey: string,
  expectedState: string,
  now?: number,
): OidcTransaction | null;
export function resolveOidcCallbackUrl(
  callbackValue: string,
  apiOriginValue: string,
): string;
export function resolveOidcAdminRedirect(
  adminOriginValue: string,
  allowedOriginsValue: string,
): string;
