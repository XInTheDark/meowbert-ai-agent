import { z } from "zod";

// URL query values are strings; Boolean("false") must never grant confirmation.
export const queryBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());
