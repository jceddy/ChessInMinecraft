import { system } from "@minecraft/server";
import { ActionFormData, ModalFormData, MessageFormData } from "@minecraft/server-ui";
import { ChessGameManager } from "./gameManager.js";
import { squareName, pieceColor, PIECE_GLYPHS } from "./engine.js";

const PROMOTION_CHOICES = [
  { key: "Q", label: "Queen" },
  { key: "R", label: "Rook" },
  { key: "B", label: "Bishop" },
  { key: "N", label: "Knight" },
];

/** Entry point called from main.js whenever a player interacts with a
 * chess set block. */
export function handleBlockInteract(session, player) {
  if (session.status === "waiting") {
    openJoinScreen(session, player);
  } else if (session.status === "active") {
    openBoard(session, player);
  } else {
    openResultScreen(session, player);
  }
}

function openJoinScreen(session, player) {
  const alreadyWaiting = session.isParticipant(player.id);

  if (alreadyWaiting) {
    const form = new MessageFormData()
      .title("Chess Set")
      .body("You are waiting for an opponent to join. Interact with the chess set again once someone else joins, or leave to free up your spot.")
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
  for (const entry of [session.white, session.black]) {
    const p = ChessGameManager.findOnlinePlayer(entry.id);
    if (!p) continue;
    p.sendMessage("§aBoth players have joined - the game begins! White moves first.");
    system.run(() => openBoard(session, p));
  }
}

const DISPLAY_ORDER = (() => {
  const order = [];
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++) order.push(rank * 8 + file);
  }
  return order;
})();

/** Compact label for a single grid cell: the board's visual layout (a
 * literal 8x8 grid, see resource_pack/ui/server_form.json) already conveys
 * which square is which by position, so cells only need a piece glyph plus
 * a color cue for selection/legal-move state - not the full square name. */
function renderSquareLabel(engine, sqIndex, selection, legalTargets) {
  const piece = engine.board[sqIndex];
  const isSelected = selection === sqIndex;
  const isTarget = legalTargets.includes(sqIndex);
  const glyph = piece ? PIECE_GLYPHS[piece] : isTarget ? "•" : " ";
  const colorCode = isSelected ? "§e" : isTarget ? "§a" : piece ? (pieceColor(piece) === "w" ? "§f" : "§7") : "§8";
  return `${colorCode}${glyph}`;
}

export function openBoard(session, player) {
  const engine = session.engine;
  const myColor = session.colorOf(player.id);
  const selection = myColor ? session.selections.get(player.id) ?? null : null;
  const legalTargets = selection != null ? engine.legalMovesFrom(selection).map((m) => m.to) : [];

  const turnColor = engine.turn === "w" ? "White" : "Black";
  const inCheck = engine.isInCheck(engine.turn);
  const form = new ActionFormData().title(`Chess - ${turnColor} to move${inCheck ? " (Check!)" : ""}`);

  let body = `White: ${session.white ? session.white.name : "-"}   Black: ${session.black ? session.black.name : "-"}\n`;
  body += "Board reads rank 8 at top, a-h left to right - like looking at it from White's side.\n";
  if (engine.lastMove) {
    body += `Last move: ${squareName(engine.lastMove.from)} to ${squareName(engine.lastMove.to)}\n`;
  }
  if (!myColor) {
    body += "\nYou are spectating this game.";
  } else if (engine.turn !== myColor) {
    body += "\nWaiting for your opponent's move...";
  } else if (selection == null) {
    body += "\nTap one of your pieces to select it.";
  } else {
    body += "\nTap a highlighted square to move there, or tap the selected piece again to cancel.";
  }
  if (myColor && session.status === "active") {
    body += "\nType \"resign\" in chat to resign.";
  }
  form.body(body);

  // Exactly 64 buttons, one per square in DISPLAY_ORDER - the resource
  // pack's server_form.json override renders a form with exactly this many
  // buttons as an 8x8 grid instead of a vertical list. Keep this list free
  // of any extra (non-square) buttons or the grid layout breaks.
  const actions = DISPLAY_ORDER.map((sq) => ({ type: "square", sq }));
  for (const sqIndex of DISPLAY_ORDER) {
    form.button(renderSquareLabel(engine, sqIndex, selection, legalTargets));
  }

  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) return;
    const action = actions[response.selection];
    if (!action) return;
    handleSquareTap(session, player, myColor, selection, action.sq);
  }).catch(() => {});
}

function handleSquareTap(session, player, myColor, selection, sqIndex) {
  const engine = session.engine;

  if (!myColor) {
    player.sendMessage("§cYou are only spectating this game.");
    return openBoard(session, player);
  }
  if (engine.turn !== myColor) {
    player.sendMessage("§cIt is not your turn.");
    return openBoard(session, player);
  }

  if (selection == null) {
    const piece = engine.board[sqIndex];
    if (!piece || pieceColor(piece) !== myColor) {
      player.sendMessage("§cSelect one of your own pieces first.");
      return openBoard(session, player);
    }
    if (engine.legalMovesFrom(sqIndex).length === 0) {
      player.sendMessage("§cThat piece has no legal moves.");
      return openBoard(session, player);
    }
    session.selections.set(player.id, sqIndex);
    return openBoard(session, player);
  }

  if (sqIndex === selection) {
    session.selections.delete(player.id);
    return openBoard(session, player);
  }

  const legal = engine.legalMovesFrom(selection);
  const move = legal.find((m) => m.to === sqIndex);

  if (!move) {
    const piece = engine.board[sqIndex];
    if (piece && pieceColor(piece) === myColor && engine.legalMovesFrom(sqIndex).length > 0) {
      session.selections.set(player.id, sqIndex);
      return openBoard(session, player);
    }
    player.sendMessage("§cIllegal move.");
    return openBoard(session, player);
  }

  session.selections.delete(player.id);

  if (move.promotion) {
    return openPromotionPrompt(session, player, selection, sqIndex);
  }

  finalizeMove(session, player, selection, sqIndex, null);
}

function openPromotionPrompt(session, player, from, to) {
  const form = new ModalFormData()
    .title("Pawn Promotion")
    .dropdown("Choose a piece for your pawn to become:", PROMOTION_CHOICES.map((c) => c.label), 0);

  form.show(player).then((response) => {
    if (response.canceled) {
      // Leave the move unresolved; reopen the board so the player can retry.
      return openBoard(session, player);
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
    return openBoard(session, player);
  }

  const status = engine.getStatus();
  if (status.over) {
    session.status = "finished";
    session.result = status;
  }
  session.save();
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
      system.run(() => openResultScreen(session, p));
      continue;
    }

    if (entry.id === mover.id) {
      p.sendMessage(`§7You played ${moveText}.`);
    } else {
      p.sendMessage(`§e${mover.name} played ${moveText}. Your turn!`);
      system.run(() => openBoard(session, p));
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
  session.result = {
    over: true,
    result: "resignation",
    winner: winnerColor,
    message: `${player.name} resigned. ${winnerName} wins!`,
  };
  session.save();

  for (const entry of [session.white, session.black]) {
    if (!entry) continue;
    const p = ChessGameManager.findOnlinePlayer(entry.id);
    if (!p) continue;
    p.sendMessage(`§6${session.result.message}`);
    system.run(() => openResultScreen(session, p));
  }
}

function openResultScreen(session, player) {
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
      player.sendMessage("§aThe board has been reset. Interact with it to start a new game.");
    }
  }).catch(() => {});
}
