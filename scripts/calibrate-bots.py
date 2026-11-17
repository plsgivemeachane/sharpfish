#!/usr/bin/env python3
"""Small reproducible UCI tournament and conditional Elo fitter.

This is intentionally a temporary research tool. Its ratings are conditional on
the anchors supplied in profiles.json; they are not Chess.com ratings.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import subprocess
import sys
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import chess
import chess.engine
import chess.pgn
import numpy as np
from scipy.optimize import minimize


def sha256_file(command):
    try:
        p = Path(command[0]).resolve()
        if p.is_file():
            return hashlib.sha256(p.read_bytes()).hexdigest()
    except (OSError, TypeError):
        pass
    return None


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def profile_index(profiles):
    return {p["id"]: p for p in profiles}


def opening_fen(openings, index):
    entry = openings[index]
    return entry.get("fen", chess.STARTING_FEN), entry.get("moves", [])


def parse_opening_move(board, text):
    """Accept explicit UCI or SAN; SAN such as dxe5 must not be mistaken for UCI."""
    if re.fullmatch(r"[a-h][1-8][a-h][1-8][qrbn]?", text):
        move = chess.Move.from_uci(text)
    else:
        move = board.parse_san(text)
    if move not in board.legal_moves:
        raise ValueError(f"illegal opening move {text}")
    return move


def play_game(task, profiles, openings, max_plies=180, move_timeout=8.0):
    white = profiles[task["white"]]
    black = profiles[task["black"]]
    board = chess.Board()
    game = chess.pgn.Game()
    original_plies = 0
    game.headers.update({"Event": "Sharpfish calibration", "White": white["name"],
                         "Black": black["name"], "Round": str(task["schedule_id"]),
                         "Opening": str(task["opening"])})
    engines = {}
    try:
        if task.get("initialPgn"):
            parsed = chess.pgn.read_game(io.StringIO(task["initialPgn"]))
            if parsed is None or parsed.end() is None:
                raise ValueError("initialPgn contains no game")
            game = parsed
            node = game.end()
            board = node.board()
            original_plies = len(board.move_stack)
            game.headers["White"] = white["name"]
            game.headers["Black"] = black["name"]
            game.headers["Round"] = str(task["schedule_id"])
            game.headers["Result"] = "*"
        else:
            fen, opening_moves = opening_fen(openings, task["opening"])
            if fen != chess.STARTING_FEN:
                board = chess.Board(fen)
                game.setup(board)
            node = game
            for move_text in opening_moves:
                move = parse_opening_move(board, move_text)
                board.push(move)
                node = node.add_variation(move)
            original_plies = len(board.move_stack)
        for side, profile in ((chess.WHITE, white), (chess.BLACK, black)):
            engines[side] = chess.engine.SimpleEngine.popen_uci(profile["command"], timeout=move_timeout)
            if profile.get("options"):
                engines[side].configure(profile["options"])
        start_ply = len(board.move_stack)
        while len(board.move_stack) - start_ply < max_plies:
            outcome = board.outcome(claim_draw=True)
            if outcome:
                break
            profile = white if board.turn else black
            limit = chess.engine.Limit(nodes=int(profile.get("nodes", 100000)),
                                       depth=profile.get("depth"))
            result = engines[board.turn].play(board, limit, info=chess.engine.INFO_ALL)
            if result.move not in board.legal_moves:
                raise ValueError(f"illegal engine move {result.move}")
            board.push(result.move)
            node = node.add_variation(result.move)
        outcome = board.outcome(claim_draw=True)
        if outcome is None:
            result, termination = "1/2-1/2", "ply-cap"
        else:
            result, termination = outcome.result(), outcome.termination.name
        game.headers["Result"] = result
        game.headers["Termination"] = termination
        game.headers["PlyCount"] = str(len(board.move_stack))
        return {"schedule_id": task["schedule_id"], "white": white["id"], "black": black["id"],
                "opening": task["opening"], "result": result, "termination": termination,
                "plies": len(board.move_stack), "originalPlies": original_plies,
                "continuationPlies": len(board.move_stack) - original_plies,
                "continued": bool(task.get("initialPgn")), "pgn": str(game), "error": None,
                "profile_hashes": {white["id"]: sha256_file(white["command"]),
                                   black["id"]: sha256_file(black["command"])}}
    except Exception as exc:
        game.headers["Result"] = "*"
        return {"schedule_id": task["schedule_id"], "white": white["id"], "black": black["id"],
                "opening": task.get("opening"), "result": None, "termination": "error",
                "plies": len(board.move_stack), "originalPlies": original_plies,
                "continuationPlies": max(0, len(board.move_stack) - original_plies),
                "continued": bool(task.get("initialPgn")), "pgn": str(game), "error": repr(exc),
                "profile_hashes": {white["id"]: sha256_file(white["command"]),
                                   black["id"]: sha256_file(black["command"])}}
    finally:
        for engine in engines.values():
            try:
                engine.quit()
            except Exception:
                pass


def run(args):
    profiles_list = load(args.profiles)
    profiles = profile_index(profiles_list)
    openings = load(args.openings)
    schedule = load(args.schedule)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    done = {}
    if args.resume and output.exists():
        for line in output.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
                done[row["schedule_id"]] = row
            except (ValueError, KeyError):
                continue
    pending = [dict(item, schedule_id=item.get("schedule_id", i)) for i, item in enumerate(schedule)
               if item.get("schedule_id", i) not in done]
    mode = "a" if args.resume else "w"
    with output.open(mode, encoding="utf-8") as stream:
        if not args.resume or output.stat().st_size == 0:
            snapshot = {"record_type": "run_metadata", "generated": datetime.now(timezone.utc).isoformat(),
                        "profiles": [{k: p.get(k) for k in ("id", "name", "command", "options", "nodes", "depth", "ratingAnchor", "kind")}
                                     | {"engine_sha256": sha256_file(p.get("command", []))} for p in profiles_list],
                        "openings": str(Path(args.openings).resolve()), "schedule": str(Path(args.schedule).resolve()),
                        "jobs": args.jobs, "max_plies": args.max_plies, "move_timeout": args.move_timeout}
            stream.write(json.dumps(snapshot, sort_keys=True) + "\n")
            stream.flush()
        with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
            futures = [pool.submit(play_game, item, profiles, openings, args.max_plies, args.move_timeout)
                       for item in pending]
            for future in as_completed(futures):
                row = future.result()
                stream.write(json.dumps(row, sort_keys=True) + "\n")
                stream.flush()
                print(f"{row['schedule_id']} {row['white']} vs {row['black']} {row['result'] or 'ERROR'}",
                      file=sys.stderr, flush=True)
    print(json.dumps({"completed": len(done) + len(pending), "skipped": len(done),
                      "output": str(output)}))


def fit(args):
    profiles = profile_index(load(args.profiles))
    rows = []
    errors = 0
    for line in Path(args.results).read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if row.get("record_type") == "run_metadata":
            continue
        for key in ("white", "black"):
            if row.get(key) not in profiles:
                raise SystemExit(f"result {row.get('schedule_id')} references unknown profile {row.get(key)!r}")
        if row.get("error") or row.get("termination") == "error":
            errors += 1
            continue
        if row.get("result") in ("1-0", "0-1", "1/2-1/2"):
            rows.append(row)
    if not rows:
        raise SystemExit("fit requires at least one completed game")
    ids = sorted({x for r in rows for x in (r["white"], r["black"])})
    anchors = {i: float(profiles[i]["ratingAnchor"]) for i in ids if profiles[i].get("ratingAnchor") is not None}
    free = [i for i in ids if i not in anchors]
    if not anchors:
        raise SystemExit("fit requires at least one profile.ratingAnchor")
    # Every connected component in the observed match graph must touch an anchor.
    graph = {i: set() for i in ids}
    for r in rows:
        graph[r["white"]].add(r["black"]); graph[r["black"]].add(r["white"])
    unseen = set(ids)
    while unseen:
        root = unseen.pop(); component = {root}; stack = [root]
        while stack:
            for nxt in graph[stack.pop()] & unseen:
                unseen.remove(nxt); component.add(nxt); stack.append(nxt)
        if not component & set(anchors):
            raise SystemExit("fit has an unanchored connected component: " + ", ".join(sorted(component)))
    index = {i: n for n, i in enumerate(free)}
    def rating(i, x): return anchors[i] if i in anchors else x[index[i]]
    scale = math.log(10.0) / 400.0
    observations = []
    for r in rows:
        vec = np.zeros(len(free));
        if r["white"] in index: vec[index[r["white"]]] += 1
        if r["black"] in index: vec[index[r["black"]]] -= 1
        anchor_diff = (anchors.get(r["white"], 0) - anchors.get(r["black"], 0)) * scale
        score = 0.5 if r["result"] == "1/2-1/2" else (1.0 if r["result"] == "1-0" else 0.0)
        observations.append((vec, anchor_diff, score, r))
    def terms(x):
        value = 0.0; grad = np.zeros(len(free)); hess = np.zeros((len(free), len(free)))
        for vec, ad, score, _ in observations:
            z = (vec @ x) * scale + ad; p = 1.0 / (1.0 + math.exp(-max(-40.0, min(40.0, z))))
            value -= score * math.log(max(p, 1e-15)) + (1-score) * math.log(max(1-p, 1e-15))
            grad += (p-score) * scale * vec; hess += p*(1-p)*scale*scale*np.outer(vec, vec)
        value += 0.5 * np.sum((x - np.mean(list(anchors.values())))**2) / 1200.0**2
        grad += (x - np.mean(list(anchors.values()))) / 1200.0**2
        hess += np.eye(len(free)) / 1200.0**2
        return value, grad, hess
    def objective(x): return terms(x)[0]
    def jac(x): return terms(x)[1]
    def hess(x): return terms(x)[2]
    initial = np.array([sum(anchors.values()) / len(anchors)] * len(free))
    result = minimize(objective, initial, jac=jac, hess=hess, method="trust-exact")
    ratings = dict(anchors)
    ratings.update({i: float(result.x[index[i]]) for i in free})
    covariance = np.linalg.pinv(hess(result.x))
    # Sandwich covariance reflects game-to-game residual dispersion; diagonal
    # prior keeps undefeated/never-lost estimates finite and is reported below.
    residuals = []
    cluster_scores = {}
    for vec, ad, score, r in observations:
        z = (vec @ result.x) * scale + ad; p = 1.0 / (1.0 + math.exp(-max(-40.0, min(40.0, z))))
        residuals.append({"schedule_id": r.get("schedule_id"), "white": r["white"], "black": r["black"],
                          "result": r["result"], "expected_white": round(p, 5), "residual": round(score-p, 5)})
        group = (tuple(sorted((r["white"], r["black"]))), r.get("opening"))
        cluster_scores[group] = cluster_scores.get(group, np.zeros(len(free))) + (score-p) * scale * vec
    # Games sharing an unordered pair and opening are one cluster. This keeps
    # opening-specific and color-paired correlation from pretending to be iid.
    cluster_meat = sum((np.outer(g, g) for g in cluster_scores.values()), np.zeros_like(covariance))
    robust_covariance = covariance @ cluster_meat @ covariance
    model_ci = {i: [round(ratings[i] - 1.96 * math.sqrt(max(covariance[index[i], index[i]], 0)), 1),
                    round(ratings[i] + 1.96 * math.sqrt(max(covariance[index[i], index[i]], 0)), 1)] for i in free}
    robust_ci = {i: [round(ratings[i] - 1.96 * math.sqrt(max(robust_covariance[index[i], index[i]], 0)), 1),
                     round(ratings[i] + 1.96 * math.sqrt(max(robust_covariance[index[i], index[i]], 0)), 1)] for i in free}
    summary = {"generated": datetime.now(timezone.utc).isoformat(), "conditional_on_anchors": anchors,
               "games": len(rows), "optimizer_success": bool(result.success), "message": result.message,
               "ratings": {i: round(v, 1) for i, v in ratings.items()},
               "conditional_95_ci_model": model_ci, "conditional_95_ci_cluster_robust": robust_ci,
               "uncertainty_basis": "clustered sandwich by unordered profile pair + opening; model-Hessian intervals are provided separately",
               "stabilizer": "weak N(anchors_mean, 1200 Elo) prior; finite estimates are conditional, not measured bounds",
               "errors_excluded": errors, "counts": {}, "opponents": {}, "residuals": residuals}
    for i in ids:
        wins = draws = losses = 0
        for r in rows:
            if i not in (r["white"], r["black"]): continue
            score = r["result"] if r["white"] == i else ("0-1" if r["result"] == "1-0" else "1-0" if r["result"] == "0-1" else r["result"])
            wins += score == "1-0"; losses += score == "0-1"; draws += score == "1/2-1/2"
        caps = sum(r.get("termination") == "ply-cap" for r in rows if i in (r["white"], r["black"]))
        summary["counts"][i] = {"games": wins + draws + losses, "wins": wins, "draws": draws,
                                 "losses": losses, "ply_caps": caps}
        summary["opponents"][i] = {}
        for j in ids:
            if i == j: continue
            subset = [r for r in rows if {r["white"], r["black"]} == {i, j}]
            if subset:
                score = sum(0.5 if r["result"] == "1/2-1/2" else
                            (1 if r["result"] == ("1-0" if r["white"] == i else "0-1") else 0)
                            for r in subset) / len(subset)
                summary["opponents"][i][j] = {"games": len(subset), "score": round(score, 4)}
    weak = {}
    for i, count in summary["counts"].items():
        reasons = []
        decisive = count["wins"] + count["losses"]
        if count["games"] < 20: reasons.append("fewer_than_20_games")
        if decisive == 0: reasons.append("no_decisive_results")
        if count["wins"] == 0 or count["losses"] == 0: reasons.append("one_sided_results")
        if count["ply_caps"]: reasons.append("contains_ply_caps")
        if reasons: weak[i] = reasons
    summary["weak_identification"] = weak
    Path(args.output).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


def report(args):
    """Summarize held-out opening performance using an existing fit."""
    fitted = load(args.fit)
    ratings = fitted["ratings"]
    rows = []
    for line in Path(args.results).read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if row.get("record_type") != "run_metadata" and not row.get("error") and row.get("result") in ("1-0", "0-1", "1/2-1/2"):
            rows.append(row)
    train, holdout = [r for r in rows if int(r.get("opening", 0)) < args.holdout_from], [r for r in rows if int(r.get("opening", 0)) >= args.holdout_from]
    def loss(r):
        diff = (ratings[r["white"]] - ratings[r["black"]]) / 400.0
        p = 1.0 / (1.0 + 10.0 ** (-diff))
        # Outcome is always from White's perspective for the fitted model.
        y = 0.5 if r["result"] == "1/2-1/2" else (1.0 if r["result"] == "1-0" else 0.0)
        return -(y * math.log(max(p, 1e-15)) + (1-y) * math.log(max(1-p, 1e-15))), p
    pair = {}
    for r in holdout:
        value, _ = loss(r); key = tuple(sorted((r["white"], r["black"])))
        pair.setdefault(key, []).append(value)
    summary = {"train_games": len(train), "heldout_games": len(holdout), "holdout_from_opening": args.holdout_from,
               "heldout_logloss": round(sum(loss(r)[0] for r in holdout) / len(holdout), 6) if holdout else None,
               "pair_macro_logloss": round(sum(sum(v)/len(v) for v in pair.values()) / len(pair), 6) if pair else None,
               "heldout_pairs": {"|".join(k): {"games": len(v), "logloss": round(sum(v)/len(v), 6)} for k, v in pair.items()}}
    if args.output: Path(args.output).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    run_p = sub.add_parser("run")
    run_p.add_argument("--profiles", required=True); run_p.add_argument("--schedule", required=True)
    run_p.add_argument("--openings", required=True); run_p.add_argument("--output", required=True)
    run_p.add_argument("--jobs", type=int, default=4); run_p.add_argument("--max-plies", type=int, default=180)
    run_p.add_argument("--move-timeout", type=float, default=8); run_p.add_argument("--resume", action="store_true")
    run_p.set_defaults(func=run)
    fit_p = sub.add_parser("fit")
    fit_p.add_argument("--profiles", required=True); fit_p.add_argument("--results", required=True); fit_p.add_argument("--output", required=True)
    fit_p.set_defaults(func=fit)
    report_p = sub.add_parser("report")
    report_p.add_argument("--profiles", required=False)  # retained for command symmetry
    report_p.add_argument("--results", required=True); report_p.add_argument("--fit", required=True)
    report_p.add_argument("--holdout-from", type=int, default=16); report_p.add_argument("--output")
    report_p.set_defaults(func=report)
    args = parser.parse_args(); args.func(args)


if __name__ == "__main__": main()
