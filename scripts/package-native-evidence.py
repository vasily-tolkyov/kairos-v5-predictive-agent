"""Package registered stopped runs and explicit supporting files, then verify every byte.

Mutable runtime directories are excluded: only the hash-verified stopped-world
archives represent worlds. The generated manifest describes files, not scientific
acceptance. Use independent run audits before registering an experiment.
"""
from pathlib import Path, PurePosixPath
import argparse
import hashlib
import json
import tarfile
import zipfile


def digest_file(path):
    with path.open('rb') as incoming:
        return hashlib.file_digest(incoming, 'sha256').hexdigest()


def verify_run(root, expected):
    name = expected['run']
    if PurePosixPath(name).name != name or name in ('.', '..') or '\\' in name:
        raise ValueError('Unsafe run name')
    source = root / name
    report = json.loads((source / 'results.json').read_text(encoding='utf-8'))
    if report.get('status') == 'running' or not report.get('stoppedAt'):
        raise ValueError('Only stopped runs may be packaged')
    archive = source / expected['worldArchive']
    proof = Path(str(archive) + '.provenance.json')
    for path, field in [(source / 'results.json', 'reportSha256'),
                        (source / 'session.json.gz', 'sessionSha256'),
                        (archive, 'worldSha256'), (proof, 'worldProofSha256')]:
        if not path.resolve().is_relative_to(source.resolve()) or digest_file(path) != expected[field]:
            raise ValueError(f'Unverified registered file: {name}/{path.name}')
    provenance = json.loads(proof.read_text(encoding='utf-8'))
    if provenance['source'] != expected['originalSource'] or report['stoppedAt'] != expected['stoppedAt'] \
            or provenance['stoppedAt'] != report['stoppedAt'] or provenance['sha256'] != expected['worldSha256']:
        raise ValueError('Stopped archive identity mismatch')
    actual = {}
    with tarfile.open(archive) as world:
        for member in world:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or ':' in member.name or '\\' in member.name \
                    or not (member.isdir() or member.isfile()):
                raise ValueError('Unsafe world archive member')
            if member.isfile():
                if member.name in actual:
                    raise ValueError('Duplicate world archive member')
                with world.extractfile(member) as incoming:
                    actual[member.name] = hashlib.file_digest(incoming, 'sha256').hexdigest()
    if actual != expected['worldFiles']:
        raise ValueError('Archived world differs from registered bytes')
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, default=Path.cwd())
    parser.add_argument('--evidence-root', type=Path, required=True)
    parser.add_argument('--registry', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--include', action='append', default=[],
                        help='Explicit file or directory relative to the project; repeat as needed')
    args = parser.parse_args()
    project, root = args.project.resolve(), args.evidence_root.resolve()
    registry_path, output = args.registry.resolve(), args.output.resolve()
    temporary = Path(str(output) + '.partial')
    if output.exists() or temporary.exists():
        raise ValueError('Refusing to overwrite an existing package or partial package')
    registry = json.loads(registry_path.read_text(encoding='utf-8'))
    files = {}

    def add(path):
        if path.is_symlink() or not path.resolve().is_relative_to(project):
            raise ValueError('Package inputs must be regular project files')
        if not path.is_file():
            raise ValueError('Package input is not a regular file')
        relative = path.relative_to(project).as_posix()
        if relative == 'EVIDENCE-MANIFEST.json':
            raise ValueError('The package manifest path is reserved')
        if any(part in {'runtime', 'node_modules', '.git'} for part in PurePosixPath(relative).parts):
            raise ValueError('Mutable runtime or dependency directory cannot be packaged')
        if path.resolve() in (output, temporary):
            raise ValueError('Package cannot include itself')
        files[relative] = path

    add(registry_path)
    seen_runs = set()
    for expected in registry['runs']:
        if expected['run'] in seen_runs:
            raise ValueError('Duplicate registered run')
        seen_runs.add(expected['run'])
        source = verify_run(root, expected)
        for path in source.rglob('*'):
            if 'runtime' in path.relative_to(source).parts:
                continue
            if path.is_symlink():
                raise ValueError('Symlink in experiment evidence')
            if path.is_file():
                add(path)
    for included in args.include:
        path = project / included
        if path.is_symlink() or not path.resolve().is_relative_to(project) or not path.exists():
            raise ValueError('Invalid supporting path')
        if path.is_dir():
            for child in path.rglob('*'):
                if '__pycache__' in child.relative_to(path).parts:
                    continue
                if child.is_symlink():
                    raise ValueError('Symlink in supporting directory')
                if child.is_file():
                    add(child)
        else:
            add(path)

    manifest = {'version': 'NativeEvidencePackage1',
                'scope': 'Original stopped runs and explicit support files; no new physical trials',
                'registry': registry_path.relative_to(project).as_posix(),
                'registrySha256': digest_file(registry_path), 'runs': sorted(seen_runs), 'files': {}}
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(temporary, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=3) as package:
        for relative, path in sorted(files.items()):
            before = digest_file(path)
            package.write(path, relative)
            if digest_file(path) != before:
                raise ValueError('Input changed during packaging: ' + relative)
            manifest['files'][relative] = {'sha256': before, 'bytes': path.stat().st_size}
        package.writestr('EVIDENCE-MANIFEST.json', json.dumps(manifest, indent=2).encode())
    with zipfile.ZipFile(temporary) as package:
        if len(set(package.namelist())) != len(package.namelist()) \
                or set(package.namelist()) != set(manifest['files']) | {'EVIDENCE-MANIFEST.json'}:
            raise ValueError('Package members do not match its manifest')
        for relative, expected in manifest['files'].items():
            if package.getinfo(relative).file_size != expected['bytes']:
                raise ValueError('Package member size mismatch: ' + relative)
            with package.open(relative) as incoming:
                if hashlib.file_digest(incoming, 'sha256').hexdigest() != expected['sha256']:
                    raise ValueError('Package member digest mismatch: ' + relative)
    proof = {'version': 'VerifiedNativeEvidencePackage1', 'file': output.name,
             'bytes': temporary.stat().st_size, 'sha256': digest_file(temporary),
             'filesVerified': len(manifest['files']), 'runs': sorted(seen_runs),
             'registrySha256': manifest['registrySha256']}
    temporary.rename(output)
    Path(str(output) + '.sha256.json').write_text(json.dumps(proof, indent=2), encoding='utf-8')
    print(json.dumps(proof))


if __name__ == '__main__':
    main()
