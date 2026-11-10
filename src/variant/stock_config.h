/*
  Stockfish, a UCI chess playing engine derived from Glaurung 2.1
  Copyright (C) 2004-2026 The Stockfish developers (see AUTHORS file)

  This file is part of a fork of Stockfish.js and is distributed under the
  GNU General Public License v3 (see Copying.txt).
*/

// Stock settings, used instead of config.h when building with -DVARIANT_STOCK
// (the reference engine behind the site's eval bar). Do not edit: these must
// stay equal to plain Stockfish.

#ifndef VARIANT_STOCK_CONFIG_H_INCLUDED
#define VARIANT_STOCK_CONFIG_H_INCLUDED

namespace Stockfish::Variant {

constexpr const char* EngineName = "";
constexpr int  PieceValueTweakCp[5] = {0, 0, 0, 0, 0};
constexpr int  NnueScalePercent     = 100;
constexpr bool EnableEvalHook       = false;
constexpr bool EnableMoveBias       = false;
constexpr int  RootRandomnessCp     = 0;
constexpr bool AllowCastling        = true;
constexpr bool AllowEnPassant       = true;
constexpr bool AllowUnderpromotion  = true;
constexpr bool AllowPawnDoubleStep  = true;
constexpr bool EnableCustomRules    = false;
constexpr bool EnableNullMove       = true;
constexpr bool EnableScp096         = false;

}  // namespace Stockfish::Variant

#endif  // #ifndef VARIANT_STOCK_CONFIG_H_INCLUDED
