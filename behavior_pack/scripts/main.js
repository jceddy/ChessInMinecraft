import { world } from "@minecraft/server";
import { ChessGameManager } from "./chess/gameManager.js";
import { handleBlockInteract } from "./chess/ui.js";

const CHESS_BLOCK_ID = "chess:chess_set";

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
