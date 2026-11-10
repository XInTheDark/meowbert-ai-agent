// A refusal the calling model should see as its tool result (a lane it does not own, a budget it does
// not have, a model the router does not offer), as opposed to a failure of the run.
export class SwarmToolError extends Error {}
