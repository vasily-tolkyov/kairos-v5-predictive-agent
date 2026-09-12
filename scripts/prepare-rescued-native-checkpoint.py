"""Prepare a new local predecessor from registered, verified Kairos evidence.

Only paths and provenance in the copied report change. Original evidence,
session bytes and every archived world file stay unchanged. No game is run.
"""
from pathlib import Path, PurePosixPath
import argparse
import gzip
import hashlib
import json
import shutil
import tarfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-root', type=Path, required=True,
                        help='Extracted directory containing the registered native run directories')
    parser.add_argument('--registry', type=Path,
                        help='Explicit verified checkpoint registry; defaults to the historical rescue registry')
    parser.add_argument('--output', type=Path, required=True,
                        help='New directory; an existing destination is refused')
    parser.add_argument('--run', default='native-natural-v51-bounded-fitting')
    args = parser.parse_args()
    registry_path = args.registry or Path(__file__).resolve().parents[1] / 'docs/codex-rescue/rescued-state-verification.json'
    registry = json.loads(registry_path.read_text(encoding='utf-8'))
    expected = next((r for r in registry['runs'] if r['run'] == args.run), None)
    if expected is None:
        raise SystemExit('Run is not in the verified rescue registry')
    source = args.evidence_root.resolve() / args.run
    target = args.output.resolve()
    if target.exists():
        raise SystemExit('Destination already exists; originals will not be overwritten')
    archive = source / expected['worldArchive']
    proof_bytes = Path(str(archive) + '.provenance.json').read_bytes()
    report_bytes = (source / 'results.json').read_bytes()
    session_bytes = (source / 'session.json.gz').read_bytes()
    proof, report = json.loads(proof_bytes), json.loads(report_bytes)
    session = json.loads(gzip.decompress(session_bytes))
    for label, actual, wanted in [
        ('session', sha(session_bytes), expected['sessionSha256']),
        ('report', sha(report_bytes), expected['reportSha256']),
        ('world proof', sha(proof_bytes), expected['worldProofSha256']),
        ('world archive', sha(archive.read_bytes()), expected['worldSha256']),
        ('historical source', proof['source'], expected['originalSource']),
        ('stop timestamp', proof['stoppedAt'], report['stoppedAt']),
        ('saved stop timestamp', report['stoppedAt'], expected['stoppedAt']),
        ('saved archive identity', proof['sha256'], expected['worldSha256']),
    ]:
        if actual != wanted:
            raise SystemExit(label + ' does not match the verified original')
    if report['status'] == 'running' or session['version'] != 'ExperienceSession1':
        raise SystemExit('A stopped ExperienceSession1 checkpoint is required')
    for field, counter in [('steps', 'decisions'), ('executed', 'executed')]:
        if session[field] != report['final'][counter]:
            raise SystemExit('Checkpoint and final report counters differ')
    if session['medium']['writes'] != report['final']['writes']:
        raise SystemExit('Checkpoint learning count differs from the final report')
    with tarfile.open(archive) as package:
        files = {}
        for member in package.getmembers():
            rel = PurePosixPath(member.name)
            if rel.is_absolute() or '..' in rel.parts or ':' in member.name or '\\' in member.name:
                raise SystemExit('Unsafe archive member')
            if not (member.isdir() or member.isfile()):
                raise SystemExit('Links and special archive members are not accepted')
            if member.isfile():
                if member.name in files:
                    raise SystemExit('Duplicate archive path')
                files[member.name] = sha(package.extractfile(member).read())
        if files != expected['worldFiles']:
            raise SystemExit('World files do not match the rescued archive')
    # All identities and archive paths are checked before creating any output.
    target.mkdir(parents=True, exist_ok=False)
    runtime = target / 'runtime'
    server = runtime / 'minecraft'
    server.mkdir(parents=True)
    with tarfile.open(archive) as package:
        for member in package.getmembers():
            path = server.joinpath(*PurePosixPath(member.name).parts)
            if not path.resolve().is_relative_to(server.resolve()):
                raise SystemExit('Archive extraction escapes its destination')
            if member.isdir():
                path.mkdir(parents=True, exist_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                with package.extractfile(member) as incoming, path.open('xb') as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
                if sha(path.read_bytes()) != files[member.name]:
                    raise SystemExit('Extracted file verification failed')
    record = {
        'version': 'PreparedStoppedNativeCheckpoint1' if args.registry else 'RescuedStoppedNativeCheckpoint1',
        'registrySha256': sha(registry_path.read_bytes()),
        'historicalSource': expected['originalSource'],
        'localEvidenceSource': str(source),
        'sourceReportSha256': sha(report_bytes),
        'sourceWorldProofSha256': sha(proof_bytes),
        'sessionSha256': sha(session_bytes),
        'worldArchiveSha256': expected['worldSha256'],
        'worldFiles': files,
        'newPhysicalTrials': 0,
        'sessionBytesUnchanged': True,
        'scope': 'Relocated verified stopped state; no new physical trials or inferred missing state',
    }
    (target / 'session.json.gz').write_bytes(session_bytes)
    (target / 'original-results.json').write_bytes(report_bytes)
    (target / 'original-world-provenance.json').write_bytes(proof_bytes)
    report['runtimeRoot'] = str(runtime)
    report['forkedCheckpoint'] = record
    (target / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    (target / 'rescue-provenance.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    print(json.dumps({'target': str(target), 'run': args.run,
                      'sessionSha256': record['sessionSha256'],
                      'verifiedWorldFiles': len(files), 'newPhysicalTrials': 0}))


if __name__ == '__main__':
    main()
