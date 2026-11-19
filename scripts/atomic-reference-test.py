#!/usr/bin/env python3
"""Differential Atomic legality/perft checks against python-chess.

This is a development-only oracle harness.  It never becomes a project
dependency: use the isolated venv below (or pass --python), pinned to
python-chess==1.11.2.  Fairy-Stockfish is intentionally not used as the
oracle.  Run after building the Atomic native executable, for example:

  python3 scripts/atomic-reference-test.py --engine src/stockfish

The engine is expected to be the compile-time Atomic build and to support the
normal UCI `position`, `d` and `go perft` commands.  A mismatch prints the
fixture, FEN, and both legal-move/perft results before exiting nonzero.
"""

from __future__ import annotations

import argparse
import os
import random
import re
import shutil
import sys
from pathlib import Path

CHESS_VERSION = "1.11.2"
VENV = Path("/tmp/sharpfish-atomic-reference")
MOVE_RE = re.compile(r"^([a-h][1-8][a-h][1-8][qrbn]?):\s*(\d+)\s*$")
FEN_RE = re.compile(r"^Fen:\s+(.+?)\s*$")


def import_chess():
    try:
        import chess  # type: ignore
        import chess.variant  # type: ignore
    except ModuleNotFoundError as exc:
        raise SystemExit(
            f"Missing python-chess. Create the isolated oracle venv with:\n"
            f"  python3 -m venv {VENV}\n"
            f"  {VENV}/bin/python -m pip install 'chess=={CHESS_VERSION}'\n"
            f"then rerun with {VENV}/bin/python scripts/atomic-reference-test.py ..."
        ) from exc
    if getattr(chess, "__version__", None) != CHESS_VERSION:
        raise SystemExit(
            f"python-chess {CHESS_VERSION} is required; found {getattr(chess, '__version__', 'unknown')}"
        )
    return chess


class Uci:
    def __init__(self, executable: str, timeout: float):
        try:
            import pexpect  # type: ignore
        except ModuleNotFoundError as exc:
            raise SystemExit(f"Missing pexpect; install it in the oracle venv: {VENV}/bin/python -m pip install 'chess=={CHESS_VERSION}' pexpect") from exc
        self.proc = pexpect.spawn(executable, encoding="utf-8", timeout=timeout)
        self.proc.delaybeforesend = 0
        self.timeout = timeout
        self.proc.sendline("uci")
        self.proc.expect("uciok")
        self.proc.sendline("setoption name UCI_LimitStrength value false")
        self.proc.sendline("isready")
        self.proc.expect("readyok")

    def command(self, command: str, end: str, extra_end: str | None = None) -> list[str]:
        self.proc.sendline(command)
        self.proc.expect(end if not extra_end else f"(?:{re.escape(end)}|{re.escape(extra_end)})")
        return (self.proc.before + self.proc.after).splitlines()

    def read_until_prefix(self, prefix: str) -> list[str]:
        self.proc.expect(re.escape(prefix) + r"\s*\d+")
        return (self.proc.before + self.proc.after).splitlines()

    def inspect(self, fen: str, depth: int = 1, move: str | None = None) -> tuple[str, set[str], int]:
        self.proc.sendline(f"position fen {fen}" + (f" moves {move}" if move else ""))
        display = self.command("d", "Checkers:")
        shown_fen = next((m.group(1) for line in display if (m := FEN_RE.match(line))), "")
        key = next((line for line in display if line.startswith("Key: ")), None)
        self.proc.sendline(f"go perft {depth}")
        perft = self.read_until_prefix("Nodes searched:")
        total = next((int(m.group(1)) for line in reversed(perft)
                      if (m := re.search(r"Nodes searched:\s*(\d+)", line))), None)
        if total is None:
            raise RuntimeError("engine omitted Nodes searched from perft output")
        moves = {m.group(1) for line in perft if (m := MOVE_RE.match(line))}
        restored = self.command("d", "Checkers:")
        restored_fen = next((m.group(1) for line in restored if (m := FEN_RE.match(line))), "")
        restored_key = next((line for line in restored if line.startswith("Key: ")), None)
        if restored_fen != shown_fen or restored_key != key:
            raise AssertionError(f"perft make/undo corrupted FEN or key: {shown_fen} -> {restored_fen}, {key} -> {restored_key}")
        # depth 1 emits individual root moves; deeper perft still has the same
        # root move lines and their child counts.
        return shown_fen, moves, total

    def close(self) -> None:
        if self.proc.isalive():
            try:
                self.proc.sendline("quit")
                self.proc.close(force=False)
            except Exception:
                self.proc.close(force=True)


