#!/usr/bin/env python3
"""Verify Embind protection in the actual WGT member; does not verify signatures."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('widgets', type=Path, nargs='+')
    parser.add_argument('--node', default='node')
    args = parser.parse_args()
    checker = Path(__file__).with_name('patch-embind-string.cjs')
    for widget in args.widgets:
        with ZipFile(widget) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise ValueError('Duplicate ZIP entries')
            source = archive.read('moonlight-wasm.js')
        result = subprocess.run([args.node, str(checker), '--check', '-'], input=source,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        if result.returncode:
            raise ValueError(result.stderr.decode().strip())
        print(f'{widget.name}: Embind OK; moonlight-wasm.js SHA256 {hashlib.sha256(source).hexdigest()}')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        sys.exit('WGT Embind verification failed: ' + str(error))
