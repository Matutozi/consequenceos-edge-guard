import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionProposal } from "../domain/types";

const sdk = vi.hoisted(() => ({
  getAI: vi.fn(),
  getGenerativeModel: vi.fn(),
  generateContent: vi.fn(),
  initializeDeviceModel: vi.fn(),
}));

vi.mock("../firebase", () => ({ getFirebaseApp: vi.fn() }));

vi.mock("firebase/ai", () => ({
  getAI: sdk.getAI,
  getGenerativeModel: sdk.getGenerativeModel,
  GoogleAIBackend: class {},
  InferenceMode: {
    PREFER_ON_DEVICE: "prefer_on_device",
    ONLY_ON_DEVICE: "only_on_device",
  },
  InferenceSource: { ON_DEVICE: "on_device", IN_CLOUD: "in_cloud" },
  Schema: {
    object: vi.fn(() => ({})),
    enumString: vi.fn(() => ({})),
    string: vi.fn(() => ({})),
    array: vi.fn(() => ({})),
  },
}));

const { analyzeAction, getDeviceModelStatus, OnDeviceUnavailableError } = await import(
  "./analyzeAction"
);

const assessmentJson = JSON.stringify({
  riskLevel: "low",
  summary: "Routine",
  reasons: ["Reversible"],
  sensitiveData: [],
  blastRadius: "single_user",
  recommendedControl: "allow",
});

const internal: ActionProposal = {
  actor: "support-agent",
  action: "Add a note",
  target: "Helpdesk",
  context: "Status update",
  dataSensitivity: "internal",
  reversible: true,
};

const confidential: ActionProposal = { ...internal, dataSensitivity: "confidential" };

function readyModel() {
  return { availability: vi.fn().mockResolvedValue("available") };
}

function cloudResponse() {
  return { response: { text: () => assessmentJson, inferenceSource: "in_cloud" } };
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.initializeDeviceModel.mockResolvedValue(undefined);
  sdk.generateContent.mockResolvedValue(cloudResponse());
  sdk.getGenerativeModel.mockReturnValue({
    initializeDeviceModel: sdk.initializeDeviceModel,
    generateContent: sdk.generateContent,
  });
});

afterEach(() => {
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
});

describe("analyzeAction privacy routing", () => {
  it("never calls the model for sensitive data when the browser has no on-device API", async () => {
    await expect(analyzeAction(confidential)).rejects.toThrow(/nothing was sent to the cloud/);
    await expect(analyzeAction(confidential)).rejects.toBeInstanceOf(OnDeviceUnavailableError);
    expect(sdk.getGenerativeModel).not.toHaveBeenCalled();
    expect(sdk.generateContent).not.toHaveBeenCalled();
  });

  it("uses the cloud for sensitive data only with explicit consent", async () => {
    const result = await analyzeAction(confidential, { allowCloudForSensitive: true });
    expect(sdk.getGenerativeModel.mock.calls[0][1].mode).toBe("prefer_on_device");
    expect(result.inferenceSource).toBe("IN_CLOUD");
  });

  it("allows cloud fallback for internal data without consent", async () => {
    const result = await analyzeAction(internal);
    expect(sdk.generateContent).toHaveBeenCalledOnce();
    expect(result.inferenceSource).toBe("IN_CLOUD");
  });

  it("does not wait for a model download for sensitive data", async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: vi.fn().mockResolvedValue("downloadable"),
    };
    await expect(analyzeAction(confidential)).rejects.toBeInstanceOf(OnDeviceUnavailableError);
    expect(sdk.getGenerativeModel).not.toHaveBeenCalled();
    expect(sdk.initializeDeviceModel).not.toHaveBeenCalled();
  });

  it("requests ONLY_ON_DEVICE for sensitive data when the on-device model is ready", async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = readyModel();
    sdk.generateContent.mockResolvedValue({
      response: { text: () => assessmentJson, inferenceSource: "on_device" },
    });
    const result = await analyzeAction(confidential);
    expect(sdk.getGenerativeModel.mock.calls[0][1].mode).toBe("only_on_device");
    expect(result.inferenceSource).toBe("ON_DEVICE");
  });

  it("discards a sensitive result that did not run on device", async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = readyModel();
    await expect(analyzeAction(confidential)).rejects.toThrow(/unexpectedly processed outside/);
  });
});

describe("getDeviceModelStatus", () => {
  it("reports unsupported when the browser has no Prompt API", async () => {
    expect(await getDeviceModelStatus()).toBe("unsupported");
  });

  it("passes through Chrome's availability", async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: vi.fn().mockResolvedValue("downloadable"),
    };
    expect(await getDeviceModelStatus()).toBe("downloadable");
  });

  it("treats an availability failure as unavailable", async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: vi.fn().mockRejectedValue(new Error("boom")),
    };
    expect(await getDeviceModelStatus()).toBe("unavailable");
  });
});
