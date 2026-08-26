import { world } from "@minecraft/server";
import { ChessEngine } from "./engine.js";

function anchorKey(dimensionId, origin) {
  const dim = dimensionId.replace(/^minecraft:/, "");
  return `${dim}_${origin.x}_${origin.y}_${origin.z}`;
}

function dynamicPropertyId(key) {
  return `chess:${key}`;
}

export class ChessSession {
  constructor(dimensionId, origin) {
    this.dimensionId = dimensionId;
    this.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.key = anchorKey(dimensionId, origin);
    this.white = null; // { id, name }
    this.black = null; // { id, name }
    this.status = "waiting"; // "waiting" | "active" | "finished"
    this.result = null;
    this.engine = new ChessEngine();
    // A physical board has one shared selection, not one per viewer - only
    // the player whose turn it is can meaningfully select a piece anyway.
    this.selection = null; // square index (0-63) or null, not persisted
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
    this.selection = null;
    this.save();
  }
}

const sessions = new Map();

export const ChessGameManager = {
  /** Gets (or lazily creates + loads) the session for a board, identified
   * by its anchor location (the corner square at file a, rank 1). */
  getSession(dimensionId, origin) {
    const key = anchorKey(dimensionId, origin);
    let session = sessions.get(key);
    if (!session) {
      session = new ChessSession(dimensionId, origin);
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

  findActiveSessionForPlayer(playerId) {
    for (const session of sessions.values()) {
      if (session.status === "active" && session.isParticipant(playerId)) return session;
    }
    return null;
  },
};
