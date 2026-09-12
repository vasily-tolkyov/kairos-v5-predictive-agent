"""Packaging boundary checks. Synthetic fixtures are not native trial evidence."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


class NativeEvidencePackageTests(unittest.TestCase):
    def fixture(self, status='budget-paused'):
        base = ROOT / 'evidence'
        base.mkdir(exist_ok=True)
        project = Path(tempfile.mkdtemp(prefix='package-apparatus-', dir=base)).resolve()
        run = project / 'evidence' / 'sample'
        (run / 'runtime').mkdir(parents=True)
        (run / 'runtime' / 'mutable-world').write_bytes(b'not a stopped artifact')
        report = {'status': status, 'stoppedAt': '2026-09-12T00:00:00Z', 'final': {}}
        (run / 'results.json').write_text(json.dumps(report), encoding='utf-8')
        (run / 'session.json.gz').write_bytes(gzip.compress(b'fixture, zero physical trials'))
        archive = run / 'stopped-world.tar.gz'
        content = b'fixed world bytes'
        member = 'world/level.dat'
        with tarfile.open(archive, 'w:gz') as world:
            header = tarfile.TarInfo(member)
            header.size = len(content)
            world.addfile(header, io.BytesIO(content))
        sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
        proof = Path(str(archive) + '.provenance.json')
        proof.write_text(json.dumps({'source': str(run), 'stoppedAt': report['stoppedAt'],
                                    'sha256': sha(archive)}), encoding='utf-8')
        registry = {'runs': [{'run': 'sample', 'worldArchive': archive.name,
                    'reportSha256': sha(run / 'results.json'), 'sessionSha256': sha(run / 'session.json.gz'),
                    'worldSha256': sha(archive), 'worldProofSha256': sha(proof),
                    'originalSource': str(run), 'stoppedAt': report['stoppedAt'],
                    'worldFiles': {member: hashlib.sha256(content).hexdigest()}}]}
        (project / 'registry.json').write_text(json.dumps(registry), encoding='utf-8')
        return project, run

    def package(self, project):
        return subprocess.run([sys.executable, str(ROOT / 'scripts/package-native-evidence.py'),
                               '--project', str(project), '--evidence-root', str(project / 'evidence'),
                               '--registry', str(project / 'registry.json'),
                               '--output', str(project / 'evidence.zip')], capture_output=True, text=True)

    def test_stopped_archive_is_portable_and_mutable_runtime_is_excluded(self):
        project, run = self.fixture()
        result = self.package(project)
        self.assertEqual(result.returncode, 0, result.stderr)
        with zipfile.ZipFile(project / 'evidence.zip') as package:
            self.assertFalse(any('runtime' in Path(name).parts for name in package.namelist()))
            manifest = json.loads(package.read('EVIDENCE-MANIFEST.json'))
            self.assertEqual(manifest['runs'], ['sample'])
            self.assertEqual(package.read('evidence/sample/stopped-world.tar.gz'),
                             (run / 'stopped-world.tar.gz').read_bytes())
            for name, proof in manifest['files'].items():
                self.assertEqual(hashlib.sha256(package.read(name)).hexdigest(), proof['sha256'])
        second = self.package(project)
        self.assertNotEqual(second.returncode, 0)
        self.assertIn('overwrite', second.stderr)

    def test_tampered_report_is_rejected_before_output_creation(self):
        project, run = self.fixture()
        with (run / 'results.json').open('a') as outgoing:
            outgoing.write(' ')
        result = self.package(project)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unverified registered file', result.stderr)
        self.assertFalse((project / 'evidence.zip.partial').exists())
        self.assertFalse((project / 'evidence.zip').exists())

    def test_running_report_is_rejected_even_when_registered_hash_matches(self):
        project, _ = self.fixture(status='running')
        result = self.package(project)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Only stopped runs', result.stderr)
        self.assertFalse((project / 'evidence.zip.partial').exists())


if __name__ == '__main__':
    unittest.main()
