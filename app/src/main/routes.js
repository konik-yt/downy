const os = require("os");
const dgram = require("dgram");
const { Agent } = require("undici");

const agents = new Map();

function listRoutes(interfaces = os.networkInterfaces(), defaultAddr = "") {
  const routes = [];
  for (const [name, addrs] of Object.entries(interfaces || {})) {
    for (const info of addrs || []) {
      if (!info || info.internal) continue;
      if (info.family !== "IPv4" && info.family !== 4) continue;
      if (!info.address || info.address.startsWith("169.254.")) continue;
      routes.push({ name, address: info.address, primary: info.address === defaultAddr });
    }
  }
  return routes.sort((a, b) => Number(b.primary) - Number(a.primary));
}

function defaultAddress() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;
    const finish = (addr) => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {}
      resolve(addr);
    };
    socket.once("error", () => finish(""));
    try {
      socket.connect(53, "8.8.8.8", (err) => {
        if (err) return finish("");
        try {
          finish(socket.address().address || "");
        } catch {
          finish("");
        }
      });
    } catch {
      finish("");
    }
  });
}

async function detectRoutes() {
  return listRoutes(os.networkInterfaces(), await defaultAddress());
}

function agentFor(address) {
  let agent = agents.get(address);
  if (!agent) {
    // localAddress must be top-level; undici 6 ignores it inside connect.
    agent = new Agent({ localAddress: address, connect: { timeout: 5000 } });
    agents.set(address, agent);
  }
  return agent;
}

module.exports = { listRoutes, defaultAddress, detectRoutes, agentFor };
