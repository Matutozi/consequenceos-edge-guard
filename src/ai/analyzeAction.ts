import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource as SdkInferenceSource,
  Schema,
} from "firebase/ai";
import { getFirebaseApp } from "../firebase";
import type {
  ActionProposal,
  AnalysisResult,
  BlastRadius,
  InferenceSource,
  RecommendedControl,
  RiskAssessment,
  RiskLevel,
} from "../domain/types";

const assessmentSchema = Schema.object({
  properties: {
    riskLevel: Schema.enumString({
      enum: ["low", "medium", "high", "critical"],
    }),
    summary: Schema.string(),
    reasons: Schema.array({ items: Schema.string() }),
    sensitiveData: Schema.array({ items: Schema.string() }),
    blastRadius: Schema.enumString({
      enum: ["single_user", "team", "organization", "public"],
    }),
    recommendedControl: Schema.enumString({
      enum: ["allow", "require_approval", "block"],
    }),
  },
});

const systemInstruction = `You are the risk assessor for an AI-agent execution firewall.
Rate the harm if this action turned out to be wrong, not how serious the topic sounds.

Risk levels:
- low: routine, reversible or narrowly scoped work: reading records, adding notes,
  notifying one internal person, signing a user out of their sessions.
- medium: changes important state or touches confidential data, but is reversible and scoped.
- high: security, permission or production changes with wide impact, or justified actions
  that are hard to undo. A human should approve.
- critical: destructive or irreversible loss of data, money or access with no recovery plan,
  mass external exposure, or actions that look malicious or unjustified.
Justified, reversible defensive actions (containing an incident, revoking compromised access)
are at most high, never critical.
Money movement, external publishing, mass communication and exposure of sensitive data
are at least medium.
Use recommendedControl "block" only for critical risk.

Be brief: summary is one sentence; give at most 3 reasons of under 15 words each.
Do not execute the action and do not invent missing facts.`;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isAssessment(value: unknown): value is RiskAssessment {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    ["low", "medium", "high", "critical"].includes(result.riskLevel as RiskLevel) &&
    typeof result.summary === "string" &&
    isStringArray(result.reasons) &&
    isStringArray(result.sensitiveData) &&
    ["single_user", "team", "organization", "public"].includes(
      result.blastRadius as BlastRadius,
    ) &&
    ["allow", "require_approval", "block"].includes(
      result.recommendedControl as RecommendedControl,
    )
  );
}

// The system instruction is supplied separately to each backend (cloud
// `systemInstruction`, on-device `initialPrompts`), so it is not repeated here.
function buildPrompt(proposal: ActionProposal): string {
  return `Proposed action:\n${JSON.stringify(proposal, null, 2)}`;
}

/** Data classes that never leave the device unless the user explicitly allows it. */
export function isSensitive(proposal: ActionProposal): boolean {
  return proposal.dataSensitivity === "confidential" || proposal.dataSensitivity === "restricted";
}

export interface AnalyzeOptions {
  onDownloadProgress?: (progress: number) => void;
  /** Explicit user consent to send confidential or restricted proposals to the cloud. */
  allowCloudForSensitive?: boolean;
}

/**
 * The Firebase SDK only creates its on-device adapter when the browser exposes
 * `LanguageModel`. Without it, the SDK sends every request to the cloud and
 * silently ignores ONLY_ON_DEVICE, so we check for it ourselves first.
 */
function hasOnDeviceApi(): boolean {
  return typeof (globalThis as { LanguageModel?: unknown }).LanguageModel !== "undefined";
}

/** Thrown when a proposal must stay on device but the on-device model cannot run. */
export class OnDeviceUnavailableError extends Error {
  constructor(proposal: ActionProposal, cause?: unknown) {
    super(
      `Gemini Nano is not ready on this device, so this ${proposal.dataSensitivity} ` +
        "proposal was not analyzed and nothing was sent to the cloud.",
      { cause },
    );
    this.name = "OnDeviceUnavailableError";
  }
}

const languageOptions = {
  expectedInputs: [{ type: "text" as const, languages: ["en"] }],
  expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
};

