import { config } from '../config';
import type { CategoryScore } from '../types';

/**
 * Optional AI executive-summary layer.
 *
 * The AI receives ONLY structured audit data produced by the deterministic
 * engine and is asked to reword the executive summary. It is never allowed
 * to modify measurements or scores — those come from the engine alone.
 */

interface AiInput {
  url: string;
  grade: string;
  overallScore: number | null;
  categoryScores: Record<string, CategoryScore>;
  issues: { severity: string; title: string; area?: string; section: string }[];
}

export async function runAiSummary(input: AiInput): Promise<string | null> {
  if (!config.ai.apiKey || !config.ai.baseUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
  try {
    const categories = Object.values(input.categoryScores)
      .map((c) => `${c.label}: ${c.score ?? 'n/a'}`)
      .join(', ');
    const topIssues = input.issues
      .slice(0, 8)
      .map((i) => `[${i.severity}] ${i.title}${i.area ? ` (${i.area})` : ''}`)
      .join('; ');
    const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.apiKey}` },
      body: JSON.stringify({
        model: config.ai.model,
        temperature: 0.4,
        max_tokens: 220,
        messages: [
          {
            role: 'system',
            content:
              'You are the report author for a website health audit tool. You write client-friendly executive summaries. You NEVER invent numbers or metrics: use only the data you are given. Reply with a JSON object {"summary": "..."} containing 2–4 sentences. No markdown.',
          },
          {
            role: 'user',
            content: `Website: ${input.url}\nOverall score: ${input.overallScore ?? 'n/a'}/100 (${input.grade})\nCategory scores: ${categories}\nKey findings: ${topIssues || 'none'}\nWrite the executive summary now.`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? '';
    const match = /{[\s\S]*"summary"\s*:\s*"([\s\S]*?)"[\s\S]*}/.exec(content) || /"summary"\s*:\s*"([\s\S]*?)"/.exec(content);
    const summary = match ? match[1] : null;
    if (!summary) return null;
    // Guard rails: strip any injected numeric claims that contradict the data.
    return summary.replace(/["\\]/g, '').trim().slice(0, 700) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
