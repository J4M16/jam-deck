import hashlib
import importlib.util
import io
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

extractor = load("extractor", "extract-caption-model.py")
packager = load("packager", "package-release.py")

class Distribution(unittest.TestCase):
    def test_only_required_model_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "models.tar"
            with tarfile.open(archive, "w") as tar:
                for name, content in [("model/keep.onnx", b"model"), ("model/64/keep.onnx", b"duplicate"), ("model/unused.onnx", b"unused")]:
                    info = tarfile.TarInfo(name); info.size = len(content)
                    tar.addfile(info, io.BytesIO(content))
            spec = {"name": "model", "files": {"keep.onnx": hashlib.sha256(b"model").hexdigest()}}
            extractor.extract(archive, root / "out", spec)
            self.assertEqual([p.name for p in (root / "out/model").iterdir()], ["keep.onnx"])
            spec["files"]["keep.onnx"] = "wrong hash"
            with self.assertRaisesRegex(ValueError, "checksum"):
                extractor.extract(archive, root / "out", spec)

    def test_release_whitelists(self):
        self.assertNotIn("caption-host.js", packager.BASE)
        self.assertIn("caption-host.js", packager.CAPTIONS)
        self.assertIn("scripts/setup-captions.ps1", packager.CAPTIONS)
        for name in packager.BASE + packager.CAPTIONS:
            self.assertTrue((ROOT / name).is_file())
            self.assertNotIn(".cache", name)
            self.assertNotIn("data.json", name)
            self.assertFalse(name.endswith((".onnx", ".exe", ".bz2")))

if __name__ == "__main__": unittest.main()
