# ChessInMinecraft

Chess in Minecraft (Bedrock) ♟️

A Minecraft Bedrock add-on that adds a **Chess Set** block. Interact with it
to play a full game of chess against another player, right from a Minecraft
UI. No experimental toggles are required.

## Features

- **Chess Set block** — placeable decorative table block with a checkered
  top, added by the resource pack + behavior pack together.
- **Two-player matchmaking** — the first player to interact joins as White
  or Black; the game begins automatically once a second player joins the
  other side.
- **Full chess rules**, implemented from scratch in `behavior_pack/scripts/chess/engine.js`:
  - legal move generation for every piece, including pins (a move that
    leaves your own king in check is rejected)
  - castling (king-side and queen-side, with all the usual rights/attacked
    square checks)
  - en passant
  - pawn promotion (choose Queen, Rook, Bishop, or Knight)
  - check, checkmate, stalemate, and the 50-move draw rule
  - resigning
- **Persistent games** — each board's state is saved to a world dynamic
  property, so games survive server restarts and chunk unloads.
- **Spectating** — anyone else who interacts with an in-progress board can
  watch it, read-only.

## How it works in-game

1. Place a Chess Set block.
2. A player right-clicks it and joins as White or Black.
3. A second player right-clicks it and joins the other color — the game
   starts immediately, and both players are shown the board.
4. On your turn, tap a piece to select it (legal destinations are marked
   with `•`), then tap a destination square to move. Tap your own piece
   again to cancel a selection.
5. When the game ends (checkmate, stalemate, draw, or resignation), either
   player can start a new game from the same block.

### About the board UI

Minecraft Bedrock's scripting API can only build UI out of `ActionFormData`
buttons, which render as a **vertical list**, not a graphical grid — there's
no way to draw a real 8x8 board without experimental custom UI features.
So the board is shown as a scrollable list of all 64 squares (rank 8 down
to rank 1, files a-h), each labeled with its coordinate and piece, e.g.
`▶ e2: ♙ Pawn (White)`. It's fully playable, just not visually a chessboard.

## Project layout

```
behavior_pack/
  manifest.json
  blocks/chess_set.json          # block definition
  scripts/
    main.js                      # wires up the block-interact event
    chess/
      engine.js                  # pure chess rules engine (no MC APIs)
      gameManager.js             # per-block game sessions + persistence
      ui.js                      # forms-based UI and interaction flow
resource_pack/
  manifest.json
  blocks.json                    # maps the block to its textures
  models/blocks/chess_set.geo.json
  textures/
    terrain_texture.json
    blocks/chess_set_top.png
    blocks/chess_set_side.png
  texts/en_US.lang
```

## Installing

1. Zip the `behavior_pack/` folder and rename it to
   `ChessSet_BP.mcpack`. Do the same for `resource_pack/` →
   `ChessSet_RP.mcpack`.
   (Or zip both folders together into a single `.mcaddon` file and
   double-click it — Minecraft will import both packs at once.)
2. Open the `.mcpack`/`.mcaddon` file(s) with Minecraft Bedrock installed;
   they'll import automatically.
3. In your world settings, enable both the **Chess Set** behavior pack and
   resource pack. No experimental toggles are needed.
4. Get the block with `/give @s chess:chess_set` (or find it in the
   Construction tab of the creative inventory) and place it.

### If the pack fails to load with a script API version error

Minecraft's Script API module versions (`@minecraft/server`,
`@minecraft/server-ui`) evolve with each game release. This add-on pins
`behavior_pack/manifest.json` to versions that were stable as of this
add-on's creation. If your Minecraft version reports that it can't find a
matching module version, the error message will list which versions *are*
available — update the `dependencies` versions in
`behavior_pack/manifest.json` to match, then re-import.

## Testing the chess engine standalone

`engine.js` has no dependency on any Minecraft API, so its rules can be
exercised directly with plain Node.js, e.g.:

```js
import { ChessEngine, squareName } from "./behavior_pack/scripts/chess/engine.js";
const game = new ChessEngine();
console.log(game.legalMovesFrom(12)); // legal moves for the e2 pawn
```
