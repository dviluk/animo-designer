# animo-designer: what this fork changes, and how its server image is built

`dviluk/animo-designer` mirrors `open-pencil/open-pencil` for one self-hosted Cloud server on one of our own machines.
It carries two small changes of its own, each behind a build setting whose absence keeps upstream's behaviour.
Everything else of ours lives outside this repository: the server's compose and settings files, its data folders and its
secrets.

## The first change: the editor need not ask the official server on start

- **What upstream does:** every start of the editor calls `checkCloudAvailability()` (`src/app/cloud/sessions/startup.ts`).
  That asks the hosted server, `OFFICIAL_CLOUD_URL` (`https://cloud.openpencil.dev` by default), whether it lists itself
  for this editor version. It carries no document, account or id, but it is a request to a third party from the
  browser of whoever opens our server.
- **Why we change it:** our server keeps nothing on a third party's servers (GitHub excepted), and its telemetry is
  off. This is the one call to the official server the editor makes unasked.
- **The setting:** `VITE_OPENPENCIL_OFFICIAL_CLOUD_CHECK=off`, read at build time like `VITE_OPENPENCIL_CLOUD`.
  - Without it, the editor behaves exactly as upstream's.
  - With it off, `checkCloudAvailability()` still reads the `?cloud=` switch but never asks the official server.
  - The connect dialog still checks the official server when a person chooses it there.
- **The files:**
  - `vite.config.ts`: the define `__OPENPENCIL_OFFICIAL_CLOUD_CHECK__`;
  - `src/env.d.ts`: its declaration;
  - `src/constants.ts`: `OFFICIAL_CLOUD_CHECK`, true when the define is missing;
  - `src/app/cloud/availability.ts`: the early return.

## The second change: online fonts may start off

- **What upstream does:** online fonts are on by default. Every start lists the font families at `api.fontsource.org`,
  and a document using a font other than the bundled Inter, or holding Chinese, Japanese, Korean or Arabic text, loads
  its faces from `cdn.jsdelivr.net`.
- **The setting:** `VITE_OPENPENCIL_ONLINE_FONTS=off`, read at build time.
  - Without it, online fonts are on by default, as upstream's.
  - With it off, `DEFAULT_ONLINE_FONTS` is false: no font provider is enabled, so the editor lists and fetches no font
    from outside. Settings can still turn online fonts on, and its reset goes back to off.
- **The files:** `vite.config.ts` (the define `__OPENPENCIL_ONLINE_FONTS__`), `src/env.d.ts`, and
  `src/app/editor/fonts/index.ts` (`DEFAULT_ONLINE_FONTS`).

## What still reaches outside

With both settings off, the served editor still makes these requests:

- **When a message is opened in a browser:** the server's e-mails show their logo from `openpencil.dev`
  (`packages/cloud/src/email/templates/brand.ts`). We accept it: our mails are read through the mail catcher's API, which
  loads no image.
- **Only when a person chooses them:** online fonts turned on in Settings, icons, AI, stock photos, live rooms for files
  on the device, and the official server in the connect dialog.

## Building the server image

The image is upstream's `packages/cloud/deploy/Dockerfile`, unchanged. Two steps, from the repository's root:

1. **The HTML engine's WebAssembly module.** The image has no Rust, so the module is built first and travels in the
   build context: `bun run --filter @open-pencil/html-engine build:wasm` (Rust from `rust-toolchain.toml`, target
   `wasm32-unknown-unknown`).
2. **The image,** with both settings in a git-ignored `.env.cloud.local` at the root, which `vite build --mode cloud`
   reads. The build context leaves out no `.env*` file:

   ```bash
   printf 'VITE_OPENPENCIL_OFFICIAL_CLOUD_CHECK=off\nVITE_OPENPENCIL_ONLINE_FONTS=off\n' > .env.cloud.local
   docker build -f packages/cloud/deploy/Dockerfile -t animo-designer-cloud:<version>-<sha> .
   ```

Never set `VITE_OPENPENCIL_FEEDBACK`: without it the editor sends no usage events.

## Keeping up with upstream

- Merge `upstream/master` in; never rebase.
- Keep this change small and behind its setting, so a merge stays easy.
- If upstream gains a setting of its own for the same thing, drop this change and use theirs.
