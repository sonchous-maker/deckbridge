import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function load(relative, figma = {}) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(`../src/${relative}`, import.meta.url))],
    bundle: true, write: false, format: "cjs", platform: "browser"
  });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, figma, Uint8Array, TextDecoder });
  return module.exports;
}

const context = () => ({ origin: { x: 0, y: 0 }, rasterScale: 1, warnings: [], clipRect: { x: 0, y: 0, width: 100, height: 100 } });

test("only img and svg layer names have special rules", async () => {
  const { getNamingRule } = await load("classifier/getNamingRule.ts");
  for (const name of ["ignore", "ignore note", "[ignore]", "IGNORE", "ignore:note", "ignore/note"]) {
    assert.equal(getNamingRule(name), null);
  }
  assert.equal(getNamingRule("img photo"), "img");
  assert.equal(getNamingRule("[svg]"), "svg");
});

test("a filled clipping frame outside the slide skips its entire subtree", async () => {
  const { parseNode } = await load("parser/parseNode.ts", { mixed: Symbol("mixed") });
  const node = {
    id: "outside", type: "FRAME", name: "frame", visible: true, clipsContent: true,
    absoluteBoundingBox: { x: 200, y: 0, width: 40, height: 40 },
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
    children: [{ type: "TEXT", name: "ignore note", visible: true }]
  };
  assert.equal((await parseNode(node, context(), [])).length, 0);
});

test("former ignore names still export as editable shapes", async () => {
  const { parseNode } = await load("parser/parseNode.ts", { mixed: Symbol("mixed") });
  const node = { id: "rect", type: "RECTANGLE", name: "ignore note", visible: true,
    absoluteBoundingBox: { x: 10, y: 10, width: 20, height: 20 }, cornerRadius: 0,
    fills: [], strokes: [], strokeWeight: 0, opacity: 1, rotation: 0 };
  const elements = await parseNode(node, context(), []);
  assert.equal(elements.length, 1);
  assert.equal(elements[0].type, "shape");
});

test("empty clipping regions do not invoke raster export", async () => {
  const { exportNodeAsRaster } = await load("exporters/raster.ts");
  assert.equal(await exportNodeAsRaster({}, { ...context(), clipRect: null }, "RASTER_IMAGE"), undefined);
});

for (const fails of [false, true]) {
  test(`clipped PNG waits before cleanup on ${fails ? "failure" : "success"}`, async () => {
    let frame, clone, options, resolveExport, rejectExport;
    const pending = new Promise((resolve, reject) => { resolveExport = resolve; rejectExport = reject; });
    const figma = { createFrame() {
      frame = { removed: false, absoluteTransform: [[1, 0, 0], [0, 1, 0]],
        resizeWithoutConstraints(w, h) { this.width = w; this.height = h; },
        appendChild(child) { this.child = child; },
        exportAsync(value) { options = value; return pending; },
        remove() { this.removed = true; } };
      return frame;
    } };
    const { exportNodeAsRaster } = await load("exporters/raster.ts", figma);
    const node = { id: "photo", name: "photo", opacity: 1,
      absoluteRenderBounds: { x: 80, y: 70, width: 50, height: 50 },
      absoluteTransform: [[1, 0, 80], [0, 1, 70]],
      clone() { clone = { removed: false, relativeTransform: null, remove() { this.removed = true; } }; return clone; } };
    const ctx = context();
    const exported = exportNodeAsRaster(node, ctx, "RASTER_IMAGE");
    assert.equal(frame.removed, false);
    assert.equal(clone.removed, false);
    assert.equal(frame.width, 20);
    assert.equal(frame.height, 30);
    assert.equal(frame.clipsContent, true);
    assert.equal(options.format, "PNG");
    assert.equal(options.constraint.value, 1);
    const bytes = new Uint8Array([1, 2, 3]);
    if (fails) rejectExport(new Error("PNG export failed")); else resolveExport(bytes);
    const result = await exported;
    if (fails) { assert.equal(result, undefined); assert.equal(ctx.warnings.length, 1); }
    else { assert.equal(result.data.bytes, bytes); assert.equal(result.w, 20); assert.equal(result.h, 30); }
    assert.equal(frame.removed, true);
    assert.equal(clone.removed, true);
  });
}

test("import converts point sizes for base text and styled runs", async () => {
  let text;
  const ranges = [];
  const figma = {
    viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView() {} },
    currentPage: { appendChild() {} }, loadFontAsync: async () => {},
    createFrame: () => ({ resizeWithoutConstraints() {}, appendChild() {} }),
    createText() {
      text = { resizeWithoutConstraints() {}, setRangeFontName() {},
        setRangeFontSize(start, end, size) { ranges.push(size); } };
      return text;
    }
  };
  const { createFigmaPresentation } = await load("figma/createFigmaPresentation.ts", figma);
  await createFigmaPresentation({ warnings: [], slides: [{ name: "Test", width: 1280, height: 720,
    elements: [{ name: "Title", type: "text", text: "Test", x: 10, y: 10, w: 300, h: 100,
      rotation: 0, opacity: 1, style: { fontSize: 24 }, runs: [{ text: "Test", style: { fontSize: 18 } }] }] }] });
  assert.equal(text.fontSize, 32);
  assert.deepEqual(ranges, [24]);
});

test("font resolution supports generic family/style names and a neutral theme fallback", async () => {
  const requested = [];
  const figma = {
    viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView() {} },
    currentPage: { appendChild() {} },
    loadFontAsync: async font => { requested.push(`${font.family}/${font.style}`); },
    createFrame: () => ({ resizeWithoutConstraints() {}, appendChild() {} }),
    createText: () => ({ resizeWithoutConstraints() {}, setRangeFontName() {}, setRangeFontSize() {} })
  };
  const { createFigmaPresentation } = await load("figma/createFigmaPresentation.ts", figma);
  for (const fontFace of ["Example Sans Expanded DemiBd", "+mn-lt"]) {
    await createFigmaPresentation({ warnings: [], slides: [{ name: "Test", width: 1280, height: 720,
      elements: [{ name: "Text", type: "text", text: "Test", x: 0, y: 0, w: 100, h: 40,
        rotation: 0, opacity: 1, style: { fontFace, fontSize: 24 } }] }] });
  }
  assert.deepEqual(requested, ["Example Sans Expanded/DemiBold", "Example Sans Expanded/DemiBold", "Inter/Regular", "Inter/Regular"]);
});
