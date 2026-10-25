# Releasing DeckBridge

## Local checks

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm package
```

The plugin ZIP is created under `releases/`. It contains the manifest, the two runtime files, README, privacy information, changelog, license, and third-party notices. Do not upload `node_modules` or the macOS archive metadata. The source map is for local development and is not included in the plugin ZIP.

## Manual checks before a public release

- Test empty and invalid selections, multiple frames, mixed text styles, missing fonts, and Cyrillic text.
- Verify `img` and `svg` rules, hidden layers, masks, partially clipped images, and nested clipping with no visible intersection.
- Compare the generated file with the original in PowerPoint. Font availability and glyph coverage must match on the viewing computer.
- Import a typical PPTX with layouts, themes, text, images, and charts. Compare the result and document any skipped content.
- Test Figma Design and Figma Slides separately. The importer currently creates FrameNode objects, not native SlideNode objects; Slides import is not validated.
- Test a large file, a damaged file, and the English UI in both light and dark themes.

Automated tests simulate parts of the Figma API. They do not certify the plugin's visual fidelity or Slides compatibility.

## First GitHub publication

1. Publish this folder as the repository root. Use the name `deckbridge`.
2. Keep Issues enabled for support. The repository's MIT license and privacy document are ready to publish with the code.
3. Wait for the Check and package workflow to pass. Its first hosted run is only possible after the repository is uploaded.
4. After manual checks, create a release for tag `v0.1.0`. Mark it as a pre-release while compatibility checks remain outstanding.
5. Use `CHANGELOG.md` for release notes and attach `releases/deckbridge-v0.1.0.zip`.
6. Do not describe the plugin as lossless or fully compatible with all PPTX features.

## Figma Community submission

Prepare a 128×128 icon, a 1920×1080 thumbnail, screenshots of actual output, an English description, and a support link to the repository's Issues. Link to `PRIVACY.md` once it has a public URL. Verify ownership of the manifest's plugin ID and resolve or explicitly restrict the Slides import scenario before submission.

Creating this local repository or a GitHub release does not submit the plugin to Figma Community.
