# Build tool release assets

The launcher and its toolsets have independent versions. `src/tool-assets.json` pins each archive's URL and SHA-256 checksum. Linux x64 and Windows x64 computers download their required archive automatically in setup Step 1. Windows currently produces the port's supported 32-bit game target.

## macOS setup

Mac tools are not bundled. Step 1 checks the Apple SDK and Command Line Tools, CMake (3.20+), Python 3, LLVM/llvm-objcopy, and Rosetta 2 on Apple Silicon. HD textures and Eclipse also require 7-Zip. Missing requirements open a guided checklist with copyable Terminal commands and the official Homebrew installation instructions. The launcher does not run system installers automatically.

Install Apple Command Line Tools with `xcode-select --install` and finish its installer first. Install [Homebrew](https://docs.brew.sh/Installation) if needed, then run `brew install cmake python3 llvm`. For textures or Eclipse, add `sevenzip`. Apple Silicon also needs `softwareupdate --install-rosetta`. Click **Check again** in Mac setup help to resume; downloaded files and saves are preserved.

Finder-launched apps find tools in `/opt/homebrew` (Apple Silicon), `/usr/local` (Intel), an explicit `HOMEBREW_PREFIX`, and the standard CMake.app location. Only child process environments are changed. Checks run asynchronously and cache briefly for UI refreshes; every setup/build attempt checks again. An existing playable build can still launch without requiring the tools to be reinstalled.

The installer does not contain the toolchain. Each launcher release also attaches a copy of the pinned tool archives for direct download. Normal launcher updates reuse the installed toolset. Tools are extracted into the app's data folder, separate from game builds, disc images, saves, and backups. A tool replacement is staged, verified, and rolled back if it fails.

## Publish a new toolset

1. On a preparation branch, set a new `toolset` in `src/tool-assets.json` and clear its `platforms` object. Update the pinned bootstrap or package requirements in `scripts/bootstrap-build-tools.js` as needed. Never reuse a published toolset version.
2. Commit and push that branch, then run **Publish build tool archives** in GitHub Actions with that branch selected. Only this workflow runs micromamba/pacman. It builds both toolchains, packages them, unpacks each into a different folder, and compiles the port with the relocated tools and no ROM. Linux uses conda-pack and runs conda-unpack at its final destination. Windows archives exclude package caches and machine-specific home/temp folders; setup recreates the empty folders it needs and uses Windows' built-in extractor when available.
3. Both OS jobs must pass before publication. The workflow publishes `build-tools-<toolset>` as a tooling prerelease, so it does not become the launcher's latest stable update. It includes tool archives, corresponding source archives, notices, and a merged `tool-assets.json`.
4. Download that merged manifest and replace `src/tool-assets.json` with it. Commit the pins and bump the launcher version, then merge the completed branch into `main` to ship the updated setup behavior. The normal launcher release workflow verifies the matching archive before attaching it to each OS release.

The tool archives contain only build dependencies. Port executables, disc images, game assets, texture packs, and user saves never enter the publishing directory. The source archives contain package build recipes, patches, upstream source downloads, license information, and package metadata. Keep these assets available while distributing their toolset.

## Smoke test shipped tools

`npm ci && node scripts/smoke-build-tools.js` downloads the pinned archive and builds a fresh port without a ROM. The **Smoke test build tools** workflow runs this independently of Electron packaging. Linux's build PATH contains only the downloaded tools; Windows uses the private MSYS2 tree. Both jobs assert that CMake selected the private compiler. A separate Mac job installs the documented prerequisites on the CI runner, strips Homebrew from PATH to reproduce Finder, runs launcher preflight, and compiles both Sunshine and Eclipse for x86_64 without a ROM. It does not publish the binaries.

During archive publication, `SMS_TOOL_ASSET_MANIFEST=tool-assets/manifest-<platform>.json` tests the local archive before its release exists. This override is only used by the CI script; the app uses the committed checksum pins.
