import { Board, BoardState, OpponentStats, Play, SimpleBoard, SimpleOpponentStats } from "../Types";

import { Player } from "@player";
import { AugmentationName, GoColor, GoOpponent, GoPlayType, GoValidity } from "@enums";
import { Go } from "../Go";
import {
  getNewBoardState,
  getNewBoardStateFromSimpleBoard,
  makeMove,
  passTurn,
  updateCaptures,
} from "../boardState/boardState";
import { getNextTurn, handleNextTurn, resetAI } from "../boardAnalysis/goAI";
import {
  evaluateIfMoveIsValid,
  getControlledSpace,
  getPreviousMove,
  simpleBoardFromBoard,
  simpleBoardFromBoardString,
} from "../boardAnalysis/boardAnalysis";
import { endGoGame, getOpponentStats, getScore, resetWinstreak } from "../boardAnalysis/scoring";
import { WHRNG } from "../../Casino/RNG";
import { getRecordKeys } from "../../Types/Record";
import { CalculateEffect, getEffectTypeForFaction } from "./effect";
import { exceptionAlert } from "../../utils/helpers/exceptionAlert";
import { newOpponentStats } from "../Constants";

/**
 * Check the move based on the current settings
 */
export function validateMove(error: (s: string) => never, x: number, y: number, methodName = "", settings = {}): void {
  const check = {
    emptyNode: true,
    requireNonEmptyNode: false,
    repeat: true,
    onlineNode: true,
    requireOfflineNode: false,
    suicide: true,
    playAsWhite: false,
    pass: false,
    ...settings,
  };

  const moveString = methodName + (check.pass ? "" : ` ${x},${y}`) + (check.playAsWhite ? " (White)" : "") + ": ";
  const moveColor = check.playAsWhite ? GoColor.white : GoColor.black;

  if (check.playAsWhite) {
    validatePlayAsWhite(error);
  }
  validateTurn(error, moveString, moveColor);

  if (check.pass) {
    return;
  }

  const boardSize = Go.currentGame.board.length;
  if (x < 0 || x >= boardSize) {
    error(`Invalid column number (x = ${x}), column must be a number 0 through ${boardSize - 1}`);
  }
  if (y < 0 || y >= boardSize) {
    error(`Invalid row number (y = ${y}), row must be a number 0 through ${boardSize - 1}`);
  }

  const validity = evaluateIfMoveIsValid(Go.currentGame, x, y, moveColor);
  const point = Go.currentGame.board[x][y];
  if (!point && check.onlineNode) {
    error(
      `The node ${x},${y} is offline, so you cannot ${
        methodName === "removeRouter"
          ? "clear this point with removeRouter()"
          : methodName === "destroyNode"
          ? "destroy the node. (Attempted to destroyNode)"
          : "place a router there"
      }.`,
    );
  }
  if (validity === GoValidity.noSuicide && check.suicide) {
    error(
      `${moveString} ${validity}. That point has no neighboring empty nodes, and is not connected to a network with access to empty nodes, meaning it would be instantly captured if played there.`,
    );
  }
  if (validity === GoValidity.boardRepeated && check.repeat) {
    error(
      `${moveString} ${validity}. That move would repeat the previous board state, which is illegal as it leads to infinite loops.`,
    );
  }
  if (point?.color !== GoColor.empty && check.emptyNode) {
    error(
      `The point ${x},${y} is occupied by a router, so you cannot ${
        methodName === "destroyNode" ? "destroy this node. (Attempted to destroyNode)" : "place a router there"
      }`,
    );
  }

  if (point?.color === GoColor.empty && check.requireNonEmptyNode) {
    error(`The point ${x},${y} does not have a router on it, so you cannot clear this point with removeRouter().`);
  }
  if (point && check.requireOfflineNode) {
    error(`The node ${x},${y} is not offline, so you cannot repair the node.`);
  }
}

function validatePlayAsWhite(error: (s: string) => never) {
  if (Go.currentGame.ai !== GoOpponent.none) {
    error(`${GoValidity.invalid}. You can only play as white when playing against 'No AI'`);
  }

  if (Go.currentGame.previousPlayer === GoColor.white) {
    error(`${GoValidity.notYourTurn}. You cannot play or pass as white until the opponent has played.`);
  }
}

