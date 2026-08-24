import { world, system } from "@minecraft/server";
import { ChessGameManager } from "./chess/gameManager.js";
import { handleBlockInteract, resign } from "./chess/ui.js";

const CHESS_BLOCK_ID = "chess:chess_set";
const RESIGN_KEYWORD = "resign";
const PLACEMENT_SUPPRESS_MS = 750;

function blockKey(block) {
  const { x, y, z } = block.location;
  return `${block.dimension.id}_${x}_${y}_${z}`;
}

// Announced unconditionally, before anything that could fail below, so a
// content-log check can always confirm which build actually loaded.
console.warn("[chess] main.js loaded (v1.0.7, with diagnostic interact logging)");

// blockKey -> Date.now() at placement. Populated by the optional
// playerPlaceBlock handler further down; read here to ignore the interact
// event the placement click itself can trigger for the block that just
// appeared, so the UI doesn't pop open on placement instead of a later,
// deliberate interaction.
const recentlyPlaced = new Map();

// This is the one subscription the whole add-on depends on, so it is
// registered first and unconditionally, before any other feature-detection
// below. Past bugs on this exact install (the chatSend crash, and very
// likely this one) came from merely *accessing* an event property that
// isn't supported in this Script API version - which can throw instead of
// evaluating to undefined, and optional chaining does not protect against
// a throwing property access, only against a null/undefined base. A throw
// at the top level of this file aborts every statement after it, so
// anything that isn't guaranteed-safe must come after this registration
// and be wrapped in its own try/catch, never before it.
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  const { block, player } = event;

  // TEMPORARY DIAGNOSTIC (remove once interaction is confirmed working):
  // logs every block interaction in the world, before any filtering, so a
  // content-log check can show definitively whether this event fires at
  // all in this game version, and if so, exactly what typeId it reports
  // for the chess set block - rather than guessing at a sixth fix blind.
  console.warn(`[chess][diag] playerInteractWithBlock fired: typeId=${block ? block.typeId : "<no block>"} player=${player ? player.name : "<no player>"}`);

  if (!block || block.typeId !== CHESS_BLOCK_ID) return;

  const key = blockKey(block);
  const placedAt = recentlyPlaced.get(key);
  if (placedAt !== undefined) {
    if (Date.now() - placedAt < PLACEMENT_SUPPRESS_MS) return;
    recentlyPlaced.delete(key);
  }

  const session = ChessGameManager.getSession(block);
  try {
    handleBlockInteract(session, player);
  } catch (err) {
    console.warn(`[chess] error handling interaction: ${err}`);
    player.sendMessage("§cSomething went wrong opening the chess game. Please try again.");
  }
});

// Suppresses the placement-triggered interact (see recentlyPlaced above).
// Entries are cleared by elapsed wall-clock time at read-time, not a
// scheduled system.runTimeout callback (an earlier version relied on one,
// but if it never fires the block would be permanently unresponsive
// instead - see the 1.0.4 fix). Optional and wrapped in try/catch: if this
// event isn't available or accessing it throws, the block's UI may briefly
// open on placement, but interaction itself - registered above - keeps
// working regardless.
try {
  if (world.afterEvents?.playerPlaceBlock?.subscribe) {
    world.afterEvents.playerPlaceBlock.subscribe((event) => {
      const { block } = event;
      if (!block || block.typeId !== CHESS_BLOCK_ID) return;
      recentlyPlaced.set(blockKey(block), Date.now());
    });
  } else {
    console.warn("[chess] no playerPlaceBlock event available in this Script API version; the block's UI may briefly open on placement.");
  }
} catch (err) {
  console.warn(`[chess] failed to register playerPlaceBlock handler: ${err}`);
}

// Resigning is a typed chat command rather than a board button: the board
// UI is now exactly 64 buttons (one per square) so the resource pack can
// render it as an 8x8 grid, leaving no room for extra action buttons.
// Optional and wrapped the same way as playerPlaceBlock above, for the
// same reason: a missing or throwing chatSend event must disable only the
// resign command, never the block-interact handler above it.
function handleResignChat(event) {
  if (event.message.trim().toLowerCase() !== RESIGN_KEYWORD) return;
  const session = ChessGameManager.findActiveSessionForPlayer(event.sender.id);
  if (!session) return;

  if ("cancel" in event) event.cancel = true;
  system.run(() => resign(session, event.sender));
}

try {
  if (world.beforeEvents?.chatSend?.subscribe) {
    world.beforeEvents.chatSend.subscribe(handleResignChat);
  } else if (world.afterEvents?.chatSend?.subscribe) {
    world.afterEvents.chatSend.subscribe(handleResignChat);
  } else {
    console.warn("[chess] no chatSend event available in this Script API version; the \"resign\" chat command is disabled.");
  }
} catch (err) {
  console.warn(`[chess] failed to register chat resign handler: ${err}`);
}
