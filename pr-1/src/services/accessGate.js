// @ts-check

/** The only access-release path. Phase 1 keeps every release held. */
export const ACCESS_GATE_ID = "access-release";

/**
 * @param {unknown} [_request]
 */
export function requestAccessRelease(_request) {
  return {
    gate: ACCESS_GATE_ID,
    released: false,
    status: "held",
    reasonCode: "GATE_CLOSED",
    message: "Access release is held for a person.",
  };
}
