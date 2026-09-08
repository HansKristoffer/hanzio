# Releasing on merge

> **Status (2026-09-08): built, not yet merged.** Steps 1 to 7 are done in the
> branch and on GitHub. Still manual: the npm trusted publisher in step 7, then
> step 8.

## Today

hanzio ships by running `bun run publish:patch|minor|major` locally, which is
`npm version` plus `npm publish` under a personal npm login. The human picks
the bump. Main carries bare `1.2.0`-style commits from `npm version`, plus the
odd `Merge branch 'main'` commit. There is no `.github/` directory: no CI, no
publish workflow. The only automated check is the husky pre-push hook running
`bun lint`; tests run only when someone remembers.

Every tag `v1.0.1` through `v1.2.0` points at one of those version commits, and
`v1.2.0` is HEAD of main. Nothing is waiting to be released.

## Decision: Release Please, squash merges, trusted publishing

- **Release Please** over Changesets: one npm package, so Changesets would
  also work, but Changesets wants a changeset file in every PR and the release
  PR here should cost nothing per PR. It is also what the other repos use, so
  one mental model.
- **Release Please** over semantic-release: the release PR is the one review
  step left, and it batches several merges into one npm version.
- **Squash merges with conventional PR titles** decide the bump. `fix:` is a
  patch, `feat:` a minor, `feat!:` or a `BREAKING CHANGE:` footer a major.
  `chore:`, `ci:`, `docs:`, `refactor:`, `test:` do not release.
- **npm trusted publishing (OIDC)** instead of an `NPM_TOKEN` secret. No
  long-lived credential in the repo, and the package gets provenance. The
  package has none today.

## The loop after this ships

1. A PR is opened with a conventional title, `ci.yml` runs, it is
   squash-merged.
2. `release.yml` runs on the push to main and creates or updates the release
   PR with the next version and the generated `CHANGELOG.md`.
3. Merging the release PR bumps `package.json`, creates the `v*` tag and the
   GitHub release. The same workflow run then publishes to npm.
4. If the publish job fails, rerun the failed job on that run. The tag and
   release already exist; nothing on the Release Please side is repeated.

Tags created by the workflow's own token do not trigger other workflows. That
is GitHub's loop guard, and it is why step 3 runs the publish job instead of
listening for the tag. It is also why the release PR gets no CI run: it only
changes `package.json` and `CHANGELOG.md`, so no status check may be required
on main (see step 7).

## Steps

### 1. Release Please config

`release-please-config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "release-type": "node",
      "package-name": "hanzio",
      "include-component-in-tag": false
    }
  }
}
```

`.release-please-manifest.json` bootstraps from the current tag:

```json
{ ".": "1.2.0" }
```

Produces `v1.3.0` / `v1.2.1`, matching the existing tags. The `node` release
type bumps `package.json` only; `bun.lock` does not record the root version
(its workspace entry still says `template-bun-simple`), so nothing else needs
touching.

### 2. `ci.yml`

New file. Two jobs, both on one Ubuntu runner with Bun 1.4.2 and
`bun install --frozen-lockfile`:

- `lint`: `bun run lint` (tsgo typecheck plus `biome check`). About a minute
  including install. This is the check to name in branch protection if any
  check is ever required.
- `test`: `bun test`, `bun run build`, `bun run test:secrets:runtime`. The
  runtime check needs Node (it runs the packed tarball under Node, Vite and
  Miniflare), so add `actions/setup-node` with Node 22. Everything runs in
  about five seconds locally; no OS matrix, nothing here is platform-specific.

Triggers: `pull_request` and `push` to `main`, so the merge commit is checked
too. `concurrency: group: ci-${{ github.event.pull_request.number ||
github.ref }}` with `cancel-in-progress: true`. Not on `release.yml`, where a
cancelled run could leave a tag without a publish.

### 3. `release.yml`

