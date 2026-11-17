// Python is bundled in the API image. Its dir_fd APIs retain the directory handles
// Node lacks; every component is opened without following links on macOS and Linux.
export const STORAGE_FILE_PROGRAM = String.raw`
import base64, errno, hashlib, json, os, stat, sys
from datetime import datetime, timezone

DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

def minimum_mode(fd, mode):
    try:
        os.fchmod(fd, stat.S_IMODE(os.fstat(fd).st_mode) | mode)
    except OSError as error:
        if error.errno not in (errno.ENOSYS, errno.ENOTSUP, errno.EPERM, errno.EROFS, errno.EINVAL):
            raise

def descend(fd, parts, writable=False, create=False):
    try:
        for part in parts:
            try:
                child = os.open(part, DIRECTORY_FLAGS, dir_fd=fd)
            except FileNotFoundError:
                if not create:
                    raise
                try:
                    os.mkdir(part, 0o2775 if writable else 0o777, dir_fd=fd)
                except FileExistsError:
                    pass
                child = os.open(part, DIRECTORY_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
            if writable:
                minimum_mode(fd, 0o2775)
        return fd
    except BaseException:
        os.close(fd)
        raise

def open_root(root):
    if not root.startswith('/') or any(p in ('.', '..') for p in root.split('/')):
        raise ValueError('Storage root must be an absolute canonical path')
    return descend(os.open('/', DIRECTORY_FLAGS), [p for p in root.split('/') if p])

def timestamp(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z') if value is not None else None

def preview(parent, name, limit):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError('File not found')
        chunks, remaining = [], min(info.st_size, limit)
        while remaining:
            chunk = os.read(fd, remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        return dict(sizeBytes=info.st_size, data=base64.b64encode(b''.join(chunks)).decode())
    finally:
        os.close(fd)

def claim(parent, name):
    base, extension = os.path.splitext(name)
    for index in range(200):
        candidate = name if index == 0 else f'{base} ({index}){extension}'
        try:
            fd = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o666, dir_fd=parent)
            return candidate, fd
        except FileExistsError:
            pass
    raise ValueError('Too many files with the same name in this folder')

def upload(parent, name, limit, writable):
    name, fd = claim(parent, name)
    committed = False
    try:
        initial = os.fstat(fd)
        created_at = getattr(initial, 'st_birthtime', initial.st_ctime)
        digest, size = hashlib.sha256(), 0
        while True:
            chunk = sys.stdin.buffer.read(65536)
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise ValueError('UPLOAD_TOO_LARGE')
            digest.update(chunk)
            view = memoryview(chunk)
            while view:
                view = view[os.write(fd, view):]
        if os.read(3, 1) != b'1':
            raise ValueError('UPLOAD_ABORTED')
        if writable:
            minimum_mode(fd, 0o664)
        info = os.fstat(fd)
        target = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if (target.st_dev, target.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError('Upload destination changed while writing')
        committed = True
        return dict(name=name, sizeBytes=info.st_size, sha256=digest.hexdigest(),
                    createdAt=timestamp(created_at), modifiedAt=timestamp(info.st_mtime))
    finally:
        if not committed:
            try:
                os.unlink(name, dir_fd=parent)
            except FileNotFoundError:
                pass
        os.close(fd)

def main(args):
    parts = args['relativePath'].split('/')
    if any(p in ('', '.', '..') for p in parts):
        raise ValueError('Path is outside the storage root')
    root = open_root(args['rootPath'])
    writable = args.get('writable', False)
    if writable:
        minimum_mode(root, 0o2775)
    parent = descend(root, parts[:-1], writable, args.get('createDirectories', False))
    try:
        return preview(parent, parts[-1], args['limitBytes']) if args['operation'] == 'preview' else upload(parent, parts[-1], args['limitBytes'], writable)
    finally:
        os.close(parent)

try:
    print(json.dumps(main(json.loads(sys.argv[1]))))
except Exception as error:
    print(json.dumps(dict(error=str(error))), file=sys.stderr)
    sys.exit(1)
`;
