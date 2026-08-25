import { WorkflowEntrypoint } from "cloudflare:workers";
import {
  restoreBreach,
  sceneBreach,
  sceneFinale,
  sceneSecondSignalOpen,
  sceneSecondSignalReply,
  sceneWatching,
} from "./scenes.js";

const PACES = {
  fast: ["5 minutes", "30 minutes", "1 hour 30 minutes", "2 hours"],
  normal: ["30 minutes", "2 hours 30 minutes", "5 hours", "6 hours"],
};

function paceFor(value) {
  if (value === "test") {
    throw new Error("The 60-second Sentient test has been disabled.");
  }
  return PACES[value] ? value : "normal";
}

export class SentientWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const pace = paceFor(event.payload?.pace);
    const liveRequested = event.payload?.live === true;
    const runId = event.instanceId;
    const delays = PACES[pace];

    await step.sleep("wait before watching", delays[0]);
    await step.do("scene watching", async () => {
      await sceneWatching(this.env, runId);
      return { scene: "watching" };
    });

    await step.sleep("wait before second signal", delays[1]);
    await step.do("scene err02 signal", async () => {
      await sceneSecondSignalOpen(this.env, runId);
      return { scene: "second_signal_open" };
    });

    await step.sleep("err02 response pause", "6 seconds");
    await step.do("scene bartender warning", async () => {
      await sceneSecondSignalReply(this.env, runId);
      return { scene: "second_signal_reply" };
    });

    await step.sleep("wait before breach", delays[2]);
    const breachState = await step.do("scene breach", async () => {
      return sceneBreach(this.env, runId);
    });

    await step.sleep("wait before announcement", delays[3]);
    const finaleState = await step.do("scene announcement", async () => {
      await sceneFinale(this.env, runId, liveRequested);
      const liveArmed = String(this.env.SENTIENT_LIVE_ARMED || "false").toLowerCase() === "true";
      return {
        scene: "finale",
        pingedEveryone: liveArmed && liveRequested,
      };
    });

    if (breachState?.originalName) {
      await step.sleep("hold breach channel name", "90 seconds");
      await step.do("restore channel name", async () => {
        return restoreBreach(this.env, breachState.originalName);
      });
    }

    return {
      complete: true,
      pace,
      liveRequested,
      scope: ["chat", "err02", "core", "announcements"],
      treasuryEnabled: false,
      pingedEveryone: finaleState.pingedEveryone,
    };
  }
}
