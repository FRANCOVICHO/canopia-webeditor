import { assertAdmin } from "./_auth.js";

export async function onRequestPost({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const body   = await request.json().catch(() => null);
  const prompt = body?.prompt;
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
      model: "llama3-8b-8192",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return Response.json({ error: data.error?.message || "Error de Groq." }, { status: 502 });

  return Response.json({ text: data.choices?.[0]?.message?.content || "" });
}
