import { readFile, mkdir, writeFile } from "node:fs/promises";
import JSZip from "jszip";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const zip = new JSZip();
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const files = ["manifest.json", manifest.main, manifest.ui, "README.md", "LICENSE", "PRIVACY.md", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md", "CONTRIBUTING.md", "docs/RELEASING.md"];

for (const file of files) {
  const data = await readFile(file);
  if (!data.length) throw new Error(`Release file is empty: ${file}`);
  zip.file(file, data);
}

await mkdir("releases", { recursive: true });
const output = `releases/deckbridge-v${pkg.version}.zip`;
await writeFile(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`Plugin package: ${output}`);
