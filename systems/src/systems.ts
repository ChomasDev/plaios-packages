import type {
  AIProvider,
  ChoiceQuestion,
  JsonSchema,
  NoulQuestion,
  SystemAnswer,
  SystemAnswers,
  SystemAskOptions,
  SystemQuestion,
  SystemQuestions,
} from "@plaios/core/domain";

export function noul(instructions: unknown, criteria?: NoulQuestion["criteria"]): NoulQuestion {
  return { type: "noul", instructions, ...(criteria ? { criteria } : {}) };
}

export function choice(instructions: unknown, criteria: ChoiceQuestion["criteria"]): ChoiceQuestion {
  return { type: "choice", instructions, criteria };
}

/**
 * System 2 `ask` for any AIProvider: one function call whose arguments are the
 * answers, returned in the System 1 shape so plugins read both the same way.
 */
export async function askWithFunctionCall(
  model: AIProvider,
  state: Record<string, unknown>,
  questions: SystemQuestions,
  options: SystemAskOptions = {},
): Promise<SystemAnswers> {
  const entries = Object.entries(questions);
  const result = await model.functionCall<Record<string, unknown>>(
    JSON.stringify({ state, questions: Object.fromEntries(entries.map(([key, q]) => [key, describe(q)])) }),
    {
      name: "answer_questions",
      description: "Answer every question about `state`. Yes/no questions get a probability from 0 to 1; choice questions get one of the listed labels.",
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(entries.map(([key, q]) => [key, answerSchema(q)])),
        required: entries.map(([key]) => key),
        additionalProperties: false,
      },
      strict: true,
    },
    { signal: options.signal },
  );
  return Object.fromEntries(entries.map(([key, q]) => [key, toAnswer(q, result.arguments?.[key])]));
}

function describe(question: SystemQuestion): unknown {
  return question.type === "choice"
    ? { question: question.instructions, choices: question.criteria }
    : { question: question.instructions, criteria: question.criteria ?? null };
}

function answerSchema(question: SystemQuestion): JsonSchema {
  if (question.type === "choice") return { type: "string", enum: Object.keys(question.criteria) };
  return { type: "number", minimum: 0, maximum: question.type === "score" ? question.criteria.length - 1 : 1 };
}

function toAnswer(question: SystemQuestion, value: unknown): SystemAnswer {
  if (question.type === "choice") {
    return typeof value === "string" && value in question.criteria ? { type: "choice", choice: value } : {};
  }
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return question.type === "noul"
    ? { type: "noul", noul: Math.min(1, Math.max(0, number)) }
    : { type: "score", score: number };
}

export function noulOf(answers: SystemAnswers, key: string): number {
  const answer = answers[key];
  return answer?.type === "noul" && typeof answer.noul === "number" ? answer.noul : 0;
}

export function compactTurns(
  value: ReadonlyArray<{ role?: string; content?: string } | null | undefined> | undefined,
  limit: number,
): Array<{ role: string; content: string }> {
  return (value ?? []).flatMap((entry) => {
    const role = entry?.role?.trim();
    const content = entry?.content?.trim();
    return role && content ? [{ role, content }] : [];
  }).slice(-limit);
}
