"""Archive apparatus checks; fixtures are not native capability evidence."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StoppedWorldArchiveTests(unittest.TestCase):
    def fixture(self, stopped=True):
        evidence = ROOT / 'evidence'
        evidence.mkdir(exist_ok=True)
        root = Path(tempfile.mkdtemp(prefix='archive-apparatus-', dir=evidence)).resolve()
        self.assertTrue(root.is_relative_to(evidence.resolve()))
        server = root / 'runtime' / 'minecraft'
        world = server / 'world-v5-physical-control'
        (world / 'region').mkdir(parents=True)
        (world / 'level.dat').write_bytes(gzip.compress(b'\x0a\x00\x00\x00'))
        (world / 'region' / 'r.0.0.mca').write_bytes(bytes(8192))
        (server / 'server.properties').write_text('level-name=world-v5-physical-control\n', encoding='utf-8')
        report = {'runtimeRoot': str(root / 'runtime'), 'status': 'budget-paused',
                  'final': {'executed': 0}}
        if stopped:
            report['stoppedAt'] = '2026-09-13T00:00:00Z'
        (root / 'results.json').write_text(json.dumps(report), encoding='utf-8')
        return root

    def test_host_paths_produce_verified_posix_archive_members(self):
        root = self.fixture()
        output = root / 'stopped-world.tar.gz'
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/archive-stopped-world.py'),
                                 str(root), str(output)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        proof = json.loads(Path(str(output) + '.provenance.json').read_text(encoding='utf-8'))
        self.assertEqual(proof['sha256'], hashlib.sha256(output.read_bytes()).hexdigest())
        with tarfile.open(output) as archive:
            self.assertIn('world-v5-physical-control/level.dat', archive.getnames())
            self.assertIn('world-v5-physical-control/region/r.0.0.mca', archive.getnames())
            self.assertEqual(archive.extractfile('world-v5-physical-control/level.dat').read(),
                             (root / 'runtime/minecraft/world-v5-physical-control/level.dat').read_bytes())

    def test_unconfirmed_shutdown_cannot_be_archived(self):
        root = self.fixture(stopped=False)
        output = root / 'rejected-world.tar.gz'
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/archive-stopped-world.py'),
                                 str(root), str(output)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('completed shutdown', result.stderr)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
