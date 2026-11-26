import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * SSRF protection for user-supplied webhook URLs.
 *
 * A URL is accepted only if every address its host resolves to is a public one.
 * This check at registration time is NOT sufficient by itself: DNS can change
 * afterwards (rebinding). The delivery worker must call this again and connect to
 * one of the returned addresses, with redirects disabled.
 */

/** Non-public IPv4 ranges (IANA special-purpose registry, plus cloud metadata). */
const blockedV4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT (includes Alibaba metadata)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, AWS/GCP/Azure metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
  ["168.63.129.16", 32], // Azure platform endpoint
] as const) {
  blockedV4.addSubnet(network, prefix, "ipv4");
}

// IPv6 is allow-listed: only global unicast, minus its special-purpose blocks.
// Everything else (::1, fc00::/7, fe80::/10, ff00::/8, IPv4-mapped, NAT64) is refused.
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ["2001::", 23], // IETF protocol assignments, incl. Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds an IPv4 address)
  ["3fff::", 20], // documentation
] as const) {
  blockedV6.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return !blockedV4.check(address, "ipv4");
    case 6:
      return globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
    default:
      return false;
  }
}

/** Names that only make sense inside a private network. */
const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];
const MAX_URL_LENGTH = 2048;
const DNS_TIMEOUT_MS = 5000;

export type Resolver = (hostname: string) => Promise<string[]>;

export const systemResolver: Resolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

export interface UrlPolicy {
  /** Plain http is allowed outside production only. */
  allowHttp: boolean;
  /** Exact `host:port` values exempt from the address checks (local test receivers). */
  allowedPrivateHosts: readonly string[];
  resolve?: Resolver;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export interface SafeUrl {
  url: URL;
  /** Addresses that passed the check; the sender should connect to one of these. */
  addresses: string[];
}

function resolveWithTimeout(resolve: Resolver, hostname: string): Promise<string[]> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("DNS lookup timed out")), DNS_TIMEOUT_MS);
  });
  return Promise.race([resolve(hostname), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Validates a webhook destination URL. Throws UnsafeUrlError with a message that is
 * safe to show the user (it never reveals what an internal name resolved to).
 */
export async function assertSafeUrl(input: string, policy: UrlPolicy): Promise<SafeUrl> {
  if (input.length > MAX_URL_LENGTH) throw new UnsafeUrlError("URL is too long");

  let url: URL;
  try {
    // WHATWG parsing also normalises tricks like http://2130706433 to 127.0.0.1
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("Must be a valid absolute URL");
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && policy.allowHttp)) {
    throw new UnsafeUrlError(policy.allowHttp ? "Only http and https are allowed" : "Only https is allowed");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URL must not contain credentials");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const exempt = policy.allowedPrivateHosts.includes(`${url.hostname}:${port}`);
  const isLiteral = isIP(hostname) !== 0;
  const notAllowed = new UnsafeUrlError("URL must point to a public host");

  if (
    !exempt &&
    !isLiteral &&
    (!hostname.includes(".") || INTERNAL_SUFFIXES.some((s) => hostname.endsWith(s)))
  ) {
    throw notAllowed;
  }

  let addresses: string[];
  if (isLiteral) {
    addresses = [hostname];
  } else {
    try {
      addresses = await resolveWithTimeout(policy.resolve ?? systemResolver, hostname);
    } catch {
      throw new UnsafeUrlError("Could not resolve the URL's host");
    }
    if (addresses.length === 0) throw new UnsafeUrlError("Could not resolve the URL's host");
  }

  // One private address among public ones is enough to refuse
  if (!exempt && !addresses.every(isPublicAddress)) throw notAllowed;

  return { url, addresses };
}
