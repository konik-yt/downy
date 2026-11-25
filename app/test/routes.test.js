const test = require("node:test");
const assert = require("node:assert/strict");
const { listRoutes, defaultAddress, detectRoutes } = require("../src/main/routes");

test("listRoutes filters internal, IPv6, and link-local addresses and puts primary first", () => {
  const fake = {
    Loopback: [
      { address: "127.0.0.1", family: "IPv4", internal: true },
      { address: "::1", family: "IPv6", internal: true },
    ],
    Ethernet: [
      { address: "fe80::1", family: "IPv6", internal: false },
      { address: "169.254.10.20", family: "IPv4", internal: false },
      { address: "192.168.1.50", family: "IPv4", internal: false },
    ],
    "Wi-Fi": [
      { address: "10.0.0.25", family: "IPv4", internal: false },
    ],
    USB: [
      { address: "172.20.10.2", family: 4, internal: false },
    ],
  };

  assert.deepEqual(listRoutes(fake, "10.0.0.25"), [
    { name: "Wi-Fi", address: "10.0.0.25", primary: true },
    { name: "Ethernet", address: "192.168.1.50", primary: false },
    { name: "USB", address: "172.20.10.2", primary: false },
  ]);

  assert.deepEqual(listRoutes(fake, ""), [
    { name: "Ethernet", address: "192.168.1.50", primary: false },
    { name: "Wi-Fi", address: "10.0.0.25", primary: false },
    { name: "USB", address: "172.20.10.2", primary: false },
  ]);
});

test("defaultAddress and detectRoutes return valid shapes", async () => {
  const addr = await defaultAddress();
  assert.equal(typeof addr, "string");
  const routes = await detectRoutes();
  assert.ok(Array.isArray(routes));
});
