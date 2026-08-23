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
5. Type `resign` in chat at any time during your game to resign.
6. When the game ends (checkmate, stalemate, draw, or resignation), either
   player can start a new game from the same block.

### About the board UI — visual grid (experimental, needs an in-game check)

Minecraft Bedrock's scripting API only builds `ActionFormData` UI out of
buttons, which vanilla always renders as a **vertical list**, not a
graphical grid. To get an actual 8x8 board, this add-on ships a resource
pack override of `ui/server_form.json` — the JSON UI screen vanilla itself
uses to render every `ActionFormData` in the game — that swaps in a real
`type: "grid"` layout, but *only* for a form with exactly 64 buttons (i.e.
the chess board specifically). Every other form, including this add-on's
own join/result screens and any other add-on's menus, still renders as the
normal vertical list. See the comment block at the top of
`resource_pack/ui/server_form.json` for exactly how this works and what it
assumes.

**This part hasn't been verified in a live Minecraft client yet.** It's
built from a careful reading of Mojang's actual vanilla `server_form.json`
([source](https://github.com/Mojang/bedrock-samples/blob/main/resource_pack/ui/server_form.json)),
reusing its real button/collection-binding mechanism rather than guessing,
but a few things can only be confirmed by loading the pack and opening the
board in-game:
- does the grid actually render 8x8, and in the expected reading order
  (rank 8 at top, a-h left to right)?
- does the 24x24 cell size fit inside the dialog frame without clipping?
- do clicks on grid cells still map to the correct `response.selection`
  index script-side?

If it doesn't work as expected, delete `resource_pack/ui/server_form.json`
and its entry in `resource_pack/ui/_ui_defs.json` — the board falls straight
back to a scrollable vertical list of all 64 squares (rank 8 down to rank
1, files a-h) with no other code changes required, since the script side
(`behavior_pack/scripts/chess/ui.js`) always just sends 64 buttons either
way and doesn't care how they're laid out.

One consequence of moving to a real grid: each button is now a compact
single glyph (colored by state — white/black piece, selected, or legal
target) instead of a text description, since the button's position in the
grid already conveys which square it is. If you revert to the vertical
list, you may want to swap `renderSquareLabel` in `ui.js` back to
including the square name in the label, since position alone won't convey
that in a list.

**Because this patches a screen shared globally by every resource pack in
the world**, not just this one, it's worth keeping in mind if you run this
alongside other add-ons that use `ActionFormData` with exactly 64 buttons
for something unrelated to chess — that form would also render as a grid.
This is unlikely in practice but not impossible.

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
  ui/
    _ui_defs.json                 # registers the custom UI file below
    server_form.json               # experimental grid-board override, see below
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
