/** Integration port only. No provider routes are enabled until a full OIDC flow is implemented. */
export type SocialProvider = "google" | "apple";
export interface VerifiedSocialIdentity {
  provider: SocialProvider;
  issuer: string;
  subject: string;
  email?: string;
  displayName?: string;
}
export interface OidcFlow {
  /** Must persist single-use state, nonce and PKCE verifier server-side, bound to initiating session. */
  begin(provider: SocialProvider): Promise<{ authorizationUrl: string }>;
  /** Must validate code exchange, PKCE, state, nonce, signature/JWKS, issuer/audience/expiry.
   * Identity is provider+subject, NEVER auto-linked by email or Apple relay address.
   * Guest migration requires proof of current guest session and explicit confirmation. */
  complete(
    provider: SocialProvider,
    code: string,
    state: string,
  ): Promise<VerifiedSocialIdentity>;
}
export const socialAvailability = {
  google: { available: false, reason: "OIDC_INTEGRATION_PENDING" },
  apple: { available: false, reason: "OIDC_INTEGRATION_PENDING" },
} as const;