function validateTurn(error: (s: string) => never, moveString = "", color = GoColor.black) {
  if (Go.currentGame.previousPlayer === color) {
    error(
      `${moveString} ${GoValidity.notYourTurn}. Do you have multiple scripts running, or did you forget to await makeMove() or opponentNextTurn()`,
    );
  }
  if (Go.currentGame.previousPlayer === null) {
    error(
      `${moveString} ${GoValidity.gameOver}. You cannot make more moves. Start a new game using resetBoardState().`,
    );
  }
}

/**
 * Pass player's turn and await the opponent's response (or logs the end of the game if both players pass)
 */
export function handlePassTurn(logger: (s: string) => void, passAsWhite = false) {
  const color = passAsWhite ? GoColor.white : GoColor.black;
  passTurn(Go.currentGame, color);
  logger("Go turn passed.");
  if (Go.currentGame.previousPlayer === null) {
    logEndGame(logger);
  }
  return handleNextTurn(Go.currentGame, true);
}

/**
 * Validates and applies the player's router placement
 */
export function makePlayerMove(
  logger: (s: string) => void,
  error: (s: string) => never,
  x: number,
  y: number,
  playAsWhite = false,
) {
  const boardState = Go.currentGame;
  const color = playAsWhite ? GoColor.white : GoColor.black;
  const validity = evaluateIfMoveIsValid(boardState, x, y, color);
  const moveWasMade = makeMove(boardState, x, y, color);

  if (validity !== GoValidity.valid || !moveWasMade) {
    error(`Invalid move: ${x} ${y}. ${validity}.`);
  }

  logger(`Go move played: ${x}, ${y}${playAsWhite ? " (White)" : ""}`);
  return handleNextTurn(boardState, true);
}

/**
  Returns the promise that provides the opponent's move, once it finishes thinking.
 */
export function getOpponentNextMove(logger: (s: string) => void, logOpponentMove = true, playAsWhite = false) {
  const playerColor = playAsWhite ? GoColor.white : GoColor.black;
  const nextTurn = getNextTurn(playerColor);
  // Only asynchronously log the opponent move if not disabled by the player
  if (logOpponentMove) {
    return nextTurn.then((move) => {
      if (move.type === GoPlayType.gameOver) {
        logEndGame(logger);
      } else if (move.type === GoPlayType.pass) {
        logger(`Opponent passed their turn. You can end the game by passing as well.`);
      } else if (move.type === GoPlayType.move) {
        logger(`Opponent played move: ${move.x}, ${move.y}`);
      }
      return move;
    });
  }

  return nextTurn;
}

/**
 * Returns a grid of booleans indicating if the coordinates at that location are a valid move for the player
 */
export function getValidMoves(_boardState?: BoardState, playAsWhite = false) {
  const boardState = _boardState || Go.currentGame;
  const color = playAsWhite ? GoColor.white : GoColor.black;

  // If the game is over, or if it is not your turn, there are no valid moves
  if (!boardState.previousPlayer || boardState.previousPlayer === color) {
    return boardState.board.map((): boolean[] => Array(boardState.board.length).fill(false) as boolean[]);
  }

  // Map the board matrix into true/false values
  return boardState.board.map((column, x) =>
    column.reduce((validityArray: boolean[], point, y) => {
      const isValid = evaluateIfMoveIsValid(boardState, x, y, color) === GoValidity.valid;
      validityArray.push(isValid);
      return validityArray;
    }, []),
  );
}

/**
 * Returns a grid with an ID for each contiguous chain of same-state nodes (excluding dead/offline nodes)
 */
export function getChains(_board?: Board) {
  const board = _board || Go.currentGame.board;
  const chains: string[] = [];
  // Turn the internal chain IDs into nice consecutive numbers for display to the player
  return board.map((column) =>
    column.reduce((chainIdArray: (number | null)[], point) => {
      if (!point) {
        chainIdArray.push(null);
        return chainIdArray;
      }
      if (!chains.includes(point.chain)) {
        chains.push(point.chain);
      }
      chainIdArray.push(chains.indexOf(point.chain));
      return chainIdArray;
    }, []),
  );
}

/**
 * Returns a grid of numbers representing the number of open-node connections each player-owned chain has.
 */
export function getLiberties(_board?: Board) {
  const board = _board || Go.currentGame.board;
  return board.map((column) =>
    column.reduce((libertyArray: number[], point) => {
      libertyArray.push(point?.liberties?.length || -1);
      return libertyArray;
    }, []),
  );
}

/**
 * Returns a grid indicating which player, if any, controls the empty nodes by fully encircling it with their routers
 */
