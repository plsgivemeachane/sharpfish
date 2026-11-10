#!/usr/bin/env python3
"""Integration tests with tiny committed fixtures; no engine compiler needed."""
import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('collection', Path(__file__).with_name('collection.py'))
collection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collection)
PROJECT = collection.ROOT


class CollectionTest(unittest.TestCase):
    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True).strip()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        collection.ROOT = self.root
        self.git('init', '-q', '-b', 'fixture')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.test')
        shutil.copytree(PROJECT / 'collection-server', self.root / 'collection-server')
        (self.root / 'site').mkdir()
        (self.root / 'site/index.html').write_text('<html><link href="style.css"><body><a id="source-link" href="old">Source</a><script src="engine-file.js"></script><script src="bots.js"></script><script src="app.js"></script></body></html>')
        (self.root / 'site/favicon.svg').write_text('<svg/>')
        for name in ('Copying.txt', 'AUTHORS'):
            (self.root / name).write_text(name)
        (self.root / '.gitignore').write_text('/deploy/\n/.collection-*/\n')
        (self.root / 'make-web.sh').write_text(
            'set -eu\n[ "$1" = test ]\nmkdir -p site/engine\n'
            'echo built > site/engine/mock.wasm\necho \'window.ENGINE_FILE = "engine/mock.js";\' > site/engine-file.js\n')
        manifest = dict(source_url='https://github.com/example/chess', variants=[dict(
            branch='fixture', slug='one', title='One <two>', description='Chess & more')])
        (self.root / 'variants.json').write_text(json.dumps(manifest))
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')

    def tearDown(self):
        collection.ROOT = PROJECT
        self.temp.cleanup()

    def build(self):
        with contextlib.redirect_stdout(io.StringIO()):
            collection.build()

    def test_snapshot_navigation_sources_and_no_checkout_changes(self):
        # The export must ignore even tracked, uncommitted page edits.
        (self.root / 'site/index.html').write_text('uncommitted')
        before = self.git('status', '--porcelain')
        self.build()
        output = self.root / 'deploy/site'
        page = (output / 'variants/one/index.html').read_text()
        self.assertIn('href="../../"', page)
        self.assertIn('One &lt;two&gt;', page)
        self.assertIn(self.git('rev-parse', 'HEAD'), page)
        self.assertIn('Download engine source', page)
        commit = self.git('rev-parse', 'HEAD')
        for asset in ('style.css', 'engine-file.js', 'bots.js', 'app.js'):
            self.assertIn(asset + '?v=' + commit, page)
        self.assertIn('assets/' + commit + '/engine/mock.js',
                      (output / 'variants/one/engine-file.js').read_text())
        self.assertTrue((output / 'variants/one/assets' / commit / 'engine/mock.wasm').is_file())
        self.assertTrue((output / 'variants/one/source.tar.gz').is_file())
        self.assertTrue((output / 'variants/one/engine/mock.wasm').is_file())
        self.assertEqual(self.git('status', '--porcelain'), before)
        self.assertIn('Chess &amp; more', (output / 'index.html').read_text())

    def test_register_fifth_and_rebuild(self):
        for number in range(2, 6):
            collection.add(argparse.Namespace(branch='fixture', slug=f'variant-{number}',
                                             title=f'Variant {number}', description='Test'))
        self.build()
        output = self.root / 'deploy/site'
        self.assertEqual(len(list((output / 'variants').iterdir())), 5)
        self.assertIn('variants/variant-5/', (output / 'index.html').read_text())

    def test_failed_build_preserves_previous_output(self):
        self.build()
        before = (self.root / 'deploy/site/build-info.json').read_bytes()
        (self.root / 'make-web.sh').write_text('exit 1\n')
        self.git('add', 'make-web.sh')
        self.git('commit', '-qm', 'broken build')
        with self.assertRaises(subprocess.CalledProcessError):
            self.build()
        self.assertEqual((self.root / 'deploy/site/build-info.json').read_bytes(), before)
        self.assertEqual(list(self.root.glob('.collection-*')), [])

    def test_reject_invalid_duplicate_or_missing_branch(self):
        for branch, slug in [('fixture', '../escape'), ('fixture', 'one'), ('absent', 'new')]:
            with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                collection.add(argparse.Namespace(branch=branch, slug=slug, title='T', description='D'))
        self.assertEqual(len(collection.load_manifest()['variants']), 1)

    def test_fresh_clone_remote_tracking_branch(self):
        commit = self.git('rev-parse', 'HEAD')
        self.git('update-ref', 'refs/remotes/origin/remote-only', commit)
        self.assertEqual(collection.revision('remote-only'), commit)


if __name__ == '__main__':
    unittest.main()
