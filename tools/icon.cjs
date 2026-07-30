const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");

async function renderIcon() {
  const svg = fs.readFileSync(path.join(root, "build", "icon.svg"), "utf8");
  await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(path.join(root, "build", "icon.png"));
}

renderIcon().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
