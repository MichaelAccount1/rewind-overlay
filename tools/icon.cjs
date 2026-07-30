const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");

async function renderIcon() {
  for (const [name, size] of [["icon", 512], ["tray", 64]]) {
    const svg = fs.readFileSync(path.join(root, "build", `${name}.svg`), "utf8");
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(root, "build", `${name}.png`));
  }
}

renderIcon().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
