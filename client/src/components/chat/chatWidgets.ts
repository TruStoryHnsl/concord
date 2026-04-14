import type { Reaction } from "../../hooks/useMatrix";

export type PollWidget = {
  kind: "poll";
  question: string;
  options: string[];
};

export type ChecklistWidget = {
  kind: "checklist";
  title: string;
  items: string[];
};

export type StatusWidget = {
  kind: "status";
  title: string;
  summary: string;
  tone: "info" | "success" | "warning" | "error";
};

export type ChatWidget = PollWidget | ChecklistWidget | StatusWidget;

export const POLL_REACTION_EMOJIS = [
  "1️⃣",
  "2️⃣",
  "3️⃣",
  "4️⃣",
  "5️⃣",
  "6️⃣",
  "7️⃣",
  "8️⃣",
] as const;

export function parseWidgetComposerCommand(input: string): {
  body: string;
  widget?: ChatWidget;
} {
  const trimmed = input.trim();
  if (trimmed.startsWith("/poll ")) {
    const parts = trimmed.slice("/poll ".length).split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const [question, ...options] = parts;
      return {
        body: `# Poll\n\n**${question}**\n\n${options.map((option, index) => `${index + 1}. ${option}`).join("\n")}`,
        widget: { kind: "poll", question, options: options.slice(0, POLL_REACTION_EMOJIS.length) },
      };
    }
  }

  if (trimmed.startsWith("/checklist ")) {
    const parts = trimmed.slice("/checklist ".length).split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const [title, ...items] = parts;
      return {
        body: `# Checklist\n\n**${title}**\n\n${items.map((item) => `- [ ] ${item}`).join("\n")}`,
        widget: { kind: "checklist", title, items },
      };
    }
  }

  if (trimmed.startsWith("/status ")) {
    const parts = trimmed.slice("/status ".length).split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const [title, summary, rawTone] = parts;
      const tone = normalizeStatusTone(rawTone);
      return {
        body: `# Status\n\n**${title}**\n\n${summary}`,
        widget: { kind: "status", title, summary, tone },
      };
    }
  }

  return { body: input };
}

export function normalizeStatusTone(raw: string): StatusWidget["tone"] {
  const value = raw.trim().toLowerCase();
  if (value === "success" || value === "healthy" || value === "green") return "success";
  if (value === "warning" || value === "yellow") return "warning";
  if (value === "error" || value === "critical" || value === "red") return "error";
  return "info";
}

export function validateChatWidget(raw: unknown):
  | { ok: true; value: ChatWidget }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "widget payload must be an object" };
  }

  const widget = raw as Record<string, unknown>;
  const kind = widget.kind;
  if (kind === "poll") {
    if (typeof widget.question !== "string" || !Array.isArray(widget.options)) {
      return { ok: false, error: "poll widget requires question + options" };
    }
    if (
      widget.options.length < 2 ||
      widget.options.length > POLL_REACTION_EMOJIS.length ||
      !widget.options.every((option) => typeof option === "string" && option.trim().length > 0)
    ) {
      return { ok: false, error: "poll widget options must be 2-8 non-empty strings" };
    }
    return {
      ok: true,
      value: {
        kind,
        question: widget.question,
        options: widget.options as string[],
      },
    };
  }

  if (kind === "checklist") {
    if (typeof widget.title !== "string" || !Array.isArray(widget.items)) {
      return { ok: false, error: "checklist widget requires title + items" };
    }
    if (!widget.items.every((item) => typeof item === "string" && item.trim().length > 0)) {
      return { ok: false, error: "checklist items must be non-empty strings" };
    }
    return {
      ok: true,
      value: {
        kind,
        title: widget.title,
        items: widget.items as string[],
      },
    };
  }

  if (kind === "status") {
    if (typeof widget.title !== "string" || typeof widget.summary !== "string") {
      return { ok: false, error: "status widget requires title + summary" };
    }
    return {
      ok: true,
      value: {
        kind,
        title: widget.title,
        summary: widget.summary,
        tone: normalizeStatusTone(String(widget.tone ?? "info")),
      },
    };
  }

  return { ok: false, error: `unsupported widget kind: ${String(kind)}` };
}

export function getPollVoteSummary(
  reactions: Reaction[],
  options: string[],
  currentUserId: string | null,
) {
  return options.map((option, index) => {
    const emoji = POLL_REACTION_EMOJIS[index];
    const reaction = reactions.find((entry) => entry.emoji === emoji);
    return {
      emoji,
      option,
      count: reaction?.count ?? 0,
      selected: currentUserId ? Boolean(reaction?.userIds.includes(currentUserId)) : false,
      reactionEventId: currentUserId ? reaction?.eventIds[currentUserId] ?? null : null,
    };
  });
}

