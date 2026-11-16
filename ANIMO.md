# animo-designer: what this fork changes, and how its server image is built

`dviluk/animo-designer` mirrors `open-pencil/open-pencil` for one self-hosted Cloud server on one of our own machines.
It carries one change of its own. Everything else of ours lives outside this repository: the server's compose and
settings files, its data folders and its secrets.

## The change: the editor need not ask the official server on start

- **What upstream does:** every start of the editor calls `checkCloudAvailability()` (`src/app/cloud/sessions/startup.ts`).
  That asks the hosted server, `OFFICIAL_CLOUD_URL` (`https://cloud.openpencil.dev` by default), whether it lists itself
  for this editor version. It carries no document, account or id, but it is a request to a third party from the
  browser of whoever opens our server.
- **Why we change it:** our server must make no call to a third party (GitHub excepted), and its telemetry is off.
- **The setting:** `VITE_OPENPENCIL_OFFICIAL_CLOUD_CHECK=off`, read at build time like `VITE_OPENPENCIL_CLOUD`.
  - Without it, the editor behaves exactly as upstream's.
  - With it off, `checkCloudAvailability()` still reads the `?cloud=` switch but never asks the official server.
  - The connect dialog still checks the official server when a person chooses it there.
- **The files:**
  - `vite.config.ts`: the define `__OPENPENCIL_OFFICIAL_CLOUD_CHECK__`;
  - `src/env.d.ts`: its declaration;
  - `src/constants.ts`: `OFFICIAL_CLOUD_CHECK`, true when the define is missing;
  - `src/app/cloud/availability.ts`: the early return.

## Building the server image

The image is upstream's `packages/cloud/deploy/Dockerfile`, unchanged. Two steps, from the repository's root:

1. **The HTML engine's WebAssembly module.** The image has no Rust, so the module is built first and travels in the
   build context: `bun run --filter @open-pencil/html-engine build:wasm` (Rust from `rust-toolchain.toml`, target
   `wasm32-unknown-unknown`).
2. **The image,** with the setting in a git-ignored `.env.cloud.local` at the root, which `vite build --mode cloud`
   reads. The build context leaves out no `.env*` file:

   ```bash
   printf 'VITE_OPENPENCIL_OFFICIAL_CLOUD_CHECK=off\n' > .env.cloud.local
   docker build -f packages/cloud/deploy/Dockerfile -t animo-designer-cloud:<version>-<sha> .
   ```

Never set `VITE_OPENPENCIL_FEEDBACK`: without it the editor sends no usage events.

## Keeping up with upstream

- Merge `upstream/master` in; never rebase.
- Keep this change small and behind its setting, so a merge stays easy.
- If upstream gains a setting of its own for the same thing, drop this change and use theirs.
