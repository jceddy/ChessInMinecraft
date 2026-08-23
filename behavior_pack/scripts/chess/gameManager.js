import { world } from "@minecraft/server";
import { ChessEngine } from "./engine.js";

/** Builds a stable key identifying a chess board by its dimension + block
 * location, so the same session is reused for repeated interactions with
 * the same physical block. */
function keyFor(dimensionId, location) {
  const { x, y, z } = location;
  const dim = dimensionId.replace(/^minecraft:/, "");
  return `${dim}_${x}_${y}_${z}`;
}

function dynamicPropertyId(key) {
  // Dynamic property ids max out at 64 chars; keep this short and unique.
  return `chess:${key}`;
}

export class ChessSession {
  constructor(dimensionId, location) {
    this.dimensionId = dimensionId;
    this.location = { x: location.x, y: location.y, z: location.z };
    this.key = keyFor(dimensionId, location);
    this.white = null; // { id, name }
    this.black = null; // { id, name }
    this.status = "waiting"; // "waiting" | "active" | "finished"
    this.result = null; // status object from engine.getStatus(), or resign info
    this.engine = new ChessEngine();
    this.selections = new Map(); // playerId -> selected square index (not persisted)
    this.load();
  }

  isParticipant(playerId) {
    return (this.white && this.white.id === playerId) || (this.black && this.black.id === playerId);
  }

  colorOf(playerId) {
    if (this.white && this.white.id === playerId) return "w";
    if (this.black && this.black.id === playerId) return "b";
    return null;
  }

  opponentEntry(playerId) {
    if (this.white && this.white.id === playerId) return this.black;
    if (this.black && this.black.id === playerId) return this.white;
    return null;
  }

  save() {
    const data = {
      white: this.white,
      black: this.black,
      status: this.status,
      result: this.result,
      engine: this.engine.serialize(),
    };
    try {
      world.setDynamicProperty(dynamicPropertyId(this.key), JSON.stringify(data));
    } catch (err) {
      console.warn(`[chess] failed to save game ${this.key}: ${err}`);
    }
  }

  load() {
    let raw;
    try {
      raw = world.getDynamicProperty(dynamicPropertyId(this.key));
    } catch (err) {
      return;
    }
    if (typeof raw !== "string" || raw.length === 0) return;
    try {
      const data = JSON.parse(raw);
      this.white = data.white ?? null;
      this.black = data.black ?? null;
      this.status = data.status ?? "waiting";
      this.result = data.result ?? null;
      if (data.engine) this.engine.deserialize(data.engine);
    } catch (err) {
      console.warn(`[chess] failed to load game ${this.key}: ${err}`);
    }
  }

  resetToWaiting() {
    this.white = null;
    this.black = null;
    this.status = "waiting";
    this.result = null;
    this.engine = new ChessEngine();
    this.selections.clear();
    this.save();
  }
}

const sessions = new Map();

export const ChessGameManager = {
  /** Gets (or lazily creates + loads) the session for the block a player
   * just interacted with. */
  getSession(block) {
    const key = keyFor(block.dimension.id, block.location);
    let session = sessions.get(key);
    if (!session) {
      session = new ChessSession(block.dimension.id, block.location);
      sessions.set(key, session);
    }
    return session;
  },

  findOnlinePlayer(playerId) {
    for (const p of world.getAllPlayers()) {
      if (p.id === playerId) return p;
    }
    return null;
  },

  /** Finds the active game session (if any) that `playerId` is currently
   * playing in, e.g. to resolve a "resign" chat command to the right
   * board without requiring the player to be looking at it. */
  findActiveSessionForPlayer(playerId) {
    for (const session of sessions.values()) {
      if (session.status === "active" && session.isParticipant(playerId)) return session;
    }
    return null;
  },
};
