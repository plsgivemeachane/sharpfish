#!/usr/bin/env python3
"""Build a portable collection from committed branch snapshots (stdlib only)."""
import argparse
import datetime
import gzip
import html
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def run(*args, cwd=None, **kwargs):
    return subprocess.run(args, cwd=cwd or ROOT, check=True, **kwargs)


def revision(branch):
    # A fresh clone has remote-tracking refs but only one local branch.
    for candidate in (branch, 'refs/remotes/origin/' + branch):
        result = subprocess.run(['git', 'rev-parse', '--quiet', '--verify',
                                 '--end-of-options', candidate + '^{commit}'],
                                cwd=ROOT, stdout=subprocess.PIPE, text=True)
        if result.returncode == 0:
            return result.stdout.strip()
    raise ValueError(f'No committed ref for {branch!r}; fetch or create the branch first')


def load_manifest():
    data = json.loads((ROOT / 'variants.json').read_text())
    if not re.fullmatch(r'https://github\.com/[\w.-]+/[\w.-]+', data['source_url']):
        raise ValueError('source_url must be a GitHub repository HTTPS URL')
    if not data['variants']:
        raise ValueError('Register at least one variant')
    seen = set()
    for entry in data['variants']:
        slug = entry['slug']
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug) or slug in seen:
            raise ValueError(f'Invalid or duplicate slug: {slug}')
        seen.add(slug)
        for key in ('branch', 'title', 'description'):
            if not isinstance(entry[key], str) or not entry[key].strip():
                raise ValueError(f'Missing {key} for {slug}')
    return data


def add(args):
    data = load_manifest()
    revision(args.branch)
    data['variants'].append(dict(branch=args.branch, slug=args.slug,
                                title=args.title, description=args.description))
    # Validate before writing, including duplicate/path checks.
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', args.slug):
        raise ValueError('Use a lowercase URL slug with hyphens')
    if any(e['slug'] == args.slug for e in data['variants'][:-1]):
        raise ValueError('This slug is already registered')
    if not args.title.strip() or not args.description.strip():
        raise ValueError('Title and description must not be empty')
    (ROOT / 'variants.json').write_text(json.dumps(data, indent=2) + '\n')
    print(f'Registered {args.slug}. Commit the manifest, then rebuild.')


def export_page(path, title, source_url, commit):
    content = path.read_text()
    if content.count('<body>') != 1:
        raise ValueError(f'{path}: expected one <body> navigation insertion point')
    nav = ('<nav aria-label="Collection" style="padding:12px 16px;display:flex;'
           'gap:20px;flex-wrap:wrap">'
           '<a href="../../">← All variants</a>'
           f'<span>{html.escape(title)}</span>'
           '<a href="source.tar.gz">Download engine source</a></nav>')
    content = content.replace('<body>', '<body>\n' + nav, 1)
    content, count = re.subn(r'(<a\s+id="source-link"\s+href=")[^"]*(")',
                            lambda m: m[1] + html.escape(source_url, quote=True) + m[2], content)
    if count != 1:
        raise ValueError(f'{path}: expected one source-link')
    # Cloudflare may override cache headers; stable URLs can mix releases.
    content = re.sub(r'((?:src|href)="(?:engine-file\.js|bots\.js|app\.js|style\.css))(")',
                     lambda m: m[1] + '?v=' + commit + m[2], content)
    path.write_text(content)


def homepage(site, data):
    cards = []
    for number, entry in enumerate(data['variants'], 1):
        cards.append(f'<a class="variant" href="variants/{entry["slug"]}/">'
                     f'<span class="number">{number:02d}</span>'
                     f'<h3>{html.escape(entry["title"])}</h3>'
                     f'<p>{html.escape(entry["description"])}</p>'
                     '<span class="play">Play variant →</span></a>')
    template = (ROOT / 'collection-server/index.html').read_text()
    (site / 'index.html').write_text(template.replace('{{CARDS}}', '\n'.join(cards))
                                   .replace('{{SOURCE_URL}}', data['source_url']))
    shutil.copy2(ROOT / 'collection-server/collection.css', site)
    shutil.copy2(ROOT / 'site/favicon.svg', site)


