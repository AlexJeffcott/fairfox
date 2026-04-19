# Iterating on polly from inside fairfox

Fairfox pins `@fairfox/polly` to a published npm version through the
root-level catalog. The pin is the right default for normal work —
every sub-app compiles against the exact version that runs in
production. It is the wrong shape when you want to see a change to
polly's own source reflected in a fairfox sub-app without the
version-bump round-trip through npm.

The flow below swaps the pin for a local link for the duration of a
session, then reverses the swap before committing. Follow every
step; skipping the reverse half leaves fairfox pointing at your
local working tree and hides real regressions behind uncommitted
polly edits.

## 1 · Link polly locally

Register polly with bun's global link store, then adopt the link
from inside fairfox:

```sh
cd ~/projects/polly && bun link
cd ~/projects/fairfox && bun link @fairfox/polly
```

Bun's `link` command only replaces the **top-level**
`node_modules/@fairfox/polly` symlink. Sub-packages
(`packages/*/node_modules/@fairfox/polly`) continue resolving
through the per-version cache at
`node_modules/.bun/@fairfox+polly@<version>+<hash>`, which means a
mesh sub-app that imports from `@fairfox/shared` will load the
cached version rather than your link.

The surgical fix is to replace the cached entry's content with the
local polly dist. Either symlink the cache entry to your checkout
(simplest) or copy polly's `dist` and `package.json` into it if
Preact-signals or other peer deps object to resolving through
polly's own `node_modules`:

```sh
cd ~/projects/fairfox/node_modules/.bun/'@fairfox+polly@<version>+<hash>'/node_modules/@fairfox
rm -rf polly
mkdir polly
cp ~/projects/polly/package.json polly/
cp -r ~/projects/polly/dist polly/
```

## 2 · Rebuild polly after every edit

Bun bakes polly's built `dist/` into the bundle at fairfox startup;
editing `src/` in polly alone changes nothing that fairfox sees.
After each polly edit:

```sh
cd ~/projects/polly && bun run build-lib.ts
```

Then re-copy (or re-symlink) polly's `dist` into the fairfox cache
entry as in step 1, and restart `bun dev` in fairfox so the
sub-app bundles re-build against the new polly.

## 3 · Reverse the link before committing

Leaving the link in place makes fairfox resolve `@fairfox/polly`
against a tree that may contain uncommitted changes. Any CI step
that runs `bun install` on a different machine will resolve the
catalog version and disagree silently with your local behaviour.

To reverse:

```sh
# inside fairfox
rm ~/projects/fairfox/node_modules/@fairfox/polly

# globally — frees the name for other projects
cd ~/projects/polly && bun unlink
```

Bun's per-package `unlink` is not implemented; delete the
top-level symlink by hand. Also remove the cache entry you edited,
so `bun install` re-fetches a clean copy the next time:

```sh
rm -rf ~/projects/fairfox/node_modules/.bun/'@fairfox+polly@<version>+<hash>'
```

## 4 · Publish polly and adopt the new version

Bump polly's version, update the CHANGELOG, commit, push, and
release through polly's normal publish path. Then in fairfox,
update the catalog pin in the root `package.json` to the new
version, run `bun install`, verify the sub-apps build, and commit
the pin change alongside whichever fairfox code changes depended
on the new polly.
