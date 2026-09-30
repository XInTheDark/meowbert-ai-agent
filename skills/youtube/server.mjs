import { startInstructionSkillServer } from "../shared/instruction-skill-server.mjs";

startInstructionSkillServer({ name: "youtube-source", version: "1.0.0" }).catch((error) => {
  console.error(error);
  process.exit(1);
});
