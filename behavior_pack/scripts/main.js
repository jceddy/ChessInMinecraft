import { world, system } from "@minecraft/server";
import { ChessGameManager } from "./chess/gameManager.js";
import { handleBlockInteract, handleSquareClick, resign } from "./chess/ui.js";
import { buildBoard, resolveSquare, wasJustBuilt } from "./chess/board.js";

const CHESS_ANCHOR_BLOCK_ID = "chess:chess_set";
const RESIGN_KEYWORD = "resign";

console.warn("[chess] main.js loaded (v2.0.0)");

function onChessInteract(block, player) {
  const resolved = resolveSquare(block);
  if (!resolved) return;
  if (wasJustBuilt(resolved.anchor)) return;

  const session = ChessGameManager.getSession(resolved.anchor.dimensionId, resolved.anchor);
  try {
    if (session.status === "active") {
      handleSquareClick(session, player, resolved.squareIndex);
    } else {
      handleBlockInteract(session, player);
    }
  } catch (err) {
    console.warn(`[chess] error handling interaction: ${err}`);
    player.sendMessage("§cSomething went wrong. Please try again.");
  }
}

// Every square and piece block declares "chess:interact" in its
// minecraft:custom_components (see behavior_pack/blocks/chess_*.json).
// This block-scoped registration is the confirmed-working mechanism for
// interacting with script-driven custom blocks in this environment - a
// global world.afterEvents.playerInteractWithBlock listener was tried
// first and never fired for a custom block here, regardless of its
// collision box shape (see the 1.0.6-1.0.8 history for how this was
// pinned down). Registered first and unconditionally, since it's the one
// registration the whole add-on depends on.
world.beforeEvents.worldInitialize.subscribe((initEvent) => {
  initEvent.blockComponentRegistry.registerCustomComponent("chess:interact", {
    onPlayerInteract(event) {
      onChessInteract(event.block, event.player);
    },
  });
});

// Placing the chess set item builds the 8x8 physical board (see
// board.js): files run +X, ranks run +Z from the placed block, which
// becomes the a1 corner. This relies on the global playerPlaceBlock
// event, which - unlike playerInteractWithBlock - has fired reliably for
// this custom block since it was first added; wrapped in try/catch
// anyway per this project's established pattern of never letting an
// optional registration's failure take down anything else.
try {
  if (world.afterEvents?.playerPlaceBlock?.subscribe) {
    world.afterEvents.playerPlaceBlock.subscribe((event) => {
      const { block } = event;
      if (!block || block.typeId !== CHESS_ANCHOR_BLOCK_ID) return;
      buildBoard(block);
    });
  } else {
    console.warn("[chess] no playerPlaceBlock event available in this Script API version; placing the chess set will not build a board.");
  }
} catch (err) {
  console.warn(`[chess] failed to register playerPlaceBlock handler: ${err}`);
}

// Resigning is a typed chat command: the physical board has no room for a
// "Resign" button of its own. Optional and wrapped in try/catch, since a
// missing or throwing chatSend event must disable only the resign
// command, never anything else.
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
