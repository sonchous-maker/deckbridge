import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const outdir = "dist";
await mkdir(outdir, { recursive: true });

const sharedOptions = {
  bundle: true,
  sourcemap: true,
  target: "es2020",
  logLevel: "info"
};

async function buildOnce() {
  await esbuild.build({
    ...sharedOptions,
    entryPoints: ["src/code.ts"],
    outfile: `${outdir}/code.js`,
    platform: "browser",
    format: "iife"
  });

  const uiBundle = await esbuild.build({
    ...sharedOptions,
    entryPoints: ["src/ui.ts"],
    outfile: `${outdir}/ui.js`,
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    sourcemap: false,
    globalName: "DeckBridge"
  });

  const html = await readFile("src/ui.html", "utf8");
  const js = uiBundle.outputFiles.find(file => file.path.endsWith(".js"))?.text;

  if (!js) {
    throw new Error("UI bundle was not produced.");
  }

  await writeFile(
    `${outdir}/ui.html`,
    html.replace("<!-- UI_SCRIPT -->", `<script>\n${js}\n</script>`),
    "utf8"
  );
}

if (watch) {
  const codeContext = await esbuild.context({
    ...sharedOptions,
    entryPoints: ["src/code.ts"],
    outfile: `${outdir}/code.js`,
    platform: "browser",
    format: "iife"
  });

  const uiContext = await esbuild.context({
    ...sharedOptions,
    entryPoints: ["src/ui.ts"],
    outfile: `${outdir}/ui.js`,
    write: false,
    platform: "browser",
    format: "iife",
    sourcemap: false,
    globalName: "DeckBridge",
    plugins: [
      {
        name: "inline-ui-html",
        setup(build) {
          build.onEnd(async result => {
            if (result.errors.length > 0 || !result.outputFiles) return;

            const js = result.outputFiles.find(file => file.path.endsWith(".js"))?.text;
            if (!js) return;

            const html = await readFile("src/ui.html", "utf8");
            await writeFile(
              `${outdir}/ui.html`,
              html.replace("<!-- UI_SCRIPT -->", `<script>\n${js}\n</script>`),
              "utf8"
            );
          });
        }
      }
    ]
  });

  await codeContext.watch();
  await uiContext.watch();
  console.log("Watching Figma plugin sources...");
} else {
  await buildOnce();
}
