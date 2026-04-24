# TAO Radar Widgets Static Files

This folder is a standalone static source for Scriptable widget runtime files.

## Purpose

- Host widget `.js` and `.manifest.json` files on a stable domain (for example: `widgets.taoradar.space`).
- Keep runtime files isolated from the main web app, so storage/CDN can change without forcing users to re-download loaders.

## Notes

- Keep file names and paths stable.
- When moving hosting providers, keep the same public URLs whenever possible.
- The loader resolves manifests from module URLs (`*.js` -> `*.manifest.json`) when manifest URL is not explicitly provided.
