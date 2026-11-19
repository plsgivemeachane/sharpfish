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
        (self.root / 'site/badges').mkdir()
        (self.root / 'site/badges/best.png').write_bytes(b'approved badge')
        (self.root / 'site/sounds').mkdir()
        (self.root / 'site/sounds/move.mp3').write_bytes(b'piece click')
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

    def test_atomic_analysis_engine_metadata_is_versioned_and_explicit(self):
        manifest = json.loads((self.root / 'variants.json').read_text())
        manifest['variants'].append(dict(branch='fixture', slug='atomic',
                                         title='Atomic Chess',
                                         description='Every capture explodes nearby pieces.'))
        (self.root / 'variants.json').write_text(json.dumps(manifest))
        self.build()
        target = self.root / 'deploy/site/variants/atomic'
        selector = (target / 'engine-file.js').read_text()
        commit = self.git('rev-parse', 'HEAD')
        self.assertIn('"slug": "atomic"', selector)
        self.assertIn('"analysisMode": "atomic"', selector)
        self.assertIn('"analysisEnginePath": "/variants/atomic/assets/' + commit + '/engine/mock.js"', selector)
        self.assertIn('"evaluation": true', selector)
        self.assertIn('"grading": true', selector)
        self.assertIn('"alternatives": true', selector)
        self.assertIn('"greatBrilliant": false', selector)
        self.assertIn('"accuracy": false', selector)
        self.assertIn('"estimatedElo": false', selector)
        self.assertTrue((target / 'assets' / commit / 'engine/mock.wasm').is_file())
        for slug in ('one', 'atomic'):
            content = (self.root / 'deploy/site/variants' / slug / 'engine-file.js').read_text()
            self.assertIn('window.SHARPFISH_ANALYSIS_ENGINES = {"atomic": "/variants/atomic/assets/' + commit + '/engine/mock.js"}', content)

    def test_cross_variant_registry_includes_separate_standard_engine(self):
        stock = self.root / 'site/stock-engine'
        stock.mkdir()
        (stock / 'stockfish-stock.js').write_text('standard engine')
        self.git('add', 'site/stock-engine')
        self.git('commit', '-qm', 'standard analysis fixture')
        manifest = json.loads((self.root / 'variants.json').read_text())
        manifest['variants'] = [dict(branch='fixture', slug=slug, title=slug, description='Test')
                                for slug in ('classic', 'atomic')]
        (self.root / 'variants.json').write_text(json.dumps(manifest))
        self.build()
        commit = self.git('rev-parse', 'HEAD')
        for slug in ('classic', 'atomic'):
            content = (self.root / 'deploy/site/variants' / slug / 'engine-file.js').read_text()
            self.assertIn('"standard": "/variants/classic/assets/' + commit + '/stock-engine/stockfish-stock.js"', content)
            self.assertIn('"atomic": "/variants/atomic/assets/' + commit + '/engine/mock.js"', content)

    def test_analysis_page_links_assets_and_variant_identity(self):
        (self.root / 'site/analysis.html').write_text(
            '<html><link href="analysis.css"><body><a id="source-link" href="old">Source</a>'
            '<script src="engine-file.js"></script><script src="analysis-core.js"></script>'
            '<script src="game-history.js"></script><script src="analysis.js"></script></body></html>')
        self.git('add', 'site/analysis.html')
        self.git('commit', '-qm', 'analysis page')
        self.build()
        target = self.root / 'deploy/site/variants/one'
        page = (target / 'analysis.html').read_text()
        commit = self.git('rev-parse', 'HEAD')
        self.assertIn('href="../../"', page)
        self.assertIn('Download engine source', page)
        self.assertIn('/tree/' + commit, page)
        for asset in ('analysis.css', 'engine-file.js', 'analysis-core.js', 'game-history.js', 'analysis.js'):
            self.assertIn(asset + '?v=' + commit, page)
        selector = (target / 'engine-file.js').read_text()
        self.assertIn('window.SHARPFISH_VARIANT', selector)
        self.assertIn('"slug": "one"', selector)
        self.assertIn('"supported": false', selector)

    def test_chess960_export_keeps_analysis_identity(self):
        collection.add(argparse.Namespace(branch='fixture', slug='chess960',
                                         title='Chess960', description='Fischer Random'))
        self.build()
        selector = (self.root / 'deploy/site/variants/chess960/engine-file.js').read_text()
        self.assertIn('"chess960": true', selector)
        self.assertIn('"supported": true', selector)
        self.assertIn('"analysisMode": "standard-line"', selector)

    def test_remorse_export_uses_standard_snapshots(self):
        collection.add(argparse.Namespace(branch='fixture', slug='remorse',
                                         title='Remorse Chess', description='Guilt and recovery'))
        self.build()
        selector = (self.root / 'deploy/site/variants/remorse/engine-file.js').read_text()
        self.assertIn('"supported": true', selector)
        self.assertIn('"analysisMode": "standard-snapshot"', selector)

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

    def test_badge_urls_change_between_releases(self):
        self.build()
        first = self.git('rev-parse', 'HEAD')
        target = self.root / 'deploy/site/variants/one'
        badge = 'assets/' + first + '/badges/best.png'
        self.assertTrue((target / badge).is_file())
        self.assertIn('"badgePath": "assets/' + first + '/badges/"',
                      (target / 'engine-file.js').read_text())
        (self.root / 'site/badges/best.png').write_bytes(b'next approved badge')
        self.git('add', 'site/badges/best.png')
        self.git('commit', '-qm', 'replace artwork')
        self.build()
        second = self.git('rev-parse', 'HEAD')
        self.assertNotEqual(first, second)
        self.assertEqual((target / 'assets' / second / 'badges/best.png').read_bytes(),
                         b'next approved badge')
        self.assertIn('"badgePath": "assets/' + second + '/badges/"',
                      (target / 'engine-file.js').read_text())

    def test_sound_urls_follow_the_frozen_release(self):
        self.build()
        first = self.git('rev-parse', 'HEAD')
        target = self.root / 'deploy/site/variants/one'
        self.assertEqual((target / 'assets' / first / 'sounds/move.mp3').read_bytes(), b'piece click')
        self.assertIn('"soundPath": "assets/' + first + '/sounds/"', (target / 'engine-file.js').read_text())
        (self.root / 'site/sounds/move.mp3').write_bytes(b'updated click')
        self.git('add', 'site/sounds/move.mp3')
        self.git('commit', '-qm', 'update sound')
        self.build()
        second = self.git('rev-parse', 'HEAD')
        self.assertNotEqual(first, second)
        self.assertEqual((target / 'assets' / second / 'sounds/move.mp3').read_bytes(), b'updated click')
        self.assertIn('"soundPath": "assets/' + second + '/sounds/"', (target / 'engine-file.js').read_text())

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
