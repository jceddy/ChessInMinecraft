import { ModalFormData, MessageFormData, ActionFormData } from "@minecraft/server-ui";
import { ChessGameManager } from "./gameManager.js";
import { squareName, pieceColor } from "./engine.js";
import { syncBoardVisuals } from "./board.js";

const PROMOTION_CHOICES = [
  { key: "Q", label: "Queen" },
  { key: "R", label: "Rook" },
  { key: "B", label: "Bishop" },
  { key: "N", label: "Knight" },
];

export function openJoinScreen(session, player) {
  const alreadyWaiting = session.isParticipant(player.id);

  if (alreadyWaiting) {
    const form = new MessageFormData()
      .title("Chess Set")
      .body("You are waiting for an opponent to join. Interact with the board again once someone else joins, or leave to free up your spot.")
      .button1("OK")
      .button2("Leave Game");
    form.show(player).then((res) => {
      if (res.canceled) return;
      if (res.selection === 1) {
        if (session.white && session.white.id === player.id) session.white = null;
        if (session.black && session.black.id === player.id) session.black = null;
        session.save();
        player.sendMessage("§7You left the chess game.");
      }
    }).catch(() => {});
    return;
  }

  const openColors = [];
  if (!session.white) openColors.push("white");
  if (!session.black) openColors.push("black");

  const form = new ActionFormData().title("Chess Set");
  let body = "";
  if (session.white) body += `White: ${session.white.name}\n`;
  if (session.black) body += `Black: ${session.black.name}\n`;
  body += "\nJoin the game:";
  form.body(body);
  for (const color of openColors) {
    form.button(color === "white" ? "Join as White" : "Join as Black");
  }

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    const color = openColors[res.selection];
    joinGame(session, player, color);
  }).catch(() => {});
}

function joinGame(session, player, color) {
  const entry = { id: player.id, name: player.name };
  if (color === "white" && !session.white) session.white = entry;
  else if (color === "black" && !session.black) session.black = entry;
  else {
    player.sendMessage("§cThat side has already been taken.");
    return;
  }

  if (session.white && session.black) {
    session.status = "active";
    session.save();
    announceGameStart(session);
  } else {
    session.save();
    player.sendMessage(`§eYou joined as ${color === "white" ? "White" : "Black"}. Waiting for an opponent...`);
  }
}

function announceGameStart(session) {
  syncBoardVisuals(session);
  for (const entry of [session.white, session.black]) {
    const p = ChessGameManager.findOnlinePlayer(entry.id);
    if (!p) continue;
    p.sendMessage("§aBoth players have joined - the game begins! White moves first. Tap a piece, then tap a highlighted square to move it. Type \"resign\" in chat to resign.");
  }
}

/** Handles a click on a specific physical square (0-63) of an active
 * game's board: select a piece, move a selected piece, cancel a
 * selection, or select a different one of your own pieces instead. */
export function handleSquareClick(session, player, squareIndex) {
  const engine = session.engine;
  const myColor = session.colorOf(player.id);

  if (!myColor) {
    player.sendMessage("§cYou are only spectating this game.");
    return;
  }
  if (engine.turn !== myColor) {
    player.sendMessage("§cIt is not your turn.");
    return;
  }

  const selection = session.selection;

  if (selection == null) {
    selectPiece(session, player, myColor, squareIndex);
    return;
  }

  if (squareIndex === selection) {
    session.selection = null;
    syncBoardVisuals(session);
    player.sendMessage("§7Selection canceled.");
    return;
  }

  const legal = engine.legalMovesFrom(selection);
  const move = legal.find((m) => m.to === squareIndex);

  if (!move) {
    const piece = engine.board[squareIndex];
    if (piece && pieceColor(piece) === myColor) {
      selectPiece(session, player, myColor, squareIndex);
      return;
    }
    player.sendMessage("§cIllegal move.");
    return;
  }

  session.selection = null;

  if (move.promotion) {
    openPromotionPrompt(session, player, selection, squareIndex);
    return;
  }

  finalizeMove(session, player, selection, squareIndex, null);
}

