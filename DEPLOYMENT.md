# Sharpfish collection deployment

The collection is a static site. Each variant's board and Stockfish WebAssembly
engine run in the visitor's browser; the server only needs to serve files over
HTTP. The generated archive is written to `deploy/`, which is intentionally
ignored by Git. It can be recreated at any time from committed branch refs.

## Build the collection

The tracked manifest is `variants.json`. It names the branch/ref, URL slug,
title, and description for every published variant. The initial collection uses
`main`, `elo-ladder`, `alternating-colors`, and `scp-096`.

Use the collection script to add or update a future branch, then rebuild all
entries:

```sh
python3 scripts/collection.py add my-variant \
  --slug my-variant \
  --title "My Variant" --description "A short description"
python3 scripts/collection.py build
```

The build resolves every branch to a committed revision, creates a temporary
source snapshot for it, runs its existing web build and smoke test, and stages a new
archive. The previous `deploy/` directory is left intact if any variant fails.
Local refs take precedence; when absent, `origin/<branch>` is used so a fresh
clone works after `git fetch origin`. Fetch before rebuilding remote updates.
The resulting layout is:

```
deploy/
  site/index.html              # collection landing page
  site/variants/<slug>/        # complete branch-specific play page
  Dockerfile
  compose.yaml
  nginx.conf
```

Builds require Node.js, the pinned Emscripten SDK, and the dependencies already
used by `make-web.sh`. Serving the finished archive requires only Docker.
Use Python 3.12 or newer for the builder's safe tar extraction support.

## Local verification

```sh
python3 scripts/collection.py build
cd deploy
docker compose config
docker compose up --build
curl -fsS http://localhost:8096/healthz
```

Tooling regression checks: `python3 scripts/collection-test.py`.
For real browser checks, install Playwright in a separate tools directory and run
`node scripts/collection-browser-test.js /path/to/tools http://localhost:8096`.
This checks a human move and bot reply in every variant, mobile layout, source
downloads, and asset responses. SCP-096 intentionally disables stock evaluation.

Open <http://localhost:8096/> and check each card and `/variants/<slug>/`
directly. The Nginx image marks HTML, scripts, assets, and WASM `no-cache`
so browsers revalidate them. This prevents a rebuild from
leaving a browser pointed at an old engine.

## Publish the repository

The intended public repository is `plsgivemeachane/sharpfish`. Preserve the
upstream Stockfish.js remote as `upstream`, add the new repository as `origin`,
push the four initial branches, and set `elo-ladder` as the default branch:

```sh
git remote rename origin upstream
gh repo create plsgivemeachane/sharpfish --public
git remote add origin https://github.com/plsgivemeachane/sharpfish.git
git push -u origin main elo-ladder alternating-colors scp-096
gh repo edit plsgivemeachane/sharpfish --default-branch elo-ladder
```

The repository's GitHub Actions workflow can continue to build individual
branches. The collection archive is produced from `variants.json` when you
intend to deploy the multi-variant site.

## Deploy on kietvnmhomeserver

Copy the tracked deployment inputs and generated archive to `/opt/sharpfish`
on the server (the generated directory is disposable), then start the service:

```sh
ssh kietvnmhomeserver 'mkdir -p /opt/sharpfish'
rsync -a --delete deploy/ kietvnmhomeserver:/opt/sharpfish/
ssh kietvnmhomeserver 'cd /opt/sharpfish && docker compose up -d --build'
ssh kietvnmhomeserver 'curl -fsS http://localhost:8096/healthz'
```

Docker publishes host port **8096** to Nginx port 80 and keeps the container
running across restarts. In the Cloudflare dashboard, create or update the
tunnel public hostname so its service/origin is `http://localhost:8096` (or the
server's local address on port 8096). Cloudflare terminates HTTPS; the origin
connection remains plain HTTP on the private server.

To update the site, rebuild locally, rsync the new archive, and rerun
`docker compose up -d --build`. To inspect it:

```sh
ssh kietvnmhomeserver 'cd /opt/sharpfish && docker compose ps && docker compose logs --tail=100 sharpfish'
```
