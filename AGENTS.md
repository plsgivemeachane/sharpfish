# Sharpfish: instructions for maintainers and coding agents

## Repository and deployment

- Public repository: https://github.com/plsgivemeachane/sharpfish (`origin`).
- Original Stockfish.js repository is `upstream`; do not push project changes there.
- `elo-ladder` is the default branch and owns collection tooling and deployment configuration.
- Each variant keeps its own engine and play UI on its branch. Do not merge all variants together.
- `variants.json` on `elo-ladder` registers deployed branches and stable URL slugs.
- Production: SSH alias `kietvnmhomeserver`, directory `/opt/sharpfish`, Docker Compose service `sharpfish`, HTTP port **8096**.
- Cloudflare Tunnel forwards the public HTTPS hostname to `http://localhost:8096` on that server. Ordinary updates do not require Cloudflare changes.
- `deploy/` is an ignored, generated archive. Never hand-edit it or commit it; rebuild it from source.
- GitHub pushes and Actions checks **do not update the production collection**. Rebuild and deploy explicitly.

## Decide what to edit

| Change | Source of truth |
| --- | --- |
| Collection homepage | `collection-server/index.html`, `collection-server/collection.css` on `elo-ladder` |
| Variant names, descriptions, ordering, registration | `variants.json` on `elo-ladder` |
| A variant's play page, images, bot roster | `site/` on that variant's branch |
| A variant's engine or rules | `src/` on that variant's branch; see `FORKING.md` |
| Export process, injected return/source links | `scripts/collection.py` on `elo-ladder` |
| Container, port, HTTP behavior | `collection-server/Dockerfile`, `compose.yaml`, `nginx.conf` on `elo-ladder` |

Initial branches: `main` → `/variants/classic/`, `elo-ladder` → `/variants/elo-ladder/`,
`alternating-colors` → `/variants/alternating-colors/`, `scp-096` → `/variants/scp-096/`.

## Safe branch workflow

1. Inspect `git status` before editing. Preserve unrelated changes; never reset, stash, or commit someone else's work without authorization.
2. Make variant-specific changes on their own branch. Commit shared UI improvements separately, then cherry-pick that commit onto each intended variant and resolve differences individually. SCP-096 has custom pieces and intentionally disables stock evaluation; preserve those differences.
3. For a dirty checkout or a different active branch, use a separate Git worktree instead of switching underneath existing edits. Collection commands must run from an `elo-ladder` checkout that contains the tooling.
4. Commit and push the intended source changes before publishing their binaries, so exported source links resolve publicly. Do not force-push.
5. Fetch before building: `git fetch origin`. The builder prefers a local branch over `origin/<branch>`; fetching alone does **not** update existing local branches. Fast-forward each registered local branch when appropriate, or intentionally build its local committed version. Stop and inspect divergent history rather than discarding it.

The builder snapshots committed revisions only. Uncommitted play-page or engine changes will **not** appear in the deployment. Homepage templates and manifest are read from the collection checkout; commit those too before release.

## Add a new variant

Create the variant branch from an appropriate existing branch, implement and commit it, then push it:

```sh
git push -u origin my-variant
```

From the `elo-ladder` collection checkout:

```sh
python3 scripts/collection.py add my-variant \
  --slug my-variant --title "My variant" \
  --description "A short explanation of its gameplay."
git add variants.json
git commit -m "Register my-variant in the collection"
git push origin elo-ladder
```

Choose a unique lowercase, hyphenated slug; keep published slugs stable. To change an existing entry, edit `variants.json` directly; `add` only registers new entries. New branches must retain the `make-web.sh test` interface, a complete playable `site/`, and the `source-link` anchor expected by the exporter. Registration does not deploy anything until the collection is rebuilt.

## Build and verify an update

Requirements: Python 3.12+, Git, Node.js/npm, and the pinned Emscripten SDK.
`make-web.sh` can provision the SDK on its first run. Docker Compose serves the result.
From the collection checkout:

```sh
python3 scripts/collection-test.py
git diff --check
python3 scripts/collection.py build
docker compose -f deploy/compose.yaml config --quiet
```

The build compiles and smoke-tests **every registered variant**, copies each entire branch site, includes corresponding source downloads and licenses, and writes exact revisions to `deploy/site/build-info.json`. If a build fails, fix the source and rebuild; the previous archive is retained.

For a local preview:

```sh
docker compose -f deploy/compose.yaml -p sharpfish-preview up -d --build
curl -fsS http://localhost:8096/healthz
```

Use Playwright installed in a separate tools directory, keeping it out of project dependencies:

```sh
node scripts/collection-browser-test.js /path/to/playwright-tools http://localhost:8096
docker compose -f deploy/compose.yaml -p sharpfish-preview down
```

The browser check covers homepage navigation, mobile overflow, each human move and bot reply, variant-specific evaluation, WASM MIME/cache headers, source downloads, and missing routes. Also inspect the homepage visually for design changes; `DESIGN.md` records its design decisions. Run relevant gameplay regressions when changing gameplay (for example `node scripts/premove-test.js` on `elo-ladder`). Do not claim browser validation if Playwright was unavailable.

## Deploy the verified archive

When deployment is part of the requested work, carry it through these steps; do not stop after pushing Git changes. Otherwise leave production unchanged and report that deployment is pending.

```sh
ssh kietvnmhomeserver 'mkdir -p /opt/sharpfish'
rsync -a --delete deploy/ kietvnmhomeserver:/opt/sharpfish/
ssh kietvnmhomeserver 'cd /opt/sharpfish && docker compose up -d --build'
ssh kietvnmhomeserver 'cd /opt/sharpfish && docker compose ps && docker compose exec -T sharpfish nginx -t && curl -fsS http://localhost:8096/healthz'
```

Keep the rsync destination exact: `--delete` removes files inside `/opt/sharpfish/` that are absent from the archive. Do not target a parent directory or unrelated service. The container serves an image copy, so the existing running image keeps serving while the new image builds. Keep a copy of the previous generated archive outside `/opt/sharpfish` when rollback is needed; restore it and run the same Compose command to roll back.

Verify the homepage, all variant links, and `build-info.json` against the generated archive. Run the browser check against the server's reachable HTTP address or public HTTPS hostname. The SSH alias is not necessarily a browser-resolvable hostname; use the host address from SSH configuration when needed. Check logs on failure:

```sh
ssh kietvnmhomeserver 'cd /opt/sharpfish && docker compose logs --tail=100 sharpfish'
```

Finish by reporting source commits, variants published, test evidence, deployment status, and any remaining gap. Keep generated files out of Git. See `DEPLOYMENT.md` for additional setup details.
