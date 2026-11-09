/*
  Stockfish, a UCI chess playing engine derived from Glaurung 2.1
  Copyright (C) 2004-2026 The Stockfish developers (see AUTHORS file)

  This file is part of a fork of Stockfish.js and is distributed under the
  GNU General Public License v3 (see Copying.txt).
*/

// =============================================================================
//  VARIANT CONFIG  -  the one file most forks need to edit.
//
//  Every value below defaults to "behave exactly like stock Stockfish".
//  Change a number, run ./make-web.sh, open site/ and play against your engine.
//
//  Units: "cp" = centipawns (100 cp = one pawn), the same unit the engine
//  prints in "info ... score cp".
//  For logic that does not fit into a number, edit src/variant/hooks.h.
// =============================================================================

#ifndef VARIANT_CONFIG_H_INCLUDED
#define VARIANT_CONFIG_H_INCLUDED

// make-web.sh also builds an unmodified engine for the site's eval bar by
// compiling with -DVARIANT_STOCK, which swaps this file for stock_config.h.
// If you add a new setting here, add its stock value there too.
#ifdef VARIANT_STOCK
    #include "stock_config.h"
#else

namespace Stockfish::Variant {

// Name shown by "uci" as "id name ...". Give your fork its own name.
constexpr const char* EngineName = "Alternating Stockfish";  // "" keeps the default Stockfish name

// -----------------------------------------------------------------------------
//  1. PIECE VALUES
//
//  The neural network (NNUE) already "knows" how much each piece is worth, so
//  these are *extra* centipawns on top of what the network thinks.
//    { pawn, knight, bishop, rook, queen }
//  Example: { 0, 50, 0, 0, -100 }  -> loves knights, undervalues the queen.
// -----------------------------------------------------------------------------
constexpr int PieceValueTweakCp[5] = {0, 0, 0, 0, 0};

// -----------------------------------------------------------------------------
//  2. EVALUATION
// -----------------------------------------------------------------------------
// Scale the network's opinion, in percent. 100 = normal. Lower values make
// the engine care less about the network and more about your own terms.
constexpr int NnueScalePercent = 100;

// Turn on Variant::eval_bonus_cp() in hooks.h (your hand-written eval terms).
constexpr bool EnableEvalHook = false;

// -----------------------------------------------------------------------------
//  3. MOVE RATING (root move bias)
//
//  At the top of the tree each candidate move gets
//      score += move_bias_cp(position, move)        (see hooks.h)
//  Use it to make the engine prefer or avoid certain moves.
// -----------------------------------------------------------------------------
constexpr bool EnableMoveBias = false;

// Random noise added to each root move, in cp (0 = deterministic).
// 20-40 gives variety without blundering. Needs EnableMoveBias = true.
constexpr int RootRandomnessCp = 0;

// -----------------------------------------------------------------------------
//  4. RULES
//
//  Moves rejected here are illegal for the engine AND for the web board in
//  site/ (it asks the engine which moves are legal).
//  Note: these only remove moves. New piece types or new win conditions need
//  deeper changes in movegen.cpp / position.cpp / search.cpp.
// -----------------------------------------------------------------------------
constexpr bool AllowCastling       = true;
constexpr bool AllowEnPassant      = true;
constexpr bool AllowUnderpromotion = true;   // false = pawns may only promote to a queen
constexpr bool AllowPawnDoubleStep = true;

// Turn on Variant::move_allowed_custom() in hooks.h for your own rules.
constexpr bool EnableCustomRules = false;

// Alternating square colors: a move must land on the opposite color to the
// previous move's destination (castling counts the king's square).
//   0 = off (normal chess)
//   1 = each side alternates its own moves (white: light, dark, light, ...)
//   2 = every move alternates, shared by both sides
// A side with no move on the required color is checkmated if in check,
// otherwise stalemated (draw). The first move of a game may land anywhere.
constexpr int AlternateSquareColors = 1;

// -----------------------------------------------------------------------------
//  5. SEARCH
// -----------------------------------------------------------------------------
// Null-move pruning is a big speed-up, but it is unsound in some variants
// (e.g. when passing would be good). Turn it off if your rules need that.
// Off for the alternating-colors rule: being forced onto one color makes
// zugzwang common, which null-move pruning assumes away.
constexpr bool EnableNullMove = AlternateSquareColors == 0;

}  // namespace Stockfish::Variant

#endif  // VARIANT_STOCK
#endif  // #ifndef VARIANT_CONFIG_H_INCLUDED
