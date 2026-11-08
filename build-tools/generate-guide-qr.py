#!/usr/bin/env python3
"""Regenerate the bundled guide QR. Authoring only; requires libqrencode."""
import argparse
import ctypes
import ctypes.util
from pathlib import Path

URL = 'https://samirmartins.github.io/vibelight-tizen/'


class QRCode(ctypes.Structure):
    _fields_ = [('version', ctypes.c_int), ('width', ctypes.c_int),
                ('data', ctypes.POINTER(ctypes.c_ubyte))]


def render():
    name = ctypes.util.find_library('qrencode')
    if not name:
        raise SystemExit('Install libqrencode to regenerate the asset; normal builds use the committed SVG.')
    lib = ctypes.CDLL(name)
    lib.QRcode_encodeString8bit.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
    lib.QRcode_encodeString8bit.restype = ctypes.POINTER(QRCode)
    lib.QRcode_free.argtypes = [ctypes.POINTER(QRCode)]
    code = lib.QRcode_encodeString8bit(URL.encode('ascii'), 0, 2)  # Q error correction.
    if not code:
        raise SystemExit('QR encoding failed')
    try:
        width = code.contents.width
        size = width + 8  # Four unmarked modules on every side.
        path = ''.join(f'M{x+4} {y+4}h1v1h-1z' for y in range(width)
                       for x in range(width) if code.contents.data[y*width+x] & 1)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
                'shape-rendering="crispEdges">\n'
                f'<title>{URL}</title>\n<path fill="#fff" d="M0 0h{size}v{size}H0z"/>\n'
                f'<path fill="#000" d="{path}"/>\n</svg>\n')
    finally:
        lib.QRcode_free(code)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    target = Path(__file__).resolve().parents[1] / 'wasm/static/res/guide-qr.svg'
    content = render()
    if args.check:
        if not target.exists() or target.read_text() != content:
            raise SystemExit('Guide QR is outdated')
        print('Guide QR is reproducible and current.')
    else:
        target.write_text(content)
        print('Generated the local guide QR.')
