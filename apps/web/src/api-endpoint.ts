/** Device builds require a public HTTPS API; a Mac loopback address cannot work. */
export function nativeApiUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return "";
    return url.origin;
  } catch {
    return "";
  }
}
