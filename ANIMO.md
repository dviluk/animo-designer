# animo-designer: what this fork changes, and how its server image is built

`dviluk/animo-designer` mirrors `open-pencil/open-pencil` for one self-hosted Cloud server on one of our own machines.
It carries four small changes of its own, each behind a build setting whose absence keeps upstream's behaviour.
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

## The third change: icons from a local set

- **What upstream does:** icons come from the Iconify API (`https://api.iconify.design`), and Material Symbols are
  drawn from Google's fonts. Searching, browsing and placing an icon each fetch from outside, in the editor and in the
  command-line tool.
- **The settings:** `VITE_OPENPENCIL_LOCAL_ICONS=lucide` for the editor, read at build time, and
  `OPENPENCIL_LOCAL_ICONS=lucide` for the command-line tool, read when it runs.
  - Without them, icons are upstream's.
  - With them, every icon is searched, browsed and drawn from the Lucide set bundled as `@iconify-json/lucide`, and no
    icon is fetched. Any other set is refused by name.
- **The files:**
  - `packages/core/src/icons/local.ts`: a client with the Iconify client's calls, answered from sets in memory, under
    upstream's `createIconifyProvider`; `loadLucideIconSet()` loads the set on first use;
  - `vite.config.ts`, `src/env.d.ts` and `src/constants.ts`: the define `__OPENPENCIL_LOCAL_ICONS__` and `LOCAL_ICONS`;
  - `src/app/editor/icons/provider.ts`: `appIcons`; `packages/cli/src/tool-data.ts`: the command-line tool's icons.

## The fourth change: the agents' editor

- **What upstream does:** a Cloud site's editor, built or served, has no agent link; only the desktop app and a
  development server pair the editor with the agent (MCP) server.
- **The setting:** `VITE_OPENPENCIL_AGENT_EDITOR=on`, read at build time, for a second build that only the agents'
  own browser loads. The editor a person loads is never built with it.
  - A development server with it is automated as the desktop's is.
  - A built editor with it fetches its agent server's token from `/__agents/token` on its own origin, then connects to
    the agent server at `127.0.0.1:7600`. Anything but a 64-hex token there leaves it without agents. No token is in
    the bundle.
  - The server that serves this build, and the agent server beside it, live outside this repository.
- **The files:** `vite.config.ts`, `src/env.d.ts` and `src/constants.ts` (`__OPENPENCIL_AGENT_EDITOR__`,
  `AGENT_EDITOR`); `src/app/automation/mcp/runtime.ts` (`localMCPAvailable`) and `spawn.ts`
  (`readAgentEditorHandle`).

## What still reaches outside

With the first three settings set, the served editor still makes these requests:

- **When a message is opened in a browser:** the server's e-mails show their logo from `openpencil.dev`
  (`packages/cloud/src/email/templates/brand.ts`). We accept it: our mails are read through the mail catcher's API, which
  loads no image.
- **Only when a person chooses them:** online fonts turned on in Settings, AI, stock photos, web search, live rooms for
  files on the device, and the official server in the connect dialog.
- **On every page load:** the editor probes `http://127.0.0.1:7600/health` for a desktop agent server. It stays on the
  machine that runs the browser.
- **In the command-line tool:** a `.pen` file's own icons are still read through upstream's icons.

## Building the server image

The image is upstream's `packages/cloud/deploy/Dockerfile`, unchanged. Two steps, from the repository's root:

1. **The HTML engine's WebAssembly module.** The image has no Rust, so the module is built first and travels in the
   build context: `bun run --filter @open-pencil/html-engine build:wasm` (Rust from `rust-toolchain.toml`, target
   `wasm32-unknown-unknown`).
2. **The image,** with the three settings in a git-ignored `.env.cloud.local` at the root, which
   `vite build --mode cloud` reads. The build context leaves out no `.env*` file:

   ```bash
   printf 'VITE_OPENPENCIL_OFFICIAL_CLOUD_CHECK=off\nVITE_OPENPENCIL_ONLINE_FONTS=off\nVITE_OPENPENCIL_LOCAL_ICONS=lucide\n' > .env.cloud.local
   docker build -f packages/cloud/deploy/Dockerfile -t animo-designer-cloud:<version>-<sha> .
   ```

The agents' editor is a second `vite build --mode cloud` with `VITE_OPENPENCIL_AGENT_EDITOR=on` added, served by its
own container; it never goes into the server's image.

Never set `VITE_OPENPENCIL_FEEDBACK`: without it the editor sends no usage events.

## Keeping up with upstream

- Merge `upstream/master` in; never rebase.
- Keep each change small and behind its setting, so a merge stays easy.
- If upstream gains a setting of its own for the same thing, drop that change and use theirs.
