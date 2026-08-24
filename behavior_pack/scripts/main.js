import { world, system } from "@minecraft/server";
import { ChessGameManager } from "./chess/gameManager.js";
import { handleBlockInteract, resign } from "./chess/ui.js";

const CHESS_BLOCK_ID = "chess:chess_set";
const RESIGN_KEYWORD = "resign";

world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  const { block, player } = event;
  if (!block || block.typeId !== CHESS_BLOCK_ID) return;

  const session = ChessGameManager.getSession(block);
  try {
    handleBlockInteract(session, player);
  } catch (err) {
    console.warn(`[chess] error handling interaction: ${err}`);
    player.sendMessage("§cSomething went wrong opening the chess game. Please try again.");
  }
});

// Resigning is a typed chat command rather than a board button: the board
// UI is now exactly 64 buttons (one per square) so the resource pack can
// render it as an 8x8 grid, leaving no room for extra action buttons.
//
// world.beforeEvents.chatSend isn't present on every Script API version
// this pack might load against, and a missing/renamed event here must not
// crash the whole script (it previously did: "cannot read property
// 'subscribe' of undefined"), which would also take the block-interact
// handler above down with it. Feature-detect instead of assuming, and
// fall back to the non-cancelable afterEvents.chatSend (the resign
// message stays visible in chat, which is a minor cosmetic wart, not a
// functional problem) if the cancelable beforeEvent isn't available.
function handleResignChat(event) {
  if (event.message.trim().toLowerCase() !== RESIGN_KEYWORD) return;
  const session = ChessGameManager.findActiveSessionForPlayer(event.sender.id);
  if (!session) return;

  if ("cancel" in event) event.cancel = true;
  system.run(() => resign(session, event.sender));
}

if (world.beforeEvents?.chatSend?.subscribe) {
  world.beforeEvents.chatSend.subscribe(handleResignChat);
} else if (world.afterEvents?.chatSend?.subscribe) {
  world.afterEvents.chatSend.subscribe(handleResignChat);
} else {
  console.warn("[chess] no chatSend event available in this Script API version; the \"resign\" chat command is disabled.");
}
