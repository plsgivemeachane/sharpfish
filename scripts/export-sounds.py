#!/usr/bin/env python3
"""Encode the pinned CC0 Kenney samples. Requires ffmpeg; no Python packages.

Download https://opengameart.org/sites/default/files/kenney_casino-audio.zip
then run: python3 scripts/export-sounds.py /path/to/kenney_casino-audio.zip
"""
import hashlib
from pathlib import Path
import subprocess
import sys
import zipfile

ARCHIVE_SHA256 = 'f36250766ac5bc378c13708ddf12a23a8e54a3251f8d482c7536e51b5dbafa18'
SAMPLES = {
    'move': 'chip-lay-1',
    'capture': 'chips-collide-1',
    'castle': 'chip-lay-2',
    'promotion': 'chip-lay-3',
    'check': 'chips-stack-1',
    'start': 'chips-stack-4',
    'end': 'chips-handle-4',
}


def main():
    archive = Path(sys.argv[1])
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise ValueError('Archive does not match the reviewed Kenney Casino Audio 1.1 pack')
    output = Path(__file__).resolve().parents[1] / 'site/sounds'
    output.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as pack:
        for name, original in SAMPLES.items():
            subprocess.run([
                'ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                '-i', 'pipe:0', '-map_metadata', '-1', '-ac', '1', '-ar', '44100',
                '-codec:a', 'libmp3lame', '-b:a', '96k', str(output / (name + '.mp3')),
            ], input=pack.read('Audio/' + original + '.ogg'), check=True)
        (output / 'License.txt').write_bytes(pack.read('License.txt'))


if __name__ == '__main__':
    main()
