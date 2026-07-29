import type { QuickNotePurpose } from "../models";
import { richTextToPlainText } from "../../utils/richText";

const PURPOSE_LABELS: Record<QuickNotePurpose, string> = {
  scratch: "Scratch note",
  decision: "Decision",
  reference: "Reference",
  idea: "Idea",
  follow_up: "Follow-up",
  observation: "Observation"
};

export function quickNotePurposeLabel(purpose: QuickNotePurpose): string {
  return PURPOSE_LABELS[purpose];
}

export function quickNoteTitle(body: string, max = 88): string {
  const plain = richTextToPlainText(body).replace(/\s+/g, " ").trim();
  if (!plain) return "Untitled note";
  return plain.length <= max ? plain : `${plain.slice(0, max - 1).trimEnd()}…`;
}