export function getControlledEmptyNodes(_board?: Board) {
  const board = _board || Go.currentGame.board;
  const controlled = getControlledSpace(board);
  return controlled.map((column, x: number) =>
    column.reduce((ownedPoints: string, owner: GoColor, y: number) => {
      if (owner === GoColor.white) {
        return ownedPoints + "O";
      }
      if (owner === GoColor.black) {
        return ownedPoints + "X";
      }
      if (!board[x][y]) {
        return ownedPoints + "#";
      }
      if (board[x][y]?.color === GoColor.empty) {
        return ownedPoints + "?";
      }
      return ownedPoints + ".";
    }, ""),
  );
}

/**
 * Returns all previous board states as SimpleBoards
 */
export function getHistory(): string[][] {
  return Go.currentGame.previousBoards.map((boardString): string[] => simpleBoardFromBoardString(boardString));
}

/**
 * Gets the status of the current game.
 * Shows the current player, current score, and the previous move coordinates.
 * Previous move coordinates will be [-1, -1] for a pass, or if there are no prior moves.
 *
 * Also provides the white player's komi (bonus starting score), and the amount of bonus cycles from offline time remaining
 */
export function getGameState() {
  const currentPlayer = getCurrentPlayer();
  const score = getScore(Go.currentGame);
  const previousMove = getPreviousMove();

  return {
    currentPlayer,
    whiteScore: score[GoColor.white].sum,
    blackScore: score[GoColor.black].sum,
    previousMove,
    komi: score[GoColor.white].komi,
    bonusCycles: Go.storedCycles,
  };
}

export function getMoveHistory(): SimpleBoard[] {
  return Go.currentGame.previousBoards.map((boardString) => simpleBoardFromBoardString(boardString));
}

/**
 * Returns 'None' if the game is over, otherwise returns the color of the current player's turn
 */
export function getCurrentPlayer(): "None" | "White" | "Black" {
  if (Go.currentGame.previousPlayer === null) {
    return "None";
  }
  return Go.currentGame.previousPlayer === GoColor.black ? GoColor.white : GoColor.black;
}

/**
 * Handle post-game logging
 */
function logEndGame(logger: (s: string) => void) {
  const boardState = Go.currentGame;
  const score = getScore(boardState);
  logger(
    `Subnet complete! Final score: ${boardState.ai}: ${score[GoColor.white].sum},  Player: ${score[GoColor.black].sum}`,
  );
}

/**
 * Clears the board, resets winstreak if applicable
 */
export function resetBoardState(
  logger: (s: string) => void,
  error: (s: string) => void,
  opponent: GoOpponent,
  boardSize: number,
) {
  if (![5, 7, 9, 13].includes(boardSize) && opponent !== GoOpponent.w0r1d_d43m0n) {
    error(`Invalid subnet size requested (${boardSize}), size must be 5, 7, 9, or 13`);
    return;
  }

  if (opponent === GoOpponent.w0r1d_d43m0n && !Player.hasAugmentation(AugmentationName.TheRedPill, true)) {
    error(`Invalid opponent requested (${opponent}), this opponent has not yet been discovered`);
    return;
  }

  const oldBoardState = Go.currentGame;
  if (oldBoardState.previousPlayer !== null && oldBoardState.previousBoards.length) {
    resetWinstreak(oldBoardState.ai, false);
  }

  resetAI();
  Go.currentGame = getNewBoardState(boardSize, opponent, true);
  handleNextTurn(Go.currentGame).catch((error) => exceptionAlert(error));
  logger(`New game started: ${opponent}, ${boardSize}x${boardSize}`);
  return simpleBoardFromBoard(Go.currentGame.board);
}

/**
 * Retrieve and clean up stats for each opponent played against
 */
export function getStats() {
  const statDetails: Partial<Record<GoOpponent, SimpleOpponentStats>> = {};
  for (const opponent of getRecordKeys(Go.stats)) {
    const details = getOpponentStats(opponent);
    const nodePower = getOpponentStats(opponent).nodePower;
    const effectPercent = (CalculateEffect(nodePower, opponent) - 1) * 100;
    const effectDescription = getEffectTypeForFaction(opponent);
    statDetails[opponent] = {
      wins: details.wins,
      losses: details.losses,
      winStreak: details.winStreak,
      highestWinStreak: details.highestWinStreak,
      favor: details.favor,
      bonusPercent: effectPercent,
      bonusDescription: effectDescription,
    };
  }

  return statDetails;
}