def count(board, depth: int) -> int:
    if depth == 0:
        return 1
    total = 0
    for move in list(board.legal_moves):
        board.push(move)
        total += count(board, depth - 1)
        board.pop()
    return total


def expected(chess, fen: str, depth: int) -> tuple[set[str], int, object]:
    board = chess.variant.AtomicBoard(fen)
    moves = {move.uci() for move in board.legal_moves}
    return moves, count(board, depth), board


def fixture_fens(chess) -> list[tuple[str, str]]:
    # Each fixture isolates a rule that ordinary chess cannot model.  FENs are
    # generated by python-chess where possible so this file remains readable.
    return [
        ("start", chess.variant.AtomicBoard().fen()),
        ("adjacent-kings", "8/8/8/8/8/8/4kK2/8 w - - 0 1"),
        ("blast-collateral", "7k/8/8/3p4/2B1r3/3P4/8/K7 w - - 0 1"),
        ("en-passant-blast", "7k/8/8/3pP3/8/8/8/K7 w - d6 0 2"),
        ("promotion-capture", "6rk/5P2/8/8/8/8/8/K7 w - - 0 1"),
        ("castling", "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"),
        ("king-explosion", "7k/6p1/8/8/8/8/8/K5R1 w - - 0 1"),
        ("self-blast-forbidden", "7k/8/8/8/8/8/1p6/KR6 w - - 0 1"),
        ("castling-through-check", "4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1"),
        ("connected-check-suppression", "8/8/8/8/8/8/r3kK2/8 w - - 0 1"),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, help="Atomic native Stockfish executable")
    parser.add_argument("--depth", type=int, default=1, choices=(1, 2), help="perft depth (default: 1)")
    parser.add_argument("--random-games", type=int, default=4, help="deterministic oracle games (default: 4)")
    parser.add_argument("--random-plies", type=int, default=18, help="plies per oracle game (default: 18)")
    args = parser.parse_args()
    chess = import_chess()
    engine_path = shutil.which(args.engine) or str(Path(args.engine).resolve())
    if not os.path.isfile(engine_path) or not os.access(engine_path, os.X_OK):
        raise SystemExit(f"Atomic engine is not executable: {args.engine}")
    uci = Uci(engine_path, timeout=30)
    checks = 0
    try:
        for name, fen in fixture_fens(chess):
            oracle_moves, oracle_nodes, board = expected(chess, fen, args.depth)
            shown, actual_moves, actual_nodes = uci.inspect(fen, args.depth)
            checks += 1
            if shown.split()[:4] != fen.split()[:4]:
                raise AssertionError(f"{name}: engine FEN differs\n  expected {fen}\n  actual   {shown}")
            if actual_moves != oracle_moves:
                raise AssertionError(f"{name}: legal moves differ\n  missing {sorted(oracle_moves - actual_moves)}\n  extra   {sorted(actual_moves - oracle_moves)}")
            if actual_nodes != oracle_nodes:
                raise AssertionError(f"{name}: perft {args.depth} differs: expected {oracle_nodes}, actual {actual_nodes}")
            print(f"PASS {name}: {len(oracle_moves)} legal, perft {args.depth} = {oracle_nodes}")

        rng = random.Random(0xA70A1C)
        for game in range(args.random_games):
            board = chess.variant.AtomicBoard()
            for ply in range(args.random_plies):
                if board.is_variant_end() or board.is_checkmate() or board.is_stalemate():
                    break
                fen = board.fen()
                oracle_moves, oracle_nodes, _ = expected(chess, fen, 1)
                shown, actual_moves, actual_nodes = uci.inspect(fen, 1)
                checks += 1
                if actual_moves != oracle_moves or actual_nodes != oracle_nodes:
                    raise AssertionError(f"random game {game} ply {ply}: mismatch at {fen}\n"
                                         f"missing={sorted(oracle_moves - actual_moves)} extra={sorted(actual_moves - oracle_moves)} "
                                         f"nodes={oracle_nodes}/{actual_nodes}")
                move = rng.choice(sorted(oracle_moves))
                board.push_uci(move)
                child_fen, child_moves, _ = uci.inspect(fen, 1, move)
                if child_fen != board.fen():
                    raise AssertionError(f"random game {game} ply {ply}: transition {move} differs\nexpected {board.fen()}\nactual   {child_fen}")
                if child_moves != {candidate.uci() for candidate in board.legal_moves}:
                    raise AssertionError(f"random game {game} ply {ply}: child legal moves differ after {move}")
            print(f"PASS random game {game + 1}: checked {ply + 1} positions")
        print(f"Atomic differential verification passed: {checks} positions; oracle python-chess=={CHESS_VERSION}")
        return 0
    finally:
        uci.close()


if __name__ == "__main__":
    raise SystemExit(main())
