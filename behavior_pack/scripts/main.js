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
console.warn("[chess] main.js loaded (v1.0.9)");

// blockKey -> Date.now() at placement. Populated by the optional
// playerPlaceBlock handler further down; read here to ignore the interact
// that a placement click itself can trigger for the block that just
// appeared, so the UI doesn't pop open on placement instead of a later,
// deliberate interaction.
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

// Interaction is handled by a block-scoped custom component bound directly
// to chess:chess_set via "minecraft:custom_components" in its block JSON,
// rather than the global world.afterEvents.playerInteractWithBlock event.
// Diagnostic testing (see the 1.0.6-1.0.8 history) showed the global event
// never fired for this custom block prior to 1.0.8, so both were kept
// registered as a belt-and-suspenders measure - but with the custom
// component confirmed working, the global event has started firing for
// this block too (likely a side effect of the format_version/
// min_engine_version bump or the custom_components declaration itself),
// and having both active opened the UI twice per click. Only this one
// path is registered now.
try {
  world.beforeEvents.worldInitialize.subscribe((initEvent) => {
    initEvent.blockComponentRegistry.registerCustomComponent("chess:interact", {
      onPlayerInteract(event) {
        onChessBlockInteract(event.block, event.player);
      },
    });
  });
} catch (err) {
  console.warn(`[chess] failed to register chess:interact block custom component: ${err}`);
}

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