/**
 * Reset all win/loss numbers for the No AI opponent.
 * @param resetAll if true, reset win/loss records for all opponents. This leaves node power and bonuses unchanged.
 */
export function resetStats(resetAll = false) {
  if (resetAll) {
    for (const opponent of getRecordKeys(Go.stats)) {
      Go.stats[opponent] = {
        ...(Go.stats[opponent] as OpponentStats),
        wins: 0,
        losses: 0,
        winStreak: 0,
        oldWinStreak: 0,
        highestWinStreak: 0,
      };
    }
  } else {
    Go.stats[GoOpponent.none] = newOpponentStats();
  }
}

const boardValidity = {
  valid: "",
  badShape: "Invalid boardState: Board must be a square",
  badType: "Invalid boardState: Board must be an array of strings",
  badSize: "Invalid boardState: Board must be 5, 7, 9, 13, or 19 in size",
  badCharacters:
    'Invalid board state: unknown characters found. "X" represents black pieces, "O" white, "." empty points, and "#" offline nodes.',
  failedToCreateBoard: "Invalid board state: Failed to create board",
} as const;

/**
 * Validate the given SimpleBoard and prior board state (if present) and turn it into a full BoardState with updated analytics
 */
export function validateBoardState(
  error: (s: string) => never,
  _boardState?: unknown,
  _priorBoardState?: unknown,
): BoardState | undefined {
  const simpleBoard = getSimpleBoardFromUnknown(error, _boardState);
  const priorSimpleBoard = getSimpleBoardFromUnknown(error, _priorBoardState);

  if (!_boardState || !simpleBoard) {
    return undefined;
  }

  try {
    return getNewBoardStateFromSimpleBoard(simpleBoard, priorSimpleBoard);
  } catch (e) {
    error(boardValidity.failedToCreateBoard);
  }
}

/**
 * Check that the given boardState is a valid SimpleBoard, and return it if it is.
 */
