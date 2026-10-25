# DeckBridge

Export selected Figma frames to editable PowerPoint presentations and import supported PPTX content into Figma layers.

Version 0.1.0 is a preview. Check the [known limitations](#known-limitations) before using it for a final presentation.

## What it does

- Exports each selected top-level frame as one PowerPoint slide.
- Imports `.pptx` files into a row of editable Figma frames.
- Imports slide backgrounds, text, basic shapes, lines, PNG/JPEG/SVG images, and grouped slide content where PPTX coordinates are available.
- Imports embedded PowerPoint SVG images stored as `svgBlip`, including grouped decorative shapes exported by PowerPoint as SVG.
- Imports common PPTX bar and doughnut charts as cohesive SVG chart groups generated from PPTX chart data, including stacked series, legends, labels, and doughnut segments.
- Maps compatible PowerPoint font face names to editable Figma font families and styles.
- Orders selected slides by the number in the frame/slide name.
- Exports slide/frame backgrounds, strokes, and effects as Figma-rendered PNG layers.
- Exports raster layers at 1x scale.
- Keeps plain and mixed-style text as editable PowerPoint text, including Figma soft line breaks, font family, bold, and italic.
- Adds a small PowerPoint text-box width buffer to reduce accidental wrapping from font metric differences.
- Keeps plain rectangles, ellipses, and lines as editable PowerPoint objects.
- Exports shapes with visible effects, such as blur or shadow, as PNG using render bounds.
- Exports nested filled frames as one flattened PNG layer, while keeping editable text, explicit `img` descendants, and vector layers separate.
- Clips rasterized layers, including `img` layers, to parent frames/components/slides. Empty intersections of nested clipping regions skip the affected subtree.
- Treats rectangles and ellipses with image fills as a single image object.
- Exports vectors and boolean operations as PNG by default.
- Falls back to PNG for unsupported or failed SVG exports.
- Applies explicit layer-name rules before automatic classification:
  - `img` or `img ...` exports the node as one flattened PNG and does not walk children.
  - `svg` or `svg ...` exports the node as one SVG object.

## Setup

Use Node.js 24 (tested with 24.22.1) and pnpm 11.25.0.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

In the Figma desktop app, open a design file and use **Plugins → Development → Import plugin from manifest**. Choose this project's `manifest.json`.

If you download a packaged plugin ZIP from a release, extract it first and select the included `manifest.json`. It includes the built `dist` files, so no local build is needed. Downloading GitHub's source archive requires the build steps above.

## Development

```bash
pnpm watch
```

The generated plugin files are written to `dist/`.

Run `pnpm package` to build and create `releases/deckbridge-v0.1.0.zip`. See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance and [docs/RELEASING.md](docs/RELEASING.md) for the release checklist.

## Using the plugin

### Export to PowerPoint

1. Select the frames or slides you want to export.
2. Open DeckBridge and click **Export PPTX**.
3. Wait for the download, then review any warnings in the plugin window.
4. Open the file in PowerPoint and check fonts, wrapping, and layout before sharing.

The first selected slide determines the presentation size. Selected slides are sorted by numbers in their names when available. Supported text and basic shapes stay editable; other content may be flattened to images. Use `img` to flatten a layer and `svg` to request SVG export. Other layer names, including `ignore`, have no special exclusion rule. Hidden layers are skipped.

### Import a PowerPoint file

1. In Figma Design, open the plugin and click **Import PPTX into Figma**.
2. Choose a `.pptx` file.
3. The plugin adds a row of frames near the current viewport and selects them.
4. Review the warnings and compare the imported frames with the original deck.

Import into Figma Slides has not yet been verified. The importer currently creates Figma frames rather than native Slides slides.

## Known limitations

- Conversion is approximate. PowerPoint layouts, masters, and theme inheritance are not resolved during import. Placeholders without explicit positions may be skipped, and theme colors may differ.
- PPTX image cropping, group rotation/reflection, and some shapes and charts are not fully supported. Unsupported content may be skipped, approximated, or flattened.
- Font files are not embedded in exported PPTX files. Use compatible fonts with the required character coverage in both Figma and PowerPoint. Missing fonts or glyphs can change appearance and line breaks. Imported text falls back to Inter when a requested font cannot be loaded.
- Large files are processed in memory. There are currently no custom file-size or slide-count limits.
- Export from Figma Slides and the resulting PowerPoint files still require manual compatibility checks before a public release.

## Data handling

The current plugin processes selected Figma content and chosen PPTX files locally in the plugin runtime. Its manifest blocks external network requests. There is no analytics or remote upload code in the current implementation. Import adds layers to the current Figma document; export downloads a PPTX file.

See [PRIVACY.md](PRIVACY.md) for details. Report bugs and ask questions through this repository's Issues tab. Include the plugin version, Figma editor, PowerPoint version, relevant font names, and any warnings. Remove confidential content from examples before sharing.

## License

The plugin source is available under the [MIT license](LICENSE). Dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Font files are not bundled or licensed by this project.
