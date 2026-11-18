// @ts-check

/** The only path that may release access details. */
export const ACCESS_GATE_ID = "access-release";

/**
 * Unscreened and flagged stays stay held. A named approval is the only way through a red result.
 * The released value is always a placeholder.
 * @param {any} [request]
 */
export function requestAccessRelease(request = {}) {
  const screening = request.screening;
  const review = request.review;
  if (!screening || screening.level !== "green" && screening.level !== "red") {
    return held("UNSCREENED", "Access release is held until the stay is screened.");
  }
  if (review?.decision === "denied") {
    return held("REVIEW_DENIED", "Access release was denied.");
  }
  if (screening.level === "red" && review?.decision !== "approved") {
    return {
      ...held("REVIEW_REQUIRED", "Access release is held for a person."),
      reasons: [...(screening.reasons || [])],
    };
  }
  if (request.riskScreeningEnabled === false && review?.decision !== "approved") {
    return held("SCREENING_OFF", "Access release is held while screening is off.");
  }
  return {
    gate: ACCESS_GATE_ID,
    released: true,
    status: "released",
    reasonCode: "OK",
    access: { placeholder: "(placeholder)" },
    message: "Access details are a placeholder.",
  };
}

function held(reasonCode, message) {
  return {
    gate: ACCESS_GATE_ID,
    released: false,
    status: "held",
    reasonCode,
    message,
  };
}
