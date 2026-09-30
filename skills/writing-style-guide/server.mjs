import { startInstructionSkillServer } from "../shared/instruction-skill-server.mjs";

startInstructionSkillServer({ name: "writing-style-guide", version: "1.0.0" }).catch((error) => {
  console.error(error);
  process.exit(1);
});
