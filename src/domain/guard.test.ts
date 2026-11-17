import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionProposal } from "./types";

const analyzeAction = vi.hoisted(() => vi.fn());

vi.mock("../ai/analyzeAction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/analyzeAction")>()),
  analyzeAction,
}));

const { OnDeviceUnavailableError } = await import("../ai/analyzeAction");
const { guardAction } = await import("./guard");
const { verifyReceipt } = await import("./receipt");

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