function selectPiece(session, player, myColor, squareIndex) {
  const engine = session.engine;
  const piece = engine.board[squareIndex];
  if (!piece || pieceColor(piece) !== myColor) {
    player.sendMessage("§cSelect one of your own pieces first.");
    return;
  }
  const moves = engine.legalMovesFrom(squareIndex);
  if (moves.length === 0) {
    player.sendMessage("§cThat piece has no legal moves.");
    return;
  }
  session.selection = squareIndex;
  syncBoardVisuals(session);
  const targets = moves.map((m) => squareName(m.to)).join(", ");
  player.sendMessage(`§eSelected ${squareName(squareIndex)}. Legal moves: ${targets}`);
}

function openPromotionPrompt(session, player, from, to) {
  const form = new ModalFormData()
    .title("Pawn Promotion")
    .dropdown("Choose a piece for your pawn to become:", PROMOTION_CHOICES.map((c) => c.label), 0);

  form.show(player).then((response) => {
    if (response.canceled) {
      // Leave the move unresolved; the player can tap the pawn again to retry.
      return;
    }
    const choice = PROMOTION_CHOICES[response.formValues[0]];
    finalizeMove(session, player, from, to, choice.key);
  }).catch(() => {});
}

function finalizeMove(session, player, from, to, promotion) {
  const engine = session.engine;
  const move = engine.makeMove(from, to, promotion);
  if (!move) {
    player.sendMessage("§cThat move is no longer legal.");
    return;
  }

  const status = engine.getStatus();
  if (status.over) {
    session.status = "finished";
    session.result = status;
  }
  session.save();
  syncBoardVisuals(session);
  broadcastMove(session, player, move, status);
}

function broadcastMove(session, mover, move, status) {
  const moveText = `${squareName(move.from)} to ${squareName(move.to)}`;
  for (const entry of [session.white, session.black]) {
    if (!entry) continue;
    const p = ChessGameManager.findOnlinePlayer(entry.id);
    if (!p) continue;

    if (status.over) {
      p.sendMessage(`§6${status.message}`);
      continue;
    }

    if (entry.id === mover.id) {
      p.sendMessage(`§7You played ${moveText}.`);
    } else {
      p.sendMessage(`§e${mover.name} played ${moveText}. Your turn!`);
    }
  }
}

/** Resigns `player` from their game immediately (no confirmation dialog -
 * this is invoked from a chat command, see main.js). */
export function resign(session, player) {
  const myColor = session.colorOf(player.id);
  const winnerColor = myColor === "w" ? "b" : "w";
  const winnerName = winnerColor === "w" ? session.white.name : session.black.name;
  session.status = "finished";
  session.selection = null;
  session.result = {
    over: true,
    result: "resignation",
    winner: winnerColor,
    message: `${player.name} resigned. ${winnerName} wins!`,
  };
  session.save();
  syncBoardVisuals(session);

  for (const entry of [session.white, session.black]) {
    if (!entry) continue;
    const p = ChessGameManager.findOnlinePlayer(entry.id);
    if (!p) continue;
    p.sendMessage(`§6${session.result.message}`);
  }
}

export function openResultScreen(session, player) {
  const message = session.result ? session.result.message : "The game has ended.";
  const isParticipant = session.isParticipant(player.id);

  const form = new MessageFormData()
    .title("Chess - Game Over")
    .body(`${message}\n\nWhite: ${session.white ? session.white.name : "-"}\nBlack: ${session.black ? session.black.name : "-"}`)
    .button1("Close")
    .button2(isParticipant ? "Start New Game" : "OK");

  form.show(player).then((res) => {
    if (res.canceled) return;
    if (res.selection === 1 && isParticipant) {
      session.resetToWaiting();
      syncBoardVisuals(session);
      player.sendMessage("§aThe board has been reset. Interact with it to start a new game.");
    }
  }).catch(() => {});
}

/** Entry point for interacting with any square/piece block of a board
 * that isn't currently mid-game (waiting for players, or finished). */
export function handleBlockInteract(session, player) {
  if (session.status === "waiting") {
    openJoinScreen(session, player);
  } else {
    openResultScreen(session, player);
  }
}
