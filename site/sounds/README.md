# Chess sound effects

Source: [Kenney Casino Audio 1.1](https://kenney.nl/assets/casino-audio),
by Kenney Vleugels (Kenney.nl), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
The original `License.txt` is included. These are board-game foley samples,
not copied Chess.com assets.

Pinned archive: https://opengameart.org/sites/default/files/kenney_casino-audio.zip

SHA-256: `f36250766ac5bc378c13708ddf12a23a8e54a3251f8d482c7536e51b5dbafa18`

| Local file | Original in `Audio/` | Use |
| --- | --- | --- |
| move.mp3 | chip-lay-1.ogg | Piece placement / backward replay |
| capture.mp3 | chips-collide-1.ogg | Capture, including en passant |
| castle.mp3 | chip-lay-2.ogg | Castling |
| promotion.mp3 | chip-lay-3.ogg | Promotion |
| check.mp3 | chips-stack-1.ogg | Check |
| start.mp3 | chips-stack-4.ogg | Explicit new game |
| end.mp3 | chips-handle-4.ogg | Checkmate, draw or other game ending |

Samples are encoded as mono 44.1 kHz, 96 kbps MP3 for browser compatibility.
Regenerate with `python3 scripts/export-sounds.py /path/to/kenney_casino-audio.zip`
(requires ffmpeg). No audio dependency is required in the deployed site.

`sound.js` plays one cue per completed move: ending takes priority over check,
then promotion, castle, capture and normal move. Replay jumps sound once rather
than playing every skipped move. Sound is on by default, unlocked by a user
gesture, and muted with the shared `sharpfish-sound` local preference. Failed
downloads or blocked audio leave gameplay operational. Late sounds are discarded.
