# Privacy

Last updated: October 25, 2026

DeckBridge processes presentation content in the Figma plugin runtime.

- Export reads the selected frames or slides and their descendants to create a PPTX download.
- Import reads the PPTX file you choose and adds frames and layers to the current Figma document.
- Temporary nodes used for PNG export are removed when the export completes or fails.
- The plugin does not send presentation content to a developer-operated server. Its manifest blocks external network access.
- The current implementation has no analytics, advertising, account registration, or plugin-managed persistent storage.
- Warnings and diagnostic messages can include layer names, font names, and paths within the chosen PPTX. They are shown inside the plugin window.

Downloaded PPTX files are stored wherever your browser or Figma download flow saves them. Imported content becomes part of your Figma document and is subject to that document's sharing settings. Figma and your operating system handle their own storage and data processing separately.

You control which content to export and which file to import. Do not include confidential content in public bug reports. For questions about the plugin, open an issue in the repository hosting this document.
