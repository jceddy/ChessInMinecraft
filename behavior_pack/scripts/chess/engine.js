// Self-contained chess rules engine: board representation, legal move
// generation (including check detection, castling, en passant, promotion)
// and game-over detection. No Minecraft APIs are used in this file so it
// can be tested/reasoned about independently of the game session/UI layer.

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

export function squareName(sq) {
  const file = sq % 8;
  const rank = Math.floor(sq / 8);
  return `${FILES[file]}${rank + 1}`;
}

export function fileOf(sq) {
  return sq % 8;
}

export function rankOf(sq) {
  return Math.floor(sq / 8);
}

export function pieceColor(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? "w" : "b";
}

export function pieceType(piece) {
  if (!piece) return null;
  return piece.toUpperCase();
}

export const PIECE_GLYPHS = {
  P: "♙", N: "♘", B: "♗", R: "♖", Q: "♕", K: "♔",
  p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
};

export const PIECE_NAMES = {
  P: "Pawn", N: "Knight", B: "Bishop", R: "Rook", Q: "Queen", K: "King",
  p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King",
};

const KNIGHT_DELTAS = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_DELTAS = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function inBounds(file, rank) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

function sq(file, rank) {
  return rank * 8 + file;
}

export class ChessEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = ChessEngine.initialBoard();
    this.turn = "w";
    this.castling = { K: true, Q: true, k: true, q: true };
    this.enPassant = null; // square index eligible for en-passant capture, or null
    this.halfmoveClock = 0;
    this.lastMove = null; // { from, to, piece, captured }
  }

  static initialBoard() {
    const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
    const board = new Array(64).fill(null);
    for (let f = 0; f < 8; f++) {
      board[sq(f, 0)] = back[f];
      board[sq(f, 1)] = "P";
      board[sq(f, 6)] = "p";
      board[sq(f, 7)] = back[f].toLowerCase();
    }
    return board;
  }

  serialize() {
    return {
      board: this.board.map((p) => p || ""),
      turn: this.turn,
      castling: this.castling,
      enPassant: this.enPassant,
      halfmoveClock: this.halfmoveClock,
      lastMove: this.lastMove,
    };
  }

  deserialize(data) {
    this.board = data.board.map((p) => (p ? p : null));
    this.turn = data.turn;
    this.castling = data.castling;
    this.enPassant = data.enPassant ?? null;
    this.halfmoveClock = data.halfmoveClock ?? 0;
    this.lastMove = data.lastMove ?? null;
  }

  /** Squares attacked by `color`, used for check detection. Does not
   * consider whose turn it is. */
  isSquareAttacked(target, byColor, board = this.board) {
    const tf = fileOf(target);
    const tr = rankOf(target);

    // Pawns
    const pawnRankDelta = byColor === "w" ? -1 : 1;
    for (const df of [-1, 1]) {
      const f = tf + df;
      const r = tr + pawnRankDelta;
      if (inBounds(f, r)) {
        const p = board[sq(f, r)];
        if (p && pieceColor(p) === byColor && pieceType(p) === "P") return true;
      }
    }

    // Knights
    for (const [df, dr] of KNIGHT_DELTAS) {
      const f = tf + df, r = tr + dr;
      if (inBounds(f, r)) {
        const p = board[sq(f, r)];
        if (p && pieceColor(p) === byColor && pieceType(p) === "N") return true;
      }
    }

    // King
    for (const [df, dr] of KING_DELTAS) {
      const f = tf + df, r = tr + dr;
      if (inBounds(f, r)) {
        const p = board[sq(f, r)];
        if (p && pieceColor(p) === byColor && pieceType(p) === "K") return true;
      }
    }

    // Sliding: rook/queen
    for (const [df, dr] of ROOK_DIRS) {
      let f = tf + df, r = tr + dr;
      while (inBounds(f, r)) {
        const p = board[sq(f, r)];
        if (p) {
          if (pieceColor(p) === byColor && (pieceType(p) === "R" || pieceType(p) === "Q")) return true;
          break;
        }
        f += df; r += dr;
      }
    }

    // Sliding: bishop/queen
    for (const [df, dr] of BISHOP_DIRS) {
      let f = tf + df, r = tr + dr;
      while (inBounds(f, r)) {
        const p = board[sq(f, r)];
        if (p) {
          if (pieceColor(p) === byColor && (pieceType(p) === "B" || pieceType(p) === "Q")) return true;
          break;
        }
        f += df; r += dr;
      }
    }

    return false;
  }

  findKing(color, board = this.board) {
    const k = color === "w" ? "K" : "k";
    return board.indexOf(k);
  }

  isInCheck(color, board = this.board) {
    const kingSq = this.findKing(color, board);
    if (kingSq === -1) return false;
    return this.isSquareAttacked(kingSq, color === "w" ? "b" : "w", board);
  }

  /** Pseudo-legal moves for the piece on `from`, ignoring whether the move
   * leaves the mover's own king in check. Includes castling & en passant
   * candidates. Returns move descriptors { from, to, promotion, castle, enPassant }. */
  pseudoMovesFrom(from) {
    const piece = this.board[from];
    if (!piece) return [];
    const color = pieceColor(piece);
    const type = pieceType(piece);
    const ff = fileOf(from), fr = rankOf(from);
    const moves = [];

    const addSlide = (dirs) => {
      for (const [df, dr] of dirs) {
        let f = ff + df, r = fr + dr;
        while (inBounds(f, r)) {
          const target = sq(f, r);
          const occ = this.board[target];
          if (!occ) {
            moves.push({ from, to: target });
          } else {
            if (pieceColor(occ) !== color) moves.push({ from, to: target });
            break;
          }
          f += df; r += dr;
        }
      }
    };

    if (type === "N") {
      for (const [df, dr] of KNIGHT_DELTAS) {
        const f = ff + df, r = fr + dr;
        if (!inBounds(f, r)) continue;
        const target = sq(f, r);
        const occ = this.board[target];
        if (!occ || pieceColor(occ) !== color) moves.push({ from, to: target });
      }
    } else if (type === "K") {
      for (const [df, dr] of KING_DELTAS) {
        const f = ff + df, r = fr + dr;
        if (!inBounds(f, r)) continue;
        const target = sq(f, r);
        const occ = this.board[target];
        if (!occ || pieceColor(occ) !== color) moves.push({ from, to: target });
      }
      this.addCastleMoves(from, color, moves);
    } else if (type === "R") {
      addSlide(ROOK_DIRS);
    } else if (type === "B") {
      addSlide(BISHOP_DIRS);
    } else if (type === "Q") {
      addSlide(ROOK_DIRS);
      addSlide(BISHOP_DIRS);
    } else if (type === "P") {
      const dir = color === "w" ? 1 : -1;
      const startRank = color === "w" ? 1 : 6;
      const promoRank = color === "w" ? 7 : 0;

      const oneStep = sq(ff, fr + dir);
      if (inBounds(ff, fr + dir) && !this.board[oneStep]) {
        this.pushPawnMove(moves, from, oneStep, fr + dir === promoRank);
        const twoStep = sq(ff, fr + 2 * dir);
        if (fr === startRank && !this.board[twoStep]) {
          moves.push({ from, to: twoStep, doubleStep: true });
        }
      }
      for (const df of [-1, 1]) {
        const f = ff + df, r = fr + dir;
        if (!inBounds(f, r)) continue;
        const target = sq(f, r);
        const occ = this.board[target];
        if (occ && pieceColor(occ) !== color) {
          this.pushPawnMove(moves, from, target, r === promoRank);
        } else if (!occ && this.enPassant === target) {
          moves.push({ from, to: target, enPassant: true });
        }
      }
    }

    return moves;
  }

  pushPawnMove(moves, from, to, isPromotion) {
    if (isPromotion) {
      for (const p of ["Q", "R", "B", "N"]) {
        moves.push({ from, to, promotion: p });
      }
    } else {
      moves.push({ from, to });
    }
  }

  addCastleMoves(kingSq, color, moves) {
    const rank = color === "w" ? 0 : 7;
    if (kingSq !== sq(4, rank)) return;
    const enemy = color === "w" ? "b" : "w";
    if (this.isSquareAttacked(kingSq, enemy)) return;

    const kingSideFlag = color === "w" ? "K" : "k";
    const queenSideFlag = color === "w" ? "Q" : "q";

    if (this.castling[kingSideFlag]) {
      const f = sq(5, rank), g = sq(6, rank), h = sq(7, rank);
      if (!this.board[f] && !this.board[g] && this.board[h] === (color === "w" ? "R" : "r")) {
        if (!this.isSquareAttacked(f, enemy) && !this.isSquareAttacked(g, enemy)) {
          moves.push({ from: kingSq, to: g, castle: "king" });
        }
      }
    }
    if (this.castling[queenSideFlag]) {
      const d = sq(3, rank), c = sq(2, rank), b = sq(1, rank), a = sq(0, rank);
      if (!this.board[d] && !this.board[c] && !this.board[b] && this.board[a] === (color === "w" ? "R" : "r")) {
        if (!this.isSquareAttacked(d, enemy) && !this.isSquareAttacked(c, enemy)) {
          moves.push({ from: kingSq, to: c, castle: "queen" });
        }
      }
    }
  }

  /** Simulates a move on a cloned board and returns the resulting board,
   * without mutating engine state. Used both for legality filtering and
   * for actually applying moves. */
  simulate(move, board = this.board) {
    const next = board.slice();
    const piece = next[move.from];
    const color = pieceColor(piece);

    if (move.enPassant) {
      const dir = color === "w" ? -1 : 1;
      const capturedSq = sq(fileOf(move.to), rankOf(move.to) + dir);
      next[capturedSq] = null;
    }

    next[move.to] = move.promotion ? (color === "w" ? move.promotion : move.promotion.toLowerCase()) : piece;
    next[move.from] = null;

    if (move.castle === "king") {
      const rank = rankOf(move.from);
      next[sq(5, rank)] = next[sq(7, rank)];
      next[sq(7, rank)] = null;
    } else if (move.castle === "queen") {
      const rank = rankOf(move.from);
      next[sq(3, rank)] = next[sq(0, rank)];
      next[sq(0, rank)] = null;
    }

    return next;
  }

  /** Legal moves from a square: pseudo-legal moves filtered to those that
   * do not leave the mover's own king in check. */
  legalMovesFrom(from) {
    const piece = this.board[from];
    if (!piece) return [];
    const color = pieceColor(piece);
    if (color !== this.turn) return [];

    const pseudo = this.pseudoMovesFrom(from);
    const legal = [];
    for (const move of pseudo) {
      const resulting = this.simulate(move);
      if (!this.isInCheck(color, resulting)) legal.push(move);
    }
    return legal;
  }

  /** All legal moves for `color`, used for checkmate/stalemate detection. */
  allLegalMoves(color) {
    const moves = [];
    for (let s = 0; s < 64; s++) {
      const piece = this.board[s];
      if (piece && pieceColor(piece) === color) {
        for (const m of this.legalMovesFrom(s)) moves.push(m);
      }
    }
    return moves;
  }

  /** Applies a legal move (from legalMovesFrom) to the real board and
   * updates turn/castling/en-passant/halfmove state. `promotion` (piece
   * letter, e.g. "Q") overrides the move's own promotion field if given. */
  makeMove(from, to, promotion) {
    const legal = this.legalMovesFrom(from);
    let move = legal.find((m) => m.to === to && (!m.promotion || m.promotion === promotion));
    if (!move) move = legal.find((m) => m.to === to);
    if (!move) return null;
    if (move.promotion && promotion) move = { ...move, promotion };

    const piece = this.board[from];
    const captured = move.enPassant
      ? (pieceColor(piece) === "w" ? "p" : "P")
      : this.board[to];

    this.board = this.simulate(move);

    // Castling rights
    if (pieceType(piece) === "K") {
      if (pieceColor(piece) === "w") { this.castling.K = false; this.castling.Q = false; }
      else { this.castling.k = false; this.castling.q = false; }
    }
    const clearRookRight = (square) => {
      if (square === sq(0, 0)) this.castling.Q = false;
      if (square === sq(7, 0)) this.castling.K = false;
      if (square === sq(0, 7)) this.castling.q = false;
      if (square === sq(7, 7)) this.castling.k = false;
    };
    clearRookRight(from);
    clearRookRight(to);

    // En passant target for the *next* move
    this.enPassant = move.doubleStep
      ? sq(fileOf(to), (rankOf(from) + rankOf(to)) / 2)
      : null;

    // Halfmove clock (50-move rule)
    if (pieceType(piece) === "P" || captured) this.halfmoveClock = 0;
    else this.halfmoveClock += 1;

    this.turn = this.turn === "w" ? "b" : "w";
    this.lastMove = { from, to, piece, captured: captured || null, promotion: move.promotion || null, castle: move.castle || null };

    return this.lastMove;
  }

  /** Returns { over, result, message } describing the game state for the
   * side about to move (this.turn). */
  getStatus() {
    const color = this.turn;
    const inCheck = this.isInCheck(color);
    const hasMoves = this.allLegalMoves(color).length > 0;
    const colorName = color === "w" ? "White" : "Black";
    const otherName = color === "w" ? "Black" : "White";

    if (!hasMoves && inCheck) {
      return { over: true, result: "checkmate", winner: color === "w" ? "b" : "w", message: `Checkmate! ${otherName} wins.` };
    }
    if (!hasMoves && !inCheck) {
      return { over: true, result: "stalemate", winner: null, message: "Stalemate! The game is a draw." };
    }
    if (this.halfmoveClock >= 100) {
      return { over: true, result: "draw", winner: null, message: "Draw by the 50-move rule." };
    }
    return { over: false, result: "ongoing", winner: null, message: inCheck ? `${colorName} is in check.` : "" };
  }
}