def build():
    data = load_manifest()
    # Resolve all refs once: every artifact and source link uses this frozen revision.
    entries = [dict(entry, commit=revision(entry['branch'])) for entry in data['variants']]
    if (ROOT / 'deploy').is_symlink():
        raise ValueError('Refusing to replace a symlink at deploy/')
    with tempfile.TemporaryDirectory(prefix='.collection-', dir=ROOT) as temp:
        staging = Path(temp) / 'deploy'
        site = staging / 'site'
        site.mkdir(parents=True)
        for entry in entries:
            print(f'\n== Building {entry["slug"]} at {entry["commit"][:12]} ==', flush=True)
            snapshot = Path(temp) / 'snapshot'
            snapshot.mkdir()
            archive = Path(temp) / 'source.tar'
            run('git', 'archive', '--format=tar', '-o', str(archive), entry['commit'])
            with tarfile.open(archive) as source:
                source.extractall(snapshot, filter='data')
            run('bash', './make-web.sh', 'test', cwd=snapshot)
            target = site / 'variants' / entry['slug']
            shutil.copytree(snapshot / 'site', target)
            # Ship corresponding source alongside the binary, including build scripts.
            with archive.open('rb') as src, gzip.open(target / 'source.tar.gz', 'wb') as dest:
                shutil.copyfileobj(src, dest)
            for filename in ('Copying.txt', 'AUTHORS'):
                shutil.copy2(snapshot / filename, target)
            # Workers derive their WASM URL from their own path, so version both
            # together rather than only adding a query string to the worker.
            versioned = target / 'assets' / entry['commit']
            for engine_dir in ('engine', 'stock-engine'):
                if (target / engine_dir).is_dir():
                    shutil.copytree(target / engine_dir, versioned / engine_dir)
            selector = target / 'engine-file.js'
            if selector.exists():
                content = selector.read_text()
                for engine_dir in ('engine', 'stock-engine'):
                    content = content.replace('\"' + engine_dir + '/',
                                              '\"assets/' + entry['commit'] + '/' + engine_dir + '/')
                selector.write_text(content)
            export_page(target / 'index.html', entry['title'],
                        data['source_url'] + '/tree/' + entry['commit'], entry['commit'])
            shutil.rmtree(snapshot)
            archive.unlink()
        homepage(site, data)
        (site / 'build-info.json').write_text(json.dumps(dict(
            built_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            source_url=data['source_url'], variants=entries), indent=2) + '\n')
        for filename in ('Dockerfile', 'compose.yaml', 'nginx.conf'):
            shutil.copy2(ROOT / 'collection-server' / filename, staging)
        # Same-filesystem renames; rollback if promotion fails. Builds never touch live output.
        output = ROOT / 'deploy'
        previous = Path(temp) / 'previous'
        if output.exists():
            output.rename(previous)
        try:
            staging.rename(output)
        except OSError:
            if previous.exists():
                previous.rename(output)
            raise
    print('Ready: deploy/ (docker compose up -d --build from that directory)')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('build', help='Rebuild all registered committed variants')
    register = commands.add_parser('add', help='Register a branch in variants.json')
    register.add_argument('branch')
    for flag in ('slug', 'title', 'description'):
        register.add_argument('--' + flag, required=True)
    args = parser.parse_args()
    # Prevent concurrent writers from racing archive promotion or manifest updates.
    import fcntl
    lock_path = run('git', 'rev-parse', '--git-path', 'collection.lock',
                    stdout=subprocess.PIPE, text=True).stdout.strip()
    with (ROOT / lock_path).open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command == 'add':
            add(args)
        else:
            build()


if __name__ == '__main__':
    main()
