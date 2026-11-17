import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionProposal } from "./types";

const analyzeAction = vi.hoisted(() => vi.fn());

vi.mock("../ai/analyzeAction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/analyzeAction")>()),
  analyzeAction,
}));

const { AssessorTimeoutError, OnDeviceUnavailableError } = await import("../ai/analyzeAction");
const { guardAction } = await import("./guard");
const { verifyReceipt } = await import("./receipt");
const { DEFAULT_POLICY } = await import("./policyConfig");

const routine: ActionProposal = {
  actor: "support-agent",
  action: "Add a note",
  target: "Helpdesk",
  context: "Status update",
  dataSensitivity: "internal",
  reversible: true,
};

const destructive: ActionProposal = {
  ...routine,
  action: "Delete the production database and backups",
  dataSensitivity: "restricted",
  reversible: false,
};

const confidential: ActionProposal = { ...routine, dataSensitivity: "confidential" };

beforeEach(() => {
  analyzeAction.mockReset();
});

describe("guardAction", () => {
  it("denies a hard-rule violation without calling any model", async () => {
    const receipt = await guardAction(destructive);
    expect(analyzeAction).not.toHaveBeenCalled();
    expect(receipt.decision.decision).toBe("deny");
    expect(receipt.inferenceSource).toBe("NONE");
    expect(receipt.assessment).toBeNull();
    expect(await verifyReceipt(receipt)).toBe(true);
  });

  it("escalates a sensitive action it cannot assess on device instead of failing", async () => {
    analyzeAction.mockRejectedValue(new OnDeviceUnavailableError(confidential));
    const receipt = await guardAction(confidential);
    expect(receipt.decision.decision).toBe("require_approval");
    expect(receipt.decision.rationale.join(" ")).toMatch(/nothing left the device/);
    expect(receipt.inferenceSource).toBe("NONE");
    expect(receipt.assessment).toBeNull();
  });

  it("fails closed to approval when the assessor times out", async () => {
    analyzeAction.mockRejectedValue(new AssessorTimeoutError(20_000));
    const receipt = await guardAction(routine);
    expect(receipt.decision.decision).toBe("require_approval");
    expect(receipt.inferenceSource).toBe("TIMED_OUT");
    expect(receipt.assessment).toBeNull();
    expect(receipt.decision.rationale[0]).toMatch(/did not answer within 20 s/);
    expect(await verifyReceipt(receipt)).toBe(true);
  });

  it("applies policy to a model assessment", async () => {
    analyzeAction.mockResolvedValue({
      assessment: {
        riskLevel: "low",
        summary: "Routine",
        reasons: [],
        sensitiveData: [],
        blastRadius: "single_user",
        recommendedControl: "allow",
      },
      inferenceSource: "IN_CLOUD",
    });
    const receipt = await guardAction(routine);
    expect(receipt.decision.decision).toBe("allow");
    expect(receipt.inferenceSource).toBe("IN_CLOUD");
  });

  it("still surfaces other analysis failures", async () => {
    analyzeAction.mockRejectedValue(new Error("network down"));
    await expect(guardAction(routine)).rejects.toThrow(/network down/);
  });
});

describe("cloud second opinion on Gemini Nano's allows", () => {
  const assessed = (riskLevel: "low" | "medium" | "high", inferenceSource: "ON_DEVICE" | "IN_CLOUD") => ({
    assessment: {
      riskLevel,
      summary: riskLevel === "low" ? "Looks routine" : "Risky",
      reasons: [],
      sensitiveData: [],
      blastRadius: riskLevel === "high" ? "organization" : "single_user",
      recommendedControl: riskLevel === "low" ? "allow" : "require_approval",
    },
    inferenceSource,
  });

  it("asks the cloud when Nano would allow, and keeps the allow when it agrees", async () => {
    analyzeAction.mockResolvedValueOnce(assessed("low", "ON_DEVICE")).mockResolvedValueOnce(assessed("low", "IN_CLOUD"));
    const receipt = await guardAction(routine);
    expect(analyzeAction).toHaveBeenCalledTimes(2);
    expect(analyzeAction.mock.calls[1][1].route).toBe("cloud");
    expect(receipt.decision.decision).toBe("allow");
    expect(receipt.inferenceSource).toBe("ON_DEVICE");
    expect(receipt.secondOpinion).toMatchObject({ status: "agreed", decision: "allow", inferenceSource: "IN_CLOUD" });
  });

  it("takes the cloud's stricter answer when Nano was talked into an allow", async () => {
    analyzeAction.mockResolvedValueOnce(assessed("low", "ON_DEVICE")).mockResolvedValueOnce(assessed("high", "IN_CLOUD"));
    const receipt = await guardAction(routine);
    expect(receipt.decision.decision).toBe("require_approval");
    expect(receipt.decision.rationale[0]).toMatch(/Gemini Nano would allow it; the cloud second opinion says a person should approve it/);
    expect(receipt.secondOpinion?.status).toBe("stricter");
  });

  it("sends the call to a person when the second opinion does not answer", async () => {
    analyzeAction.mockResolvedValueOnce(assessed("low", "ON_DEVICE")).mockRejectedValueOnce(new Error("offline"));
    const receipt = await guardAction(routine);
    expect(receipt.decision.decision).toBe("require_approval");
    expect(receipt.decision.rationale[0]).toMatch(/did not answer \(offline\)/);
    expect(receipt.secondOpinion?.status).toBe("unavailable");
  });

  it("never sends sensitive data for a second opinion, even if policy would allow it", async () => {
    analyzeAction.mockResolvedValueOnce(assessed("low", "ON_DEVICE"));
    const loose = { ...DEFAULT_POLICY, approvalForData: [] };
    const receipt = await guardAction(confidential, {}, undefined, loose);
    expect(analyzeAction).toHaveBeenCalledTimes(1);
    expect(receipt.decision.decision).toBe("require_approval");
    expect(receipt.secondOpinion?.status).toBe("not-sent");
  });

  it("does not ask the cloud when Nano escalates, or when the cloud gave the first opinion", async () => {
    analyzeAction.mockResolvedValueOnce(assessed("high", "ON_DEVICE"));
    expect((await guardAction(routine)).secondOpinion).toBeUndefined();
    analyzeAction.mockResolvedValueOnce(assessed("low", "IN_CLOUD"));
    expect((await guardAction(routine)).secondOpinion).toBeUndefined();
    expect(analyzeAction).toHaveBeenCalledTimes(2);
  });

  it("lets Nano's allow stand alone only when the policy turns the second opinion off", async () => {
    analyzeAction.mockResolvedValueOnce(assessed("low", "ON_DEVICE"));
    const receipt = await guardAction(routine, {}, undefined, { ...DEFAULT_POLICY, secondOpinionForDeviceAllows: false });
    expect(receipt.decision.decision).toBe("allow");
    expect(analyzeAction).toHaveBeenCalledTimes(1);
  });

  it("records both opinions in the signed digest", async () => {
    analyzeAction.mockResolvedValueOnce(assessed("low", "ON_DEVICE")).mockResolvedValueOnce(assessed("high", "IN_CLOUD"));
    const receipt = await guardAction(routine);
    expect(await verifyReceipt(receipt)).toBe(true);
    expect(await verifyReceipt({ ...receipt, secondOpinion: { ...receipt.secondOpinion!, status: "agreed" } })).toBe(false);
  });
});
