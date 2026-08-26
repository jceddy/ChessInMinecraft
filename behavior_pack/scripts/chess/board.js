import { world } from "@minecraft/server";

const REGISTRY_PROPERTY = "chess:board_registry";
const BOARD_SIZE = 8;

const SQUARE_LIGHT = "chess:square_light";
const SQUARE_DARK = "chess:square_dark";
const SQUARE_HIGHLIGHT = "chess:square_highlight";

const PIECE_BLOCK_IDS = {
  P: "chess:piece_white_pawn", N: "chess:piece_white_knight", B: "chess:piece_white_bishop",
  R: "chess:piece_white_rook", Q: "chess:piece_white_queen", K: "chess:piece_white_king",
  p: "chess:piece_black_pawn", n: "chess:piece_black_knight", b: "chess:piece_black_bishop",
  r: "chess:piece_black_rook", q: "chess:piece_black_queen", k: "chess:piece_black_king",
};

function anchorKey(dimensionId, origin) {
  const dim = dimensionId.replace(/^minecraft:/, "");
  return `${dim}_${origin.x}_${origin.y}_${origin.z}`;
}

function loadRegistry() {
  let raw;
  try {
    raw = world.getDynamicProperty(REGISTRY_PROPERTY);
  } catch (err) {
    return [];
  }
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
}

function saveRegistry(entries) {
  world.setDynamicProperty(REGISTRY_PROPERTY, JSON.stringify(entries));
}

function registerAnchor(dimensionId, origin) {
  const entries = loadRegistry();
  const key = anchorKey(dimensionId, origin);
  if (entries.some((e) => anchorKey(e.dimensionId, e) === key)) return;
  entries.push({ dimensionId, x: origin.x, y: origin.y, z: origin.z });
  saveRegistry(entries);
}

// blockKey -> timestamp (ms) the board containing it was (re)built. Used to
// ignore a spurious interact the placement click itself can trigger, the
// same class of bug fixed for the old single-block design - scoped here to
// every square/piece block belonging to a just-built board, not just the
// anchor, since interaction is now dispatched through many block types.
const recentlyBuilt = new Map();
const BUILD_SUPPRESS_MS = 750;

export function wasJustBuilt(anchor) {
  const t = recentlyBuilt.get(anchorKey(anchor.dimensionId, anchor));
  if (t === undefined) return false;
  if (Date.now() - t < BUILD_SUPPRESS_MS) return true;
  recentlyBuilt.delete(anchorKey(anchor.dimensionId, anchor));
  return false;
}

/** Builds a fresh 8x8 board of square blocks starting at `anchorBlock`'s
 * location (files run +X, ranks run +Z), clearing any pieces above them,
 * and registers the board so future interactions with any of its squares
 * or pieces can be resolved back to it. */
export function buildBoard(anchorBlock) {
  const dimension = anchorBlock.dimension;
  const origin = { x: anchorBlock.location.x, y: anchorBlock.location.y, z: anchorBlock.location.z };

  for (let rank = 0; rank < BOARD_SIZE; rank++) {
    for (let file = 0; file < BOARD_SIZE; file++) {
      const isLight = (file + rank) % 2 === 1;
      const squareLoc = { x: origin.x + file, y: origin.y, z: origin.z + rank };
      dimension.getBlock(squareLoc).setType(isLight ? SQUARE_LIGHT : SQUARE_DARK);
      dimension.getBlock({ x: squareLoc.x, y: squareLoc.y + 1, z: squareLoc.z }).setType("minecraft:air");
    }
  }

  registerAnchor(dimension.id, origin);
  recentlyBuilt.set(anchorKey(dimension.id, origin), Date.now());

  return { dimensionId: dimension.id, ...origin };
}

/** Given any interacted block, finds the chess board it belongs to (if
 * any) and which square index (0-63) it represents. Returns null if the
 * block isn't part of a registered board. */
export function resolveSquare(block) {
  const entries = loadRegistry();
  for (const anchor of entries) {
    if (block.dimension.id !== anchor.dimensionId) continue;
    const dx = block.location.x - anchor.x;
    const dz = block.location.z - anchor.z;
    const dy = block.location.y - anchor.y;
    if (dx < 0 || dx >= BOARD_SIZE || dz < 0 || dz >= BOARD_SIZE) continue;
    if (dy !== 0 && dy !== 1) continue;
    return { anchor, squareIndex: dz * BOARD_SIZE + dx };
  }
  return null;
}

/** Redraws every square and piece block of `session`'s board to match its
 * engine state, highlighting the current selection and its legal
 * destinations if any. Always redraws all 64 squares rather than diffing,
 * to stay simple and avoid incremental-update bugs. */
export function syncBoardVisuals(session) {
  const dimension = world.getDimension(session.dimensionId);
  const origin = session.origin;
  const engine = session.engine;
  const highlighted = new Set();
  if (session.selection != null) {
    highlighted.add(session.selection);
    for (const move of engine.legalMovesFrom(session.selection)) highlighted.add(move.to);
  }

  for (let sq = 0; sq < 64; sq++) {
    const file = sq % BOARD_SIZE;
    const rank = Math.floor(sq / BOARD_SIZE);
    const squareLoc = { x: origin.x + file, y: origin.y, z: origin.z + rank };
    const isLight = (file + rank) % 2 === 1;
    const squareType = highlighted.has(sq) ? SQUARE_HIGHLIGHT : (isLight ? SQUARE_LIGHT : SQUARE_DARK);
    dimension.getBlock(squareLoc).setType(squareType);

    const piece = engine.board[sq];
    const pieceLoc = { x: squareLoc.x, y: squareLoc.y + 1, z: squareLoc.z };
    dimension.getBlock(pieceLoc).setType(piece ? PIECE_BLOCK_IDS[piece] : "minecraft:air");
  }
}

export function pieceBlockId(piece) {
  return PIECE_BLOCK_IDS[piece];
}
