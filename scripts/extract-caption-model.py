import sys
import tarfile

with tarfile.open(sys.argv[1]) as archive:
    archive.extractall(sys.argv[2], filter="data")