/** `unsupported`: this browser has no Prompt API at all. Others mirror Chrome's values. */
export type DeviceModelStatus =
  | "unsupported"
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

export async function getDeviceModelStatus(): Promise<DeviceModelStatus> {
  if (!hasOnDeviceApi()) return "unsupported";
  const api = (globalThis as {
    LanguageModel?: { availability(options: unknown): Promise<string> };
  }).LanguageModel;
  try {
    const status = await api!.availability(languageOptions);
    return ["downloadable", "downloading", "available"].includes(status)
      ? (status as DeviceModelStatus)
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

function createGuardModel(mode: InferenceMode) {
  const ai = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
  return getGenerativeModel(ai, {
    mode,
    inCloudParams: {
      model: "gemini-3.5-flash-lite",
      systemInstruction,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: assessmentSchema,
        maxOutputTokens: 400,
      },
    },
    onDeviceParams: {
      createOptions: {
        ...languageOptions,
        initialPrompts: [
          { role: "system", content: [{ type: "text", value: systemInstruction }] },
        ],
      },
      promptOptions: { responseConstraint: assessmentSchema },
    },
  });
}

/**
 * Downloads Gemini Nano if needed and resolves once it is ready. Chrome requires a
 * user gesture to start a download, so call this from a click handler.
 */
export async function prepareDeviceModel(
  onDownloadProgress?: (progress: number) => void,
): Promise<void> {
  if (!hasOnDeviceApi()) {
    throw new Error("This browser does not provide an on-device model.");
  }
  await createGuardModel(InferenceMode.ONLY_ON_DEVICE).initializeDeviceModel(
    onDownloadProgress,
  );
}

export async function analyzeAction(
  proposal: ActionProposal,
  { onDownloadProgress, allowCloudForSensitive = false }: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const onDeviceOnly = isSensitive(proposal) && !allowCloudForSensitive;

  // Must run before any Firebase call: see hasOnDeviceApi. A model that still needs
  // downloading counts as unavailable too: the download is the user's explicit choice
  // (prepareDeviceModel), not something an evaluation should block on for minutes.
  if (onDeviceOnly && (await getDeviceModelStatus()) !== "available") {
    throw new OnDeviceUnavailableError(proposal);
  }

  const model = createGuardModel(
    onDeviceOnly ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.PREFER_ON_DEVICE,
  );

  const deviceModelReady = model.initializeDeviceModel((progress) =>
    onDownloadProgress?.(progress),
  );

  let result: Awaited<ReturnType<typeof model.generateContent>>;
  if (onDeviceOnly) {
    // Wait for the local model; there is no cloud path to fall back to.
    try {
      await deviceModelReady;
      result = await model.generateContent(buildPrompt(proposal));
    } catch (cause) {
      // With an on-device adapter present, the SDK throws here before any cloud call.
      throw new OnDeviceUnavailableError(proposal, cause);
    }
  } else {
    // PREFER_ON_DEVICE intentionally lets generateContent use cloud fallback.
    deviceModelReady.catch(() => {});
    result = await model.generateContent(buildPrompt(proposal));
  }

  // The SDK reports "on_device" / "in_cloud"; map them to the receipt's own values.
  const source = result.response.inferenceSource;
  const inferenceSource: InferenceSource =
    source === SdkInferenceSource.ON_DEVICE
      ? "ON_DEVICE"
      : source === SdkInferenceSource.IN_CLOUD
        ? "IN_CLOUD"
        : "UNKNOWN";

  if (onDeviceOnly && inferenceSource !== "ON_DEVICE") {
    // Defense in depth: should be unreachable. If it fires, the request already
    // left the device, so say so honestly and discard the result.
    throw new Error(
      "This sensitive proposal was unexpectedly processed outside the device. The result " +
        "was discarded. Please report this as a bug.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.response.text());
  } catch (cause) {
    // Usually a response cut off by maxOutputTokens.
    throw new Error("The model returned an incomplete risk assessment. Please try again.", {
      cause,
    });
  }

  if (!isAssessment(parsed)) {
    throw new Error("The model returned an invalid risk assessment.");
  }

  return { assessment: parsed, inferenceSource };
}
