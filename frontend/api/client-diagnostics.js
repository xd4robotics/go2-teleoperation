export default function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Método não permitido." });
    return;
  }
  const message = String(request.body?.message || "erro desconhecido").slice(0, 500);
  const state = String(request.body?.state || "unknown").slice(0, 80);
  console.error(`LiveKit browser failure [${state}]: ${message}`);
  response.status(204).end();
}
