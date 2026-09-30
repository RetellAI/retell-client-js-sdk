const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

async function main() {
  const root = path.resolve(__dirname, "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "retell-sdk-package-"));
  try {
    const [packed] = JSON.parse(execFileSync("npm", [
      "pack", "--json", "--pack-destination", temp,
    ], { cwd: root, encoding: "utf8" }));
    const pkg = require(path.join(root, "package.json"));
    const files = new Set(packed.files.map((file) => file.path));
    for (const field of ["main", "module", "unpkg", "types"]) {
      assert.ok(files.has(pkg[field]), `Package is missing ${field}: ${pkg[field]}`);
    }
    fs.writeFileSync(path.join(temp, "package.json"), JSON.stringify({ private: true }));
    execFileSync("npm", [
      "install", path.join(temp, packed.filename), "--ignore-scripts",
      "--no-audit", "--no-fund", "--package-lock=false",
    ], { cwd: temp, stdio: "inherit" });
    const installed = path.join(temp, "node_modules", pkg.name);
    const cjs = require(installed);
    const exportedClasses = [
      "RetellClient", "RetellWebClient", "CallSession",
      "WebCallSession", "MonitorSession", "RetellApiError",
    ];
    const esmPath = path.join(installed, "dist", "package-check.mjs");
    fs.copyFileSync(path.join(installed, pkg.module), esmPath);
    const esm = await import(pathToFileURL(esmPath).href);
    const sandbox = {
      TextDecoder,
      TextEncoder,
      eventemitter3: require(path.join(temp, "node_modules", "eventemitter3")),
      livekitClient: require(path.join(temp, "node_modules", "livekit-client")),
    };
    vm.runInNewContext(fs.readFileSync(path.join(installed, pkg.unpkg), "utf8"), sandbox, {
      filename: pkg.unpkg,
      displayErrors: false,
    });
    for (const [format, exports] of [
      ["CommonJS", cjs], ["ES module", esm], ["UMD", sandbox.retellClientJsSdk],
    ]) {
      for (const name of exportedClasses) {
        assert.equal(typeof exports?.[name], "function", `${format} is missing ${name}`);
      }
      let requests = 0;
      const client = new exports.RetellClient({
        key: "public_key_package_check",
        fetch: async (_url, init) => {
          requests++;
          assert.equal(
            new Headers(init.headers).get("X-Retell-Client-JS-SDK-Version"),
            pkg.version,
            `${format} sends the wrong SDK version`,
          );
          return new Response("{}", { status: 200 });
        },
      });
      await client.stopCall("call_package_check");
      assert.equal(requests, 1, `${format} did not use the configured fetch`);
    }
    fs.writeFileSync(path.join(temp, "consumer.ts"), `
import { RetellClient, RetellWebClient, MonitorSession, WebCallSession } from "${pkg.name}";
const client = new RetellClient({ key: "public_key_package_check" });
const monitor: MonitorSession = client.monitorCall({ call_id: "call_package_check" });
const call: WebCallSession = client.createWebCall({ agent_id: "agent_package_check" });
const legacy = new RetellWebClient();
void [monitor, call, legacy];
`);
    execFileSync(process.execPath, [
      require.resolve("typescript/bin/tsc"), "--noEmit", "--strict",
      "--target", "es2017", "--module", "commonjs", "--moduleResolution", "node",
      "--lib", "es2017,es2018.promise,dom,dom.iterable", "--skipLibCheck",
      path.join(temp, "consumer.ts"),
    ], { cwd: root, stdio: "inherit" });
    console.log(`Package smoke checks passed for ${pkg.name}@${pkg.version}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
