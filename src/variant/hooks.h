/*
  Stockfish, a UCI chess playing engine derived from Glaurung 2.1
  Copyright (C) 2004-2026 The Stockfish developers (see AUTHORS file)

  This file is part of a fork of Stockfish.js and is distributed under the
  GNU General Public License v3 (see Copying.txt).
*/

// =============================================================================
//  VARIANT HOOKS  -  custom logic for forks.
//
//  The three functions marked "EDIT ME" are the places to put your own ideas.
//  They are only called when the matching switch in config.h is on, so the
//  default build is exactly stock Stockfish.
//
//  Useful Position calls (see src/position.h):
//    pos.side_to_move()            WHITE or BLACK
//    pos.pieces(color, KNIGHT)     bitboard of that color's knights
//    pos.piece_on(square)          piece on a square (NO_PIECE if empty)
//    pos.moved_piece(m)            piece that move m moves
//    pos.capture(m)                is m a capture?
//    pos.checkers()                non-zero if the side to move is in check
//    popcount(bitboard)            number of pieces in a bitboard
//  Useful Move calls (see src/types.h):
//    m.from_sq(), m.to_sq(), m.type_of() (NORMAL/PROMOTION/EN_PASSANT/CASTLING),
//    m.promotion_type()
// =============================================================================

#ifndef VARIANT_HOOKS_H_INCLUDED
#define VARIANT_HOOKS_H_INCLUDED

#include <random>

#include "../bitboard.h"
#include "../position.h"
#include "../types.h"
#include "config.h"

namespace Stockfish::Variant {

// Converts centipawns to the engine's internal score units. In uci.cpp the
// engine prints cp = 100 * v / a, where a is about 304 at normal material.
constexpr int cp_to_internal(int cp) { return cp * 304 / 100; }


// ---------------------------------------------------------------- EDIT ME (1)
// Extra evaluation, in cp, from the point of view of the SIDE TO MOVE.
// Called for every evaluated position when EnableEvalHook = true, so keep it
// fast. Positive = good for the side to move.
inline int eval_bonus_cp(const Position& pos) {
    (void) pos;
    int bonus = 0;

    // Example: +15 cp for each own knight on the four centre squares.
    // Color    us      = pos.side_to_move();
    // Bitboard centre  = square_bb(SQ_D4) | square_bb(SQ_E4) | square_bb(SQ_D5) | square_bb(SQ_E5);
    // bonus += 15 * popcount(pos.pieces(us, KNIGHT) & centre);
    // bonus -= 15 * popcount(pos.pieces(~us, KNIGHT) & centre);

    return bonus;
}


// ---------------------------------------------------------------- EDIT ME (2)
// Rate a move at the root, in cp. pos is the position BEFORE the move.
// Called when EnableMoveBias = true. Positive = engine likes the move more.
inline int move_bias_cp(const Position& pos, Move m) {
    (void) pos;
    (void) m;
    int bias = 0;

    // Example: prefer castling, dislike early queen moves.
    // if (m.type_of() == CASTLING)                                   bias += 30;
    // if (type_of(pos.moved_piece(m)) == QUEEN && pos.game_ply() < 10) bias -= 20;

    return bias;
}


// ---------------------------------------------------------------- EDIT ME (3)
// Extra rules. Return false to forbid a move. pos is the position BEFORE the
// move. Called when EnableCustomRules = true.
inline bool move_allowed_custom(const Position& pos, Move m) {
    (void) pos;
    (void) m;

    // Example: kings may not move to the edge of the board.
    // if (type_of(pos.moved_piece(m)) == KING)
    // {
    //     File f = file_of(m.to_sq());
    //     Rank r = rank_of(m.to_sq());
    //     if (f == FILE_A || f == FILE_H || r == RANK_1 || r == RANK_8)
    //         return false;
    // }

    return true;
}


// =============================================================================
//  Plumbing below - called from evaluate.cpp, search.cpp, position.cpp and
//  movegen.cpp. Forks normally do not need to touch it.
// =============================================================================

constexpr bool HasPieceTweak = PieceValueTweakCp[0] || PieceValueTweakCp[1] || PieceValueTweakCp[2]
                            || PieceValueTweakCp[3] || PieceValueTweakCp[4];

constexpr bool HasRuleFilter = !AllowCastling || !AllowEnPassant || !AllowUnderpromotion
                            || !AllowPawnDoubleStep || EnableCustomRules
                            || AlternateSquareColors != 0;

// a1 is dark, so a square is light when file + rank is odd.
constexpr bool is_light(Square s) { return (int(file_of(s)) + int(rank_of(s))) & 1; }

// Total eval adjustment in internal units, side-to-move point of view.
inline int eval_adjust(const Position& pos) {
    int cp = 0;

    if constexpr (HasPieceTweak)
    {
        Color us = pos.side_to_move();
        for (int pt = PAWN; pt <= QUEEN; ++pt)
            cp += PieceValueTweakCp[pt - PAWN]
                * (popcount(pos.pieces(us, PieceType(pt))) - popcount(pos.pieces(~us, PieceType(pt))));
    }

    if constexpr (EnableEvalHook)
        cp += eval_bonus_cp(pos);

    return cp_to_internal(cp);
}

// Same position + same move gives the same noise within one page load, so
// the engine stays consistent across search iterations.
inline int root_noise_cp(const Position& pos, Move m) {
    static const u64 sessionSeed = u64(std::random_device{}()) << 32 | std::random_device{}();
    u64 x = pos.key() ^ (u64(m.raw()) * 0x9E3779B97F4A7C15ULL) ^ sessionSeed;
    x ^= x >> 33, x *= 0xFF51AFD7ED558CCDULL, x ^= x >> 33;
    return int(x % u64(2 * RootRandomnessCp + 1)) - RootRandomnessCp;
}

// Root move bias in internal units.
inline int root_bias(const Position& pos, Move m) {
    int cp = move_bias_cp(pos, m);
    if constexpr (RootRandomnessCp > 0)
        cp += root_noise_cp(pos, m);
    return cp_to_internal(cp);
}

// The rules filter. pos is the position before the move.
inline bool move_allowed(const Position& pos, Move m) {
    if constexpr (!AllowCastling)
        if (m.type_of() == CASTLING)
            return false;

    if constexpr (!AllowEnPassant)
        if (m.type_of() == EN_PASSANT)
            return false;

    if constexpr (!AllowUnderpromotion)
        if (m.type_of() == PROMOTION && m.promotion_type() != QUEEN)
            return false;

    if constexpr (!AllowPawnDoubleStep)
        if (type_of(pos.moved_piece(m)) == PAWN
            && std::abs(int(rank_of(m.to_sq())) - int(rank_of(m.from_sq()))) == 2)
            return false;

    if constexpr (AlternateSquareColors != 0)
        if (int need = pos.need_color(pos.side_to_move()))
        {
            Square to = m.type_of() == CASTLING
                        ? relative_square(pos.side_to_move(),
                                          m.to_sq() > m.from_sq() ? SQ_G1 : SQ_C1)
                        : m.to_sq();
            if (is_light(to) != (need == 2))
                return false;
        }

    if constexpr (EnableCustomRules)
        return move_allowed_custom(pos, m);

    return true;
}

}  // namespace Stockfish::Variant

#endif  // #ifndef VARIANT_HOOKS_H_INCLUDED
