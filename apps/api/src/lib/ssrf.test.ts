import { describe, it, expect } from "vitest";
import { assertSafeUrl, isPublicAddress, type UrlPolicy } from "./ssrf.js";

const resolvesTo =
  (...addresses: string[]) =>
  async () =>
    addresses;

const policy: UrlPolicy = {
  allowHttp: false,
  allowedPrivateHosts: [],
  resolve: resolvesTo("93.184.215.14"),
};

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "93.184.215.14", "172.32.0.1", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => expect(isPublicAddress(address)).toBe(true)
  );

  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.100.100.200",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "168.63.129.16",
    "::",
    "::1",
    "fc00::1",
    "fd00:ec2::254",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "64:ff9b::a9fe:a9fe",
    "2001:db8::1",
    "2002:7f00:1::",
    "not-an-ip",
  ])("blocks %s", (address) => expect(isPublicAddress(address)).toBe(false));
});

describe("assertSafeUrl", () => {
  it("accepts a public https URL and returns the checked addresses", async () => {
    const result = await assertSafeUrl("https://hooks.example.com/in?x=1", policy);
    expect(result.url.href).toBe("https://hooks.example.com/in?x=1");
    expect(result.addresses).toEqual(["93.184.215.14"]);
  });

  it.each([
    "not a url",
    "/relative/path",
    "ftp://example.com/",
    "file:///etc/passwd",
    "gopher://example.com/",
    "http://hooks.example.com/", // http not allowed by this policy
    "https://user:pass@hooks.example.com/",
    "https://localhost/",
    "https://LOCALHOST./",
    "https://api.localhost/",
    "https://intranet/",
    "https://printer.local/",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://127.0.0.1/",
    "https://2130706433/", // 127.0.0.1 as a decimal number
    "https://0x7f.1/",
    "https://0177.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[::ffff:169.254.169.254]/",
    `https://hooks.example.com/${"a".repeat(2048)}`,
  ])("rejects %s", async (url) => {
    await expect(assertSafeUrl(url, policy)).rejects.toMatchObject({ name: "UnsafeUrlError" });
  });

  it("rejects a public-looking name that resolves to a private address", async () => {
    const rebinding = { ...policy, resolve: resolvesTo("10.0.0.5") };
    await expect(assertSafeUrl("https://sneaky.example.com/", rebinding)).rejects.toThrow(
      "public host"
    );
  });

  it("rejects when any one of several resolved addresses is private", async () => {
    const mixed = { ...policy, resolve: resolvesTo("93.184.215.14", "127.0.0.1") };
    await expect(assertSafeUrl("https://mixed.example.com/", mixed)).rejects.toThrow("public host");
  });

  it("rejects hosts that do not resolve", async () => {
    const failing = {
      ...policy,
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    };
    await expect(assertSafeUrl("https://nope.example.com/", failing)).rejects.toThrow("resolve");
    await expect(
      assertSafeUrl("https://empty.example.com/", { ...policy, resolve: resolvesTo() })
    ).rejects.toThrow("resolve");
  });

  it("exempts only the exact allow-listed host and port", async () => {
    const local: UrlPolicy = {
      allowHttp: true,
      allowedPrivateHosts: ["localhost:4100"],
      resolve: resolvesTo("127.0.0.1"),
    };

    await expect(assertSafeUrl("http://localhost:4100/hook", local)).resolves.toBeDefined();
    await expect(assertSafeUrl("http://localhost:5432/", local)).rejects.toThrow("public host");
    await expect(assertSafeUrl("http://127.0.0.1:4100/", local)).rejects.toThrow("public host");
  });
});
