/** Google uses an ID-token flow with a server-issued, single-use nonce challenge.
 * Production signature/audience/issuer verification lives in google.ts; auth.ts binds
 * challenges to web cookies or a native proof before issuing our own session.
 * Apple is intentionally not configured and is omitted from the login UI.
 */
export type SocialProvider = "google" | "apple";
