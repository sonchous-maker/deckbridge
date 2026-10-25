# Contributing

Use Node.js 24 and pnpm 11.25.0. The exact tested Node version is in `.node-version`.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Import `manifest.json` through Figma desktop's development plugin menu. Use `pnpm watch` while developing.

For conversion bugs, describe the input, expected result, actual result, Figma editor, PowerPoint version, and fonts involved. Include a minimal sample only when you have permission to share it. Screenshots are useful for layout differences.

Keep changes focused. Add regression coverage for changes to conversion logic. Automated tests use a simulated Figma API; visual checks in Figma and PowerPoint are still needed.

Please preserve English interface text and document unsupported features. Contributions are distributed under the repository's MIT license.