One file: Release Please on `push` to main, then a `publish-npm` job that runs
when a release was created. `workflow_dispatch` skips Release Please and
publishes the checked-out main by hand; it is the escape hatch for
republishing a version.

Publish steps: checkout, setup Bun 1.4.2, `bun install --frozen-lockfile`,
`actions/setup-node` with `registry-url: https://registry.npmjs.org`, then
`npm publish --provenance --access public`. `prepublishOnly` already runs
`bun run build`, so the publish step needs Bun on `PATH` and nothing else.
Permissions: `contents: write`, `pull-requests: write`, `id-token: write`.
No `NPM_TOKEN` anywhere.

Trusted publishing needs npm 11.5.1 or newer, and the npm bundled with Node 22
is older, so `npm install -g npm@latest` runs first. Do not run
`bun publish`; keep the OIDC path on the tool npm documents.

### 4. Why not a separate callable `publish.yml`

npm validates the trusted publisher against the *calling* workflow's
filename. A `workflow_call` from `release.yml` shows up as `release.yml`, so
a publisher registered as `publish.yml` fails with a 404 on the PUT even
though the provenance statement signs fine. The first 1.3.0 publish failed
this way on 2026-09-08; publish moved into `release.yml` and the trusted
publisher was re-pointed.

### 5. `package.json`

Remove `publish:patch`, `publish:minor`, `publish:major`. Keep
`prepublishOnly`. The husky pre-push hook stays; it is cheap and catches lint
before a PR exists.

### 6. `README.md`

Add a short "Releasing" section at the end: PR titles are conventional
commits; `feat:` / `fix:` / `feat!:` release, `chore:` / `ci:` / `docs:` /
`refactor:` / `test:` do not; merge the release PR to publish. Replace nothing
else; the README does not describe the current manual flow.

### 7. GitHub settings (once)

Applied via the GitHub API on 2026-09-08 except the npm trusted publisher,
which has no API and must be set on npmjs.com. Before that: merge, squash and
rebase all allowed; main unprotected; workflow permissions read-only.

- Pull requests: allow squash merging only; default squash message "pull
  request title" (title only, no commit list in the body). This is what makes
  the title the commit Release Please reads, and it ends the stray
  `Merge branch 'main'` commits. Turn on "automatically delete head branches"
  while there.
- Branch protection on `main`: require a pull request. Do **not** require
  status checks: the release PR is opened by the workflow token, gets no CI
  run, and would be unmergeable.
- Actions settings: workflow permissions "read and write", and allow GitHub
  Actions to create and approve pull requests (Settings, Actions, General).
  Without it the action cannot open the release PR.
- npmjs.com, package `hanzio`, Settings, Trusted publisher: GitHub Actions,
  owner `HansKristoffer`, repository `hanzio`, workflow `release.yml`, no
  environment. It must be the workflow that triggers the run; a called
  workflow does not count (see step 4).

### 8. First run

1. Squash-merge this branch with a conventional title. Nothing is pending
   since `v1.2.0`, so the title alone decides whether a release PR appears:
   `ci: release on merge` produces none until the next `fix:` or `feat:`
   lands; `feat: release on merge` proposes `1.3.0` immediately and exercises
   the whole loop, at the cost of a version with no library change. Use
   `feat:` if you want to see it work today. To force a number, put
   `Release-As: 1.3.0` in the squash commit body.
2. Merge the release PR and watch the run: `release-please`, then
   `publish-npm`. Confirm the npm page shows a provenance badge.
3. Delete the local npm login habit: nobody runs `npm publish` from a laptop
   after this.

## Later, not now

- Auto-merging the release PR turns this into publish-on-every-merge. Needs a
  personal access token or GitHub App token. Add it only if the release PR is
  being merged without being read.
- A PR title lint action (`amannn/action-semantic-pull-request`). Add it the
  first time a mislabeled title ships the wrong bump.
- An OS matrix in CI. Add it the first time a platform-specific bug ships.
