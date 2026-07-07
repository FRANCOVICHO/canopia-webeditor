import { assertAdmin } from "./_auth.js";

// max_tokens por tipo de request
const TOKEN_LIMITS = {
  report: 800,
  notif:  150,
};

export async function onRequestPost({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const body   = await request.json().catch(() => null);
  const prompt = body?.prompt;
  const type   = body?.type || "report"; // "report" | "notif"
  if (!prompt) return Response.json({ error: "Falta el prompt." }, { status: 400 });

  const groqKey = env.GROQ_API_KEY;
  if (!groqKey) return Response.json({ error: "GROQ_API_KEY no configurada en Cloudflare." }, { status: 500 });

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",   // modelo más rápido de Groq
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: TOKEN_LIMITS[type] ?? 800,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return Response.json({ error: data.error?.message || "Error de Groq." }, { status: 502 });

  return Response.json({ text: data.choices?.[0]?.message?.content || "" });
}
