import sys
import tarfile
import hashlib
import json
from pathlib import Path

def extract(archive_path, destination, spec):
    target = Path(destination).resolve() / spec["name"]
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive_path) as archive:
        members = {member.name: member for member in archive.getmembers()}
        for filename, expected in spec["files"].items():
            if Path(filename).name != filename:
                raise ValueError("Model filename must be a basename")
            member = members.get(spec["name"] + "/" + filename)
            if member is None or not member.isfile():
                raise ValueError("Missing regular model file: " + filename)
            data = archive.extractfile(member).read()
            if hashlib.sha256(data).hexdigest().upper() != expected.upper():
                raise ValueError("Model checksum mismatch: " + filename)
            temporary = target / (filename + ".partial")
            temporary.write_bytes(data)
            temporary.replace(target / filename)

if __name__ == "__main__":
    spec = json.loads(Path(__file__).with_name("caption-model.json").read_text(encoding="utf-8"))
    extract(sys.argv[1], sys.argv[2], spec)
