// Keeps src/version.ts in step with package.json so the SDK can compare
// itself against the backend's minimum-version header.
const fs = require("fs");
const path = require("path");
const { version } = require("../package.json");
fs.writeFileSync(
  path.join(__dirname, "..", "src", "version.ts"),
  `// Generated from package.json by \`npm run build\`; do not edit.\nexport const SDK_VERSION = "${version}";\n`,
);
