import { basicErrorMessage } from "../Netscript/ErrorMessages";
import { ScriptDeath } from "../Netscript/ScriptDeath";
import type { WorkerScript } from "../Netscript/WorkerScript";
import { dialogBoxCreate } from "../ui/React/DialogBox";
import { getErrorMessageWithStackAndCause } from "./ErrorHelper";

/** Generate an error dialog when workerscript is known */
export function handleUnknownError(e: unknown, ws: WorkerScript | null = null, initialText = "") {
  if (e instanceof ScriptDeath) {
    // No dialog for ScriptDeath
    return;
  }
  if (ws && typeof e === "string") {
    const headerText = basicErrorMessage(ws, "", "");
    if (!e.includes(headerText)) e = basicErrorMessage(ws, e);
  } else if (e instanceof SyntaxError) {
    const msg = `${e.message} (sorry we can't be more helpful)`;
    e = ws ? basicErrorMessage(ws, msg, "SYNTAX") : `SYNTAX ERROR:\n\n${msg}`;
  } else if (e instanceof Error) {
    // Ignore any cancellation errors from Monaco that get here
    if (e.name === "Canceled" && e.message === "Canceled") {
      return;
    }
    if (ws) {
      console.error(`An error was thrown in your script. Hostname: ${ws.hostname}, script name: ${ws.name}.`);
    }
    /**
     * If e is an instance of Error, we print it to the console. This is especially useful when debugging a TypeScript
     * script. The stack trace in the error popup contains only the trace of the transpiled code. Even with a source
     * map, parsing it to get the relevant info from the original TypeScript file is complicated. The built-in developer
     * tool of browsers will do that for us if we print the error to the console.
     */
    console.error(e);
    const msg = getErrorMessageWithStackAndCause(e);
    e = ws ? basicErrorMessage(ws, msg) : `RUNTIME ERROR:\n\n${msg}`;
  }
  if (typeof e !== "string") {
    console.error("Unexpected error:", e);
    const msg = `Unexpected type of error thrown. This error was likely thrown manually within a script.
        Error has been logged to the console.\n\nType of error: ${typeof e}\nValue of error: ${e}`;
    e = ws ? basicErrorMessage(ws, msg, "UNKNOWN") : msg;
  }
  dialogBoxCreate(initialText + String(e));
}

/** Use this handler to handle the error when we call getSaveData function or getSaveInfo function */
export function handleGetSaveDataInfoError(error: unknown, fromGetSaveInfo = false) {
  console.error(error);
  let errorMessage = `Cannot get save ${fromGetSaveInfo ? "info" : "data"}. Error: ${error}.`;
  if (error instanceof RangeError) {
    errorMessage += " This may be because the save data is too large.";
  }
  if (error instanceof Error && error.stack) {
    errorMessage += `\nStack:\n${error.stack}`;
  }
  dialogBoxCreate(errorMessage);
}
