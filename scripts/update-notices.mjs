import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolve } from "node:path";
import { build } from "esbuild";

const visited = new Map();

async function visit(input) {
  let directory = dirname(resolve(input));
  let pkg;
  while (true) {
    try {
      const candidate = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (candidate.name && candidate.version) { pkg = candidate; break; }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot find package metadata for ${input}`);
    directory = parent;
  }
  const key = `${pkg.name}@${pkg.version}`;
  if (visited.has(key)) return;
  const licenses = (await readdir(directory)).filter(file => /^(licen[cs]e|copying)([.\-_]|$)/i.test(file));
  const texts = await Promise.all(licenses.sort().map(async file => `### ${file}\n\n${(await readFile(join(directory, file), "utf8")).trim()}`));
  if (!texts.length) {
    const readme = (await readdir(directory)).find(file => /^readme(\.md)?$/i.test(file));
    const content = readme ? await readFile(join(directory, readme), "utf8") : "";
    const section = content.match(/^#{1,3}\s+Licen[cs]e[^\n]*\n([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/im)?.[1];
    if (!section?.includes("Permission is hereby granted")) throw new Error(`No complete license text found for ${key}`);
    texts.push(`### License from ${readme}\n\n${section.trim()}`);
  }
  visited.set(key, `## ${key}\n\nDeclared license: ${pkg.license ?? "See license text below"}\n\n${texts.join("\n\n")}`);
}

const result = await build({ entryPoints: ["src/code.ts", "src/ui.ts"], outdir: "dist", bundle: true,
  platform: "browser", format: "iife", write: false, metafile: true, logLevel: "silent" });
for (const input of Object.keys(result.metafile.inputs).filter(input => input.includes("node_modules/"))) await visit(input);
const sections = [...visited.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text);
await writeFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url),
  `# Third-party notices\n\nLicenses for packages included in the plugin's browser bundles, as identified by the bundler. Development tools and dependencies used only in Node.js are not included.\n\nGenerated with \`node scripts/update-notices.mjs\`. Font files are not included in this project.\n\n${sections.join("\n\n---\n\n")}\n`);
console.log(`Recorded licenses for ${visited.size} production packages.`);
