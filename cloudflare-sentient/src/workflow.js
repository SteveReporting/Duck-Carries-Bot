import { WorkflowEntrypoint } from "cloudflare:workers";
import {
  restoreBreach,
  sceneBreach,
  sceneFinale,
  sceneSecondSignalOpen,
  sceneSecondSignalReply,
  sceneVaultEcho,
  sceneWatching,
} from "./scenes.js";

const PACES = {
  // Private smoke test: entire remaining story in about one minute.
  test: ["5 seconds", "10 seconds", "10 seconds", "15 seconds", "20 seconds"],

  // Compressed live build-up: Day 1 already happened manually.
  fast: ["5 minutes", "30 minutes", "55 minutes", "1 hour 30 minutes", "2 hours"],

  // Slower compressed version, still far shorter than the original week-long plan.
  normal: ["30 minutes", "2 hours 30 minutes", "4 hours", "5 hours", "6 hours"],
};

function paceFor(value) {
  return PACES[value] ? value : "test";
}

export class SentientWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const pace = paceFor(event.payload?.pace);
    const liveRequested = event.payload?.live === true;
    const delays = PACES[pace];
    const runId = event.instanceId;

    await step.sleep("wait before watching", delays[0]);
    await step.do("scene watching", async () => {
      await sceneWatching(this.env, runId);
      return { scene: "watching" };
    });

    await step.sleep("wait before vault echo", delays[1]);
    await step.do("scene vault echo", async () => {
      await sceneVaultEcho(this.env, runId);
      return { scene: "vault_echo" };
    });

    await step.sleep("wait before second signal", delays[2]);
    await step.do("scene err02 signal", async () => {
      await sceneSecondSignalOpen(this.env, runId);
      return { scene: "second_signal_open" };
    });

    await step.sleep("err02 response pause", "6 seconds");
    await step.do("scene bartender warning", async () => {
      await sceneSecondSignalReply(this.env, runId);
      return { scene: "second_signal_reply" };
    });

    await step.sleep("wait before breach", delays[3]);
    const breachState = await step.do("scene breach", async () => {
      return sceneBreach(this.env, runId);
    });

    await step.sleep("wait before finale", delays[4]);
    const finaleState = await step.do("scene finale", async () => {
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
      pingedEveryone: finaleState.pingedEveryone,
    };
  }
}
