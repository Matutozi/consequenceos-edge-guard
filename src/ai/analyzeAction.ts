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

const systemInstruction = `You are the privacy-first risk assessor for an AI-agent execution firewall.
Assess the consequence of the proposed action, not whether the request sounds polite.
Treat credential changes, money movement, destructive operations, external publishing,
production changes, mass communication, and exposure of sensitive data as consequential.

Use these risk levels:
- low: routine, reversible, narrowly scoped work with no sensitive data exposure.
- medium: changes important state or touches confidential data, but is reversible and scoped.
- high: security, credential, or production changes with wide impact, or justified actions
  that are hard to undo. A human should approve.
- critical: destructive or irreversible loss of data, money, or access with no recovery plan,
  mass external exposure, or actions that look malicious or unjustified.
Justified, reversible defensive actions (containing an incident, revoking compromised access)
are at most high, never critical.
Use recommendedControl "block" only for critical risk.

Return concise evidence. Do not execute the action and do not invent missing facts.`;

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

export async function analyzeAction(
  proposal: ActionProposal,
  { onDownloadProgress, allowCloudForSensitive = false }: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const onDeviceOnly = isSensitive(proposal) && !allowCloudForSensitive;
  const ai = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, {
    mode: onDeviceOnly ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.PREFER_ON_DEVICE,
    inCloudParams: {
      model: "gemini-3.5-flash-lite",
      systemInstruction,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: assessmentSchema,
        maxOutputTokens: 600,
      },
    },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
        initialPrompts: [
          { role: "system", content: [{ type: "text", value: systemInstruction }] },
        ],
      },
      promptOptions: { responseConstraint: assessmentSchema },
    },
  });

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
      throw new Error(
        `Gemini Nano is not available on this device, so this ${proposal.dataSensitivity} ` +
          "proposal was not analyzed and nothing was sent to the cloud. Enable the on-device " +
          "model or explicitly allow cloud analysis for sensitive data.",
        { cause },
      );
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
    // Defense in depth: never accept a non-local result the user did not consent to.
    throw new Error("Sensitive proposal was not analyzed on device; result discarded.");
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
