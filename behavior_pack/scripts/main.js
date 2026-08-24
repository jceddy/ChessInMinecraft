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
console.warn("[chess] main.js loaded (v1.0.8, with block custom component interaction)");

// blockKey -> Date.now() at placement. Populated by the optional
// playerPlaceBlock handler further down; read here to ignore the interact
// that a placement click itself can trigger for the block that just
// appeared, so the UI doesn't pop open on placement instead of a later,
// deliberate interaction. Shared by both interaction paths below.
const recentlyPlaced = new Map();

function onChessBlockInteract(block, player) {
  if (!block || !player) return;

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
}

// Primary interaction path: a block-scoped custom component bound directly
// to chess:chess_set via "minecraft:custom_components" in its block JSON.
// Diagnostic logging (kept below) proved that the global
// world.afterEvents.playerInteractWithBlock event - which fires reliably
// for every vanilla block tested (crafting table, furnace, grass block),
// identically right-clicked, even after ruling out a stale block instance
// and a non-default collision box - never once fired for this custom
// block. This is the documented mechanism for script-driven custom blocks
// (see https://github.com/MicrosoftDocs/minecraft-creator, "Building with
// Custom Components"), registered separately per block rather than
// through a world-wide listener.
try {
  world.beforeEvents.worldInitialize.subscribe((initEvent) => {
    initEvent.blockComponentRegistry.registerCustomComponent("chess:interact", {
      onPlayerInteract(event) {
        // TEMPORARY DIAGNOSTIC (remove once interaction is confirmed
        // working): confirms this registration path is actually reached.
        console.warn(`[chess][diag] custom component onPlayerInteract fired: typeId=${event.block ? event.block.typeId : "<no block>"} player=${event.player ? event.player.name : "<no player>"}`);
        onChessBlockInteract(event.block, event.player);
      },
    });
  });
} catch (err) {
  console.warn(`[chess] failed to register chess:interact block custom component: ${err}`);
}

// Kept registered as a harmless fallback/diagnostic: this is the event
// that reliably fires for every vanilla block but has not been observed
// to fire for chess:chess_set on this install (see comment above). If a
// future game version does route interaction through it for custom
// blocks too, this still works correctly via the same shared handler.
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  const { block, player } = event;
  console.warn(`[chess][diag] playerInteractWithBlock fired: typeId=${block ? block.typeId : "<no block>"} player=${player ? player.name : "<no player>"}`);
  if (!block || block.typeId !== CHESS_BLOCK_ID) return;
  onChessBlockInteract(block, player);
});

// Suppresses the placement-triggered interact (see recentlyPlaced above).
// Entries are cleared by elapsed wall-clock time at read-time, not a
// scheduled system.runTimeout callback (an earlier version relied on one,
// but if it never fires the block would be permanently unresponsive
// instead - see the 1.0.4 fix). Optional and wrapped in try/catch: if this
// event isn't available or accessing it throws, the block's UI may briefly
// open on placement, but interaction itself keeps working regardless.
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
// resign command, never anything else.
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
