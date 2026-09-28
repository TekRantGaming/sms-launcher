# SMS Launcher

![SMS Launcher ready to play](docs/launcher-ready.png)

Electron setup and play launcher for [sms-pc-port](https://github.com/chasem-dev/sms-pc-port). The launcher is a **sibling** of the port checkout (`sms-launcher/` next to `sms-port/`) during development. It does not include game data.

## Start

1. Install Node.js 22 or newer and npm. From `sms-launcher/`, run `npm ci` and `npm start`.
2. Download the setup files to the suggested location, or choose a different install location first. On Linux and Windows, Step 1 also downloads the required build tool archive, verifies its SHA-256 checksum, and unpacks it into the launcher's private data folder. Development runs detect a neighboring `sms-port/` automatically. An existing setup folder can be selected later in **Settings → Game files**.
3. Choose a file copied from your own **North American Super Mario Sunshine GMSE01 Rev 0** disc (`.iso`, `.gcm`, or Dolphin `.ciso`). The launcher reads it in place and saves only its path in local preferences.
4. Select **Begin setup**. The launcher installs any selected HD textures and builds the game. When setup finishes, Home shows **Play**. Use **Settings → Manage game → Rebuild game** when you want a fresh build.

Home uses the supplied seaside artwork as its background. First run has three screens: download setup files, choose your disc image, and begin setup. The step indicator shows where you are; the task progress bar shows downloads and building. Once the game is ready, Home simplifies to Play and the Settings cog. Open **Settings → Game files** to change the setup folder or disc file later. **Manage game** groups rebuild, updates, space cleanup, backups, and the activity log. Use Back to return to Settings. The frameless window can be dragged by its top bar; its top-right buttons minimize, toggle full screen, and close the window.

Linux and Windows use prepared build tool archives published as separate GitHub Release assets. The launcher downloads the matching archive automatically once; there is no manual MSYS2 installation and no package manager runs on the user's computer. The archive's checksum is pinned in the launcher, and the tools stay in its private data folder, outside the port build and save folders. Launcher updates reuse the same toolset. Failed downloads or unpacking preserve the previous tools. Linux includes Git, CMake, Python, GCC, SDL2, EGL, Make, patch, binutils, and 7-Zip in a relocatable conda-forge environment. Windows includes a prepared MSYS2 tree with 64-bit programs and compilers for both 32-bit and 64-bit games. Linux also includes an x64-host 32-bit cross compiler with private SDL2, EGL, and graphics runtime libraries. Source archives and package notices accompany the tools. macOS downloads a separate native tool archive for Intel or Apple Silicon, including LLVM, CMake, Python, Git, Make, patch, and 7-Zip. Only Apple's Command Line Tools and Rosetta (on Apple Silicon) require a one-time system install; Step 1 checks these before proceeding. Homebrew is not required. See [build tool publishing](docs/build-tools.md) for the separate toolset workflow.

The launcher requires a 64-bit computer. **Settings → Game build** offers both **64-bit** (the default) and **32-bit** games on Windows and Linux. macOS games remain x86_64, with Rosetta 2 on Apple Silicon. An existing game build choice is preserved. Switching the choice keeps the previous game available through **Play previous version** until the new build succeeds; saves keep the same location. The first build may take a while and, for the standard game, also creates a private standalone build from your image.

The game opens in a centered, resizable window on the monitor containing the pointer. It starts at up to 1280×720 and shrinks to fit smaller screens, keeping the title bar and resize edges accessible. Higher render quality improves the game's image without making the window larger.

Home shows the current task, elapsed time, and a progress bar. It uses the actual percentage when the port or Git reports one; downloads and unpacking show their current phase while the source tool does not report a percentage.

## HD textures

HD textures are optional and off for new users. Turn them on in **Settings → Visuals**. The launcher detects an existing pack in the port's `mods/textures` folder; otherwise choose **Download HD textures** there. If enabled during first run, **Begin setup** downloads them before building the game. The installer downloads the authors' pack (about 1 GB, about 3 GB installed) and checks its checksum. Python 3 and 7-Zip come from the prepared tools when system copies are missing. The launcher points the running game at that folder when HD textures are on. Installations and changes take effect on the next game start. The texture pack stays in the port checkout, separate from launcher updates and builds.

## Eclipse

Enable **Super Mario Eclipse**, then choose **Install Eclipse mod** or select **Begin setup** if it appears on Home. The installer downloads the official patch and applies it to your own original image. It needs Python 3 and 7-Zip as described in the port's `mods/README.md`. Eclipse uses a separate `build/<os>-<arch>-eclipse/` tree. It builds against the port's `eclipse` branch and runs the installed patched disc without bundling it. Toggle Eclipse off to return to the original build.

The Eclipse patcher needs an unmodified 1:1 GMSE01 image; a compressed CISO does not pass its checksum. Eclipse builds have been verified in the port on Linux. The launcher offers the same build path on macOS and Windows, marked experimental until those port builds are verified there.

## Updates and cleanup

Each launcher release selects one tested game source revision, including the exact decomp submodule. Home shows **Update & play** when the selected game or tools differ from your installed build. One click prepares it and starts the game. Launcher-only updates reuse your game and tools. Turning off **Update automatically** keeps the installed game selected; **Settings → Manage game → Update game** installs the version selected by this launcher manually.

Updates build in a separate source folder beside the original installation. Preferences switch only after setup succeeds. Your original source folder, saved games, disc file, settings, and optional downloads are preserved. Failed downloads or builds leave the installed game available through **Play installed version** in Manage game. After a successful source update, **Play previous version** is available there too. Rebuilds keep their previous build and restore it on failure; a recovery journal restores interrupted rebuilds on the next launcher start. Existing installations without version records need one verified update. First-time setup still uses the three-step flow.

**See removable files** previews cleanup; **Free up space** asks for confirmation before removing the current installation's regenerable build output. Earlier installations are retained for recovery and use additional disk space.

Memory card saves stay in the port's usual user data folder, independent of launcher installs and build folders. The launcher honors `SMS_SAVE_DIR` or `save_dir` in the port's `settings.txt`, and shows the resolved save path in the app. It makes verified, dated copies before each play session, after play exits, and before a port update or cleanup. Cleanup refuses to run if a custom save folder is inside a removable build folder. When changing compilers, it keeps the previous build and preserves custom saves in their original location, with a verified backup and rollback if restoring fails. Backups live in `~/SMS Launcher Backups` (the Windows user profile folder on Windows), outside both the launcher installation and port checkout. **Back up now**, **Open backups**, and **Restore selected backup** are in the app. Restore verifies the selected backup and saves the current memory card first. No ROM or patched disc is included in these backups. Keep an additional copy of the backup folder on another drive or cloud service to protect against disk failure.

Packaged launcher builds support self updates through `electron-updater`. A `package.json` version bump pushed to `main` makes `.github/workflows/release.yml` create its `vX.Y.Z` tag, build an x64 Linux AppImage, universal macOS DMG/ZIP for Intel and Apple Silicon, and x64 Windows installer, and publish only after all launcher packages and four private-tool game compilation checks succeed. The private-tool checks compile and start both 32-bit and 64-bit games on Windows and Linux, and 64-bit games on both Mac host types. Release packages embed their GitHub update feed, check on startup and every 30 minutes, download updates, and install them on quit. Unsigned macOS builds can be downloaded, but macOS automatic updates need the `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD` signing secrets. `SMS_LAUNCHER_UPDATE_URL` can override the embedded feed with an HTTPS generic update feed. Local packages made without a release feed can prepare their bundled game revision, but cannot download newer launcher releases automatically.

For a launcher-only release, run `npm version patch --no-git-tag-version`, commit the updated `package.json` and `package-lock.json`, and push to `main`. The workflow creates the tag after the push. Version bumps can also use `minor` or `major`.

Build platform packages with `npm run dist`. The installer includes only the launcher code, never the port checkout, ROMs, mods, standalone game builds, or saves. Linux, Windows, and native Intel/Apple Silicon Mac build tool archives are separate assets attached to each launcher release and downloaded during setup. `npm test` runs the launcher command, disc selection, tool replacement, Mac prerequisite, and save backup tests. The separate **Smoke test build tools** workflow runs on pull requests, a weekly schedule, manual requests, and as a required reusable gate for launcher releases. It downloads the exact published archives, verifies their pinned checksums, and compiles the exact game source revision in `src/game-release.json` without any disc image, then checks that CMake used the expected compiler. Mac tests use only the private tools and Apple's installed compiler and SDK, including paths containing spaces. It does not package or publish the launcher.


## Versioning and releasing game updates

There are three independent versions:

| Component | Version location | When it changes |
| --- | --- | --- |
| Launcher | `package.json` | UI, launcher behavior, or selecting a new game/tools release |
| Game source | `src/game-release.json` | A new tested port commit (which also pins its decomp commit) |
| Build tools | Each platform entry in `src/tool-assets.json` and `src/mac-tool-assets.json` | Only when that OS/architecture needs different tools |

Users do not choose Git branches or manage these versions. The launcher selects compatible source and tools, records what built their game, and shows versions in Manage game for support. Source and tool changes require a rebuild; visual preferences and launcher-only changes do not.

To release decomp/port progress:

1. Commit the decomp work, update the port's `decomp` gitlink to that commit, and push the complete port revision to `eclipse`.
2. In this launcher repository, run `npm run update:game` (or `npm run update:game -- <port-commit>`). It records exact port/decomp commits, assigns a dated game version, and bumps the launcher patch version. Selecting the same commit again makes no changes.
3. Review and commit `src/game-release.json`, `package.json`, and `package-lock.json`, then push to `main`.
4. GitHub builds the pinned game with the published private tools on all four supported host targets, without a ROM. If those checks pass, it builds and publishes the launcher release. Any failure keeps the release unpublished.

To change tools, bump only the matching platform entry's `toolset`, publish that OS archive through the separate tool publishing workflow, then adopt its generated manifest entry (new immutable URL/checksum) and bump the launcher. The tool workflows can select one OS or Mac architecture. Existing archives and hashes remain unchanged; changing Linux tools never forces Windows or Mac downloads. All game compilation remains on the user's computer with their own disc. No game executable or assets are published by these workflows.

Matching tools from earlier launcher installs are reused in place. Changed tool archives install into separate checksum-specific folders, retaining older tools needed by previous game builds. Each build records its compiler tool location, and fallback play uses that location. Removing a recorded tool folder causes the launcher to request preparation again. One launcher instance runs at a time to prevent overlapping game updates or save operations.
