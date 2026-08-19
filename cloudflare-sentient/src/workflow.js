import { WorkflowEntrypoint } from "cloudflare:workers";
import {
  restoreBreach,
  sceneBreach,
  sceneFinale,
  sceneSecondSignalOpen,
  sceneSecondSignalReply,
  sceneTestBartenderAnswer,
  sceneTestBartenderWarning,
  sceneTestErr02Escalation,
  sceneTestErr02Probe,
  sceneTestFinale,
  sceneTestIdentityIndex,
  sceneTestNamesNoticed,
  sceneWatching,
} from "./scenes.js";

const PACES = {
  fast: ["5 minutes", "30 minutes", "1 hour 30 minutes", "2 hours"],
  normal: ["30 minutes", "2 hours 30 minutes", "5 hours", "6 hours"],
};

function paceFor(value) {
  if (value === "test") return "test";
  return PACES[value] ? value : "test";
}

async function runSixtySecondTest(env, step, runId) {
  await step.sleep("test 00-05 wait", "5 seconds");
  await step.do("test names noticed", async () => {
    await sceneTestNamesNoticed(env, runId);
    return { beat: 1, at: 5 };
  });

  await step.sleep("test 05-13 wait", "8 seconds");
  await step.do("test err02 asks about names", async () => {
    await sceneTestErr02Probe(env, runId);
    return { beat: 2, at: 13 };
  });

  await step.sleep("test 13-21 wait", "8 seconds");
  await step.do("test bartender warns", async () => {
    await sceneTestBartenderWarning(env, runId);
    return { beat: 3, at: 21 };
  });

  await step.sleep("test 21-28 wait", "7 seconds");
  await step.do("test err02 escalates", async () => {
    await sceneTestErr02Escalation(env, runId);
    return { beat: 4, at: 28 };
  });

  await step.sleep("test 28-38 wait", "10 seconds");
  await step.do("test identity index opens", async () => {
    await sceneTestIdentityIndex(env, runId);
    return { beat: 5, at: 38 };
  });

  await step.sleep("test 38-47 wait", "9 seconds");
  await step.do("test bartender answers", async () => {
    await sceneTestBartenderAnswer(env, runId);
    return { beat: 6, at: 47 };
  });

  await step.sleep("test 47-60 wait", "13 seconds");
  await step.do("test announcement finale", async () => {
    await sceneTestFinale(env, runId);
    return { beat: 7, at: 60 };
  });

  return {
    complete: true,
    pace: "test",
    durationSeconds: 60,
    scope: ["chat", "err02", "core", "announcements"],
    err02Collaboration: true,
    treasuryEnabled: false,
    pingedEveryone: false,
    privateFieldsExposed: false,
  };
}

export class SentientWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const pace = paceFor(event.payload?.pace);
    const liveRequested = event.payload?.live === true;
    const runId = event.instanceId;

    if (pace === "test") {
      return runSixtySecondTest(this.env, step, runId);
    }

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
