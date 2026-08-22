# docs/

Entry point for this repo's own documentation — dogfooding `docs-builder`'s own layout.

| Doc | What it is |
|---|---|
| [`docs-builder-v2-spec.md`](docs-builder-v2-spec.md) | The docs-builder v2 spec: measured design decisions, POC results, and the built subcommand set. |
| [`product/docs-builder-README.md`](product/docs-builder-README.md) | User-facing guide to `/docs-builder` — the four modes, the menu, the docs/ layout. |
| [`product/remember-README.md`](product/remember-README.md) | Guide to the `/stash` → `/remember` hot-memory pipeline and the `friction.cjs` sensor. |
| [`product/INSTALLER_GUIDE.md`](product/INSTALLER_GUIDE.md) | How to install and manage liteagents across the supported AI tools. |
| [`product/antigen-gate-prd.md`](product/antigen-gate-prd.md) | PRD for the (deferred) validation-gated hot-memory antigen gate. |
| [`log.md`](log.md) | Append-only operation log written by `docs-builder.cjs` (`## [DATE] operation \| description`). |

`product/` holds specs and guides; `docs-builder` reads them but never writes them. See
`docs/product/docs-builder-README.md` for the full layout, including the machine-only
`.docs-builder/` state directory and the generated `wiki/`/`archive/` directories.
