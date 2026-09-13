"""Create an immutable byte registry for already stopped, archived native runs.

This only registers existing evidence. It does not rerun actors or certify a
capability. Independent capture/model/engine audits belong beside the registry.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile


def digest(path):
    with path.open('rb') as incoming:
        return hashlib.file_digest(incoming, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('evidence_root', type=Path)
    parser.add_argument('new_registry', type=Path)
    parser.add_argument('runs', nargs='+')
    args = parser.parse_args()
    root = args.evidence_root.resolve()
    if len(set(args.runs)) != len(args.runs):
        raise ValueError('Duplicate run registration')
    rows = []
    for name in args.runs:
        if Path(name).name != name or name in ('.', '..') or '/' in name or '\\' in name:
            raise ValueError('Expected an immediate evidence directory name')
        source = (root / name).resolve()
        if not source.is_relative_to(root):
            raise ValueError('Evidence directory escaped its root')
        report = json.loads((source / 'results.json').read_text(encoding='utf-8'))
        archive = source / 'stopped-world.tar.gz'
        proof = Path(str(archive) + '.provenance.json')
        provenance = json.loads(proof.read_text(encoding='utf-8'))
        if not report.get('stoppedAt') or not report.get('final') or report.get('status') == 'running':
            raise ValueError('Run has not stopped with a final checkpoint')
        world_digest = digest(archive)
        if provenance['source'] != str(source) or provenance['stoppedAt'] != report['stoppedAt'] or provenance['sha256'] != world_digest:
            raise ValueError('Stopped world provenance does not match this run')
        world_files = {}
        with tarfile.open(archive) as package:
            for member in package:
                path = PurePosixPath(member.name)
                if path.is_absolute() or '..' in path.parts or ':' in member.name or '\\' in member.name or not (member.isdir() or member.isfile()):
                    raise ValueError('Unsafe archived world member')
                if member.isfile():
                    if member.name in world_files:
                        raise ValueError('Duplicate archived world member')
                    with package.extractfile(member) as incoming:
                        world_files[member.name] = hashlib.file_digest(incoming, 'sha256').hexdigest()
        rows.append({'run': name, 'worldArchive': archive.name, 'reportSha256': digest(source / 'results.json'),
                     'sessionSha256': digest(source / 'session.json.gz'), 'worldSha256': world_digest,
                     'worldProofSha256': digest(proof), 'originalSource': str(source), 'stoppedAt': report['stoppedAt'],
                     'worldFiles': world_files})
    result = {'version': 'NativeStoppedEvidenceRegistry1',
              'scope': 'Already stopped original evidence; hashes register bytes and do not establish capability.', 'runs': rows}
    args.new_registry.parent.mkdir(parents=True, exist_ok=True)
    with args.new_registry.open('x', encoding='utf-8', newline='\n') as output:
        json.dump(result, output, indent=2)
        output.write('\n')
    print(json.dumps({'registry': str(args.new_registry.resolve()), 'runs': [row['run'] for row in rows],
                      'sha256': digest(args.new_registry), 'newPhysicalTrials': 0}))


if __name__ == '__main__':
    main()
