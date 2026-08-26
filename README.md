# ChessInMinecraft

Chess in Minecraft (Bedrock) ♟️

A Minecraft Bedrock add-on that adds a **Chess Set** block. Placing it
builds a real, physical 8x8 chessboard out of world blocks, and two players
play a full game of chess by tapping pieces and squares directly - no menus
required. No experimental toggles are needed.

## Features

- **Chess Set block** — place it and it immediately builds an 8x8 physical
  board of checkered square blocks in front of it.
- **Two-player matchmaking** — the first player to interact with the board
  joins as White or Black; the game begins automatically once a second
  player joins the other side.
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

1. Place a Chess Set block somewhere with clear space: an 8x8 area
   starting at that block (files run east/+X, ranks run south/+Z) plus one
   block of headroom above it for the pieces.
2. The block immediately turns into a checkered 8x8 board.
3. A player taps any square or piece and joins as White or Black.
4. A second player taps the board and joins the other color — the game
   starts immediately, and each player is told whose turn it is in chat.
5. On your turn, tap one of your own pieces to select it — the square lights
   up and chat lists its legal destination squares (e.g. `e3, e4`). Tap a
   lit destination square to move there, or tap your piece again to cancel
   the selection. Promoting a pawn opens a small popup to choose the piece.
6. Type `resign` in chat at any time during your game to resign.
7. When the game ends (checkmate, stalemate, draw, or resignation), either
   player can tap the board to start a new game.

## Project layout

```
behavior_pack/
  manifest.json
  blocks/
    chess_set.json                 # placement anchor - builds the board
    chess_square_light.json        # light/dark/highlighted square tiles
    chess_square_dark.json
    chess_square_highlight.json
    chess_piece_{white,black}_{pawn,knight,bishop,rook,queen,king}.json
  scripts/
    main.js                        # registers the chess:interact custom
                                    # block component and the placement/
                                    # chat handlers
    chess/
      engine.js                    # pure chess rules engine (no MC APIs)
      board.js                     # builds/redraws the physical board,
                                    # resolves a clicked block to a square
      gameManager.js                # per-board game sessions + persistence
      ui.js                         # click handling, join/result/promotion
                                    # forms, chat messaging
resource_pack/
  manifest.json
  blocks.json                      # maps every block above to its textures
  textures/
    terrain_texture.json
    blocks/
      square_{light,dark,highlight}.png
      piece_{white,black}_side.png
      piece_top_{white,black}_{P,N,B,R,Q,K}.png   # generated glyph textures
  texts/en_US.lang
```

## Installing

Every push builds a ready-to-use `.mcaddon` automatically — see
[Actions](../../actions/workflows/build-mcaddon.yml), open the latest run,
and download the `ChessSet-<version>-<sha>` artifact from its Summary page.
No zipping required; skip to step 2 below.

To build it yourself instead:

1. Zip the `behavior_pack/` folder and rename it to
   `ChessSet_BP.mcpack`. Do the same for `resource_pack/` →
   `ChessSet_RP.mcpack`.
   (Or zip both folders together into a single `.mcaddon` file and
   double-click it — Minecraft will import both packs at once.)
2. Open the `.mcpack`/`.mcaddon` file(s) with Minecraft Bedrock installed;
   they'll import automatically.
3. In your world settings, activate the **Chess Set** behavior pack (under
   Behavior Packs) or resource pack (under Resource Packs) — the two
   declare a mutual dependency on each other, so activating either one
   automatically pulls in the other. No experimental toggles are needed.
4. Get the block with `/give @s chess:chess_set` (or find it in the
   Construction tab of the creative inventory) and place it with an 8x8
   clear area (plus headroom above) in front of it.

### Versioning

Both packs' `header.version` (and their `modules[].version`) are bumped
together, in lockstep, with every change that touches `behavior_pack/` or
`resource_pack/` content — they must match exactly, since each pack
declares a mutual dependency on the other's exact header version (see
"mutual pack dependency" above), and a version mismatch between them will
fail to load. Follow semver:

- **patch** (`1.0.0` → `1.0.1`): fixes and non-functional pack changes -
  manifests, refactors, texture/model tweaks with no gameplay effect.
- **minor** (`1.0.1` → `1.1.0`): backward-compatible functional changes -
  new features, UI changes, anything a player would notice but that
  doesn't break existing games or require re-joining.
- **major** (`1.1.0` → `2.0.0`): breaking changes - anything that would
  invalidate in-progress saved games (e.g. a change to the dynamic
  property schema in `gameManager.js`) or require a different Minecraft
  version.

Changes that don't touch pack content at all - CI workflows, this README,
repo tooling - don't need a version bump: nothing about the built
`.mcaddon` actually changed, so bumping would just produce two
byte-identical artifacts under different version numbers.

When bumping, update: both manifests' `header.version`, both manifests'
`modules[].version`, and *both* cross-referencing `dependencies` entries
(`behavior_pack/manifest.json`'s dependency on the resource pack's uuid,
and `resource_pack/manifest.json`'s dependency on the behavior pack's
uuid) — all four numbers must agree. Also update the version string
embedded in both packs' `header.name`/`header.description`, and in
`resource_pack/texts/en_US.lang`'s `pack.name`/`pack.description` (which
override the resource pack's header for display) - so the version is
visible in the pack list in-game, which is what makes bug reports like
"I got this error on the pack I just installed" traceable to a specific
build.

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
