export interface VerificationProvider {
  start(phone: string): Promise<string>;
  check(reference: string, code: string): Promise<boolean>;
}
export class UnavailableVerification implements VerificationProvider {
  async start(_phone: string): Promise<string> {
    throw Error("PROVIDER_NOT_CONFIGURED");
  }
  async check(_reference: string, _code: string): Promise<boolean> {
    throw Error("PROVIDER_NOT_CONFIGURED");
  }
}
export class TwilioVerify implements VerificationProvider {
  constructor(
    private account: string,
    private secret: string,
    private service: string,
  ) {
    if (
      !/^AC[a-fA-F0-9]{32}$/.test(account) ||
      !/^VA[a-fA-F0-9]{32}$/.test(service) ||
      !secret
    )
      throw Error("Invalid Twilio configuration");
  }
  private async call(path: string, body: URLSearchParams) {
    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${this.service}/${path}`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(this.account + ":" + this.secret).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw Error("VERIFICATION_PROVIDER_UNAVAILABLE");
    return (await response.json()) as { sid: string; status: string };
  }
  async start(phone: string) {
    return (
      await this.call(
        "Verifications",
        new URLSearchParams({ To: phone, Channel: "whatsapp" }),
      )
    ).sid;
  }
  async check(reference: string, code: string) {
    return (
      (
        await this.call(
          "VerificationCheck",
          new URLSearchParams({ VerificationSid: reference, Code: code }),
        )
      ).status === "approved"
    );
  }
}
