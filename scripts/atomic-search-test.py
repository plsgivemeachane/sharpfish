#!/usr/bin/env python3
"""Exercise UCI search contracts independently of the analysis UI."""
import pathlib
import subprocess
import sys
import threading
import queue
import time

engine = subprocess.Popen([str(pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'src/stockfish').resolve())], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
lines = queue.Queue()
def read():
    for line in engine.stdout:
        lines.put(line.strip())
threading.Thread(target=read, daemon=True).start()
def send(command):
    engine.stdin.write(command + '\n')
    engine.stdin.flush()
def until(prefix, timeout=5):
    result = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        line = lines.get(timeout=max(.01, deadline-time.monotonic()))
        result.append(line)
        if line.startswith(prefix):
            return result
    raise AssertionError((prefix, result))
try:
    send('uci'); until('uciok')
    send('setoption name Threads value 1')
    send('setoption name UCI_LimitStrength value false')
    send('position fen 7k/6p1/8/8/8/8/8/K5R1 w - - 0 1')
    send('go depth 2')
    result = until('bestmove')
    assert result[-1] == 'bestmove g1g7', result
    assert any('score mate 1 ' in x for x in result), result
    send('position fen 7k/5Q2/8/8/8/8/8/K6R b - - 0 1')
    send('go depth 2')
    result = until('bestmove')
    assert result[-1] == 'bestmove (none)', result
    assert any('score mate 0' in x for x in result), result
    for control in ['movetime 100', 'nodes 200', 'depth 12']:
        send('position startpos')
        start = time.monotonic()
        send('go ' + control)
        if control == 'depth 12':
            time.sleep(.05)
            send('stop')
        result = until('bestmove', 3)
        assert time.monotonic() - start < 2, result
        assert result[-1] != 'bestmove (none)', result
    send('position fen 7k/8/8/8/8/8/8/K7 w - - 0 1')
    send('go depth 2')
    result = until('bestmove')
    assert any('score cp 0' in x for x in result), result
    print('PASS Atomic mate distance, checkmate, time/node limits, stop fallback and drawn evaluation')
finally:
    engine.kill()
    engine.wait()
