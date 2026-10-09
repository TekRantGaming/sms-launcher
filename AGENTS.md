# Notes for AI agents

## Update the changelog with every player-visible change

[`changelog.json`](changelog.json) is the changelog players read in the launcher: it opens by itself after an update, and from the button beside Settings. Installed launchers fetch it from `main`, so whatever you merge there is what players see. **If your change is something a player could notice, add a line for it in the same commit.** Don't leave it for later.

### Where your line goes

| Your change | Add it to |
| --- | --- |
| Launcher behaviour, UI, settings, fixes (`src/`, packaging, update flow) | `beta.launcher` |
| Game changes that Beta now builds (new commits on the game's branch in `src/game-release.json`) | `beta.game` |
| Selecting a new game pin | Run `npm run update:game` (below) |
| Bumping the launcher version without a new game pin | Move `beta` into a new release entry yourself (below) |
| Tests, CI, refactors, docs, tooling with no visible effect | Nothing |

`beta` holds what's on `main` and in Beta but not in a release yet. Only Beta builds show it, and they show it again whenever its wording changes, so keep it accurate as you go.

### Cutting a release

- **New game pin:** `npm run update:game` (or `npm run update:game -- <port-commit>`) bumps the launcher. It moves `beta.launcher` and `beta.game` into the new version's entry, fills any empty list from commit subjects, and empties `beta`. Then rewrite any commit subjects for players, check the game notes match the commit you pinned, and commit `changelog.json` along with `src/game-release.json`, `package.json` and `package-lock.json`.
- **Launcher-only bump** (`npm version patch --no-git-tag-version`): add an entry at the top of `releases` for the new version. Move the `beta.launcher` lines into it, and copy `game.version` and `game.commit` from `src/game-release.json` with `"changes": []` (the game didn't change). Then set `beta.launcher` to `[]`, keeping `beta.game` if Beta's newer game still has those changes.

The release entry format:

```json
{
  "version": "0.1.56",
  "date": "2026-10-09",
  "launcher": ["Player-facing launcher change."],
  "game": { "version": "2026.10.09.2", "commit": "<40-character commit from src/game-release.json>", "changes": ["Player-facing game change."] }
}
```

### How to write a line

- One plain sentence for players, ending with a full stop. Say what they'll notice, and where to find it if it's a setting, e.g. "Show on Discord: while you play, your Discord profile shows where you are in the game. Turn it off under Manage game."
- No commit hashes, PR or issue numbers, file names, function names or CI details. Text only: the launcher shows it as plain text, so Markdown and HTML show up literally.
- Fixes say what was wrong in the game or launcher, e.g. "Fixed Shadow Mario never taking Peach in Super Mario Eclipse's Delfino Plaza."
- Match the wording of existing entries. Fold several commits for one feature into one line.

### Rules

- Newest release first; each version once; every entry needs a date and its game pin.
- Only edit past releases to correct them. Edits reach installed launchers right away.
- `npm test` must pass. `test/changelog.test.js` fails if `changelog.json` has no entry for the `package.json` version, or that entry's game pin doesn't match `src/game-release.json`.

The README's "Versions and releases" section has the full release process.