function getSimpleBoardFromUnknown(error: (arg0: string) => never, _boardState: unknown): SimpleBoard | undefined {
  if (!_boardState) {
    return undefined;
  }
  if (!Array.isArray(_boardState)) {
    error(boardValidity.badType);
  }
  if ((_boardState as unknown[]).find((row) => typeof row !== "string")) {
    error(boardValidity.badType);
  }

  const boardState = _boardState as string[];

  if (boardState.find((row) => row.length !== boardState.length)) {
    error(boardValidity.badShape);
  }
  if (![5, 7, 9, 13, 19].includes(boardState.length)) {
    error(boardValidity.badSize);
  }
  if (boardState.find((row) => row.match(/[^XO#.]/))) {
    error(boardValidity.badCharacters);
  }
  return boardState as SimpleBoard;
}

/** Validate singularity access by throwing an error if the player does not have access. */
export function checkCheatApiAccess(error: (s: string) => never): void {
  const hasSourceFile = Player.activeSourceFileLvl(14) > 1;
  const isBitnodeFourteenTwo = Player.activeSourceFileLvl(14) === 1 && Player.bitNodeN === 14;
  if (!hasSourceFile && !isBitnodeFourteenTwo) {
    error(
      `The go.cheat API requires Source-File 14.2 to run, a power up you obtain later in the game.
      It will be very obvious when and how you can obtain it.`,
    );
  }
}

/**
 * Determines if the attempted cheat move is successful. If so, applies the cheat via the callback, and gets the opponent's response.
 *
 * If it fails, determines if the player's turn is skipped, or if the player is ejected from the subnet.
 */
export function determineCheatSuccess(
  logger: (s: string) => void,
  callback: () => void,
  successRngOverride?: number,
  ejectRngOverride?: number,
  playAsWhite = false,
): Promise<Play> {
  const state = Go.currentGame;
  const rng = new WHRNG(Player.totalPlaytime);
  state.passCount = 0;
  const priorCheatCount = playAsWhite ? state.cheatCountForWhite : state.cheatCount;
  const playerColor = playAsWhite ? GoColor.white : GoColor.black;

  // If cheat is successful, run callback
  if ((successRngOverride ?? rng.random()) <= cheatSuccessChance(state.cheatCount, playAsWhite)) {
    callback();
  }
  // If there have been prior cheat attempts, and the cheat fails, there is a 10% chance of instantly losing
  else if (priorCheatCount && (ejectRngOverride ?? rng.random()) < 0.1 && state.ai !== GoOpponent.none) {
    logger(`Cheat failed! You have been ejected from the subnet.`);
    endGoGame(state);
    return handleNextTurn(state, true);
  } else {
    // If the cheat fails, your turn is skipped
    logger(`Cheat failed. Your turn has been skipped.`);
    passTurn(state, playerColor, false);
  }

  if (playAsWhite) {
    state.cheatCountForWhite++;
  } else {
    state.cheatCount++;
  }
  Go.currentGame.previousPlayer = playerColor;
  updateCaptures(Go.currentGame.board, playerColor, true);

  return handleNextTurn(state, true);
}

/**
 * Cheating success rate scales with player's crime success rate, and decreases with prior cheat attempts.
 *
 * The source file bonus is additive success chance on top of the other multipliers.
 *
 * Cheat success chance required for N cheats with 100% success rate in a game:
 *
 * 1 100% success rate cheat requires +66% increased crime success rate
 * 2 100% success cheats: +145% increased crime success rate
 * 3: +282%
 * 4: +535%
 * 5: +1027%
 * 7: +4278%
 * 10: +59,854%
 * 12: +534,704%
 * 15: +31,358,645%
 */
export function cheatSuccessChance(cheatCountOverride: number, playAsWhite = false) {
  const cheatCount =
    cheatCountOverride ?? (playAsWhite ? Go.currentGame.cheatCountForWhite : Go.currentGame.cheatCount);
  const sourceFileBonus = Player.activeSourceFileLvl(14) === 3 ? 0.25 : 0;
  const cheatCountScalar = (0.7 - 0.02 * cheatCount) ** cheatCount;
  return Math.max(Math.min(0.6 * cheatCountScalar * Player.mults.crime_success + sourceFileBonus, 1), 0);
}

/**
 * Attempts to remove an existing router from the board. Can fail. If failed, can immediately end the game
 */
export function cheatRemoveRouter(
  logger: (s: string) => void,
  error: (s: string) => never,
  x: number,
  y: number,
  successRngOverride?: number,
  ejectRngOverride?: number,
  playAsWhite = false,
): Promise<Play> {
  const point = Go.currentGame.board[x][y];
  if (!point) {
    error(`Cheat failed. The point ${x},${y} is already offline.`);
  }
  return determineCheatSuccess(
    logger,
    () => {
      point.color = GoColor.empty;
      logger(`Cheat successful. The point ${x},${y} was cleared.`);
    },
    successRngOverride,
    ejectRngOverride,
    playAsWhite,
  );
}

/**
 * Attempts play two moves at once. Can fail. If failed, can immediately end the game
 */
export function cheatPlayTwoMoves(
  logger: (s: string) => void,
  error: (s: string) => never,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  successRngOverride?: number,
  ejectRngOverride?: number,
  playAsWhite = false,
): Promise<Play> {
  const point1 = Go.currentGame.board[x1][y1];
  const point2 = Go.currentGame.board[x2][y2];

  if (!point1 || !point2) {
    error(`Cheat failed. One of the points ${x1},${y1} or ${x2},${y2} is already offline.`);
  }
  const playerColor = playAsWhite ? GoColor.white : GoColor.black;

  return determineCheatSuccess(
    logger,
    () => {
      point1.color = playerColor;
      point2.color = playerColor;

      logger(`Cheat successful. Two go moves played: ${x1},${y1} and ${x2},${y2}`);
    },
    successRngOverride,
    ejectRngOverride,
    playAsWhite,
  );
}

export function cheatRepairOfflineNode(
  logger: (s: string) => void,
  x: number,
  y: number,
  successRngOverride?: number,
  ejectRngOverride?: number,
  playAsWhite = false,
): Promise<Play> {
  return determineCheatSuccess(
    logger,
    () => {
      Go.currentGame.board[x][y] = {
        chain: "",
        liberties: null,
        y,
        color: GoColor.empty,
        x,
      };
      logger(`Cheat successful. The point ${x},${y} was repaired.`);
    },
    successRngOverride,
    ejectRngOverride,
    playAsWhite,
  );
}

export function cheatDestroyNode(
  logger: (s: string) => void,
  x: number,
  y: number,
  successRngOverride?: number,
  ejectRngOverride?: number,
  playAsWhite = false,
): Promise<Play> {
  return determineCheatSuccess(
    logger,
    () => {
      Go.currentGame.board[x][y] = null;
      logger(`Cheat successful. The point ${x},${y} was destroyed.`);
    },
    successRngOverride,
    ejectRngOverride,
    playAsWhite,
  );
}
