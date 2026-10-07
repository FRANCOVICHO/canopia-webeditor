/**
 * GET /api/admin/check-config
 *
 * Verifica que todas las variables de entorno necesarias estén configuradas
 * y que el token de GitHub sea válido haciendo una llamada real a la API.
 *
 * Nunca devuelve el valor del token — solo "ok" o el error específico.
 * Usar desde el panel de administración para diagnosticar problemas antes
 * de intentar subir imágenes.
 */

import { assertAdmin } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  const denied = assertAdmin(request, env);
  if (denied) return denied;

  const checks = [];

  // ── 1. GITHUB_TOKEN ────────────────────────────────────────────────────────
  const token  = env.GITHUB_TOKEN;
  const owner  = env.GITHUB_OWNER  || "FRANCOVICHO";
  const repo   = env.GITHUB_REPO   || "photoscanopia";
  const branch = env.GITHUB_BRANCH || "main";

  if (!token) {
    checks.push({
      key:    "GITHUB_TOKEN",
      status: "missing",
      message: "No está configurado. Ir a Cloudflare Pages → Settings → Environment Variables y agregar GITHUB_TOKEN como variable encriptada.",
    });
  } else {
    // Verificar token haciendo GET al repo (no requiere write, solo read)
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "canopia-webeditor/1.0",
        },
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        // Verificar que el token tiene permisos de escritura en Contents
        // La API del repo devuelve permissions si el token tiene acceso
        const canWrite = data.permissions?.push === true;
        checks.push({
          key:     "GITHUB_TOKEN",
          status:  "ok",
          message: `Token válido. Repositorio "${owner}/${repo}" accesible.${canWrite ? " Permisos de escritura confirmados." : " No se pudo confirmar permisos de escritura (normal si el repo es público)."}`,
        });
      } else if (res.status === 401) {
        checks.push({
          key:    "GITHUB_TOKEN",
          status: "error",
          message: "Token inválido o expirado. Generá un nuevo Personal Access Token en GitHub → Settings → Developer Settings → Fine-grained tokens.",
        });
      } else if (res.status === 403) {
        checks.push({
          key:    "GITHUB_TOKEN",
          status: "error",
          message: "Token sin permisos suficientes. Asegurate de que tenga 'Contents: Read and write' en el repositorio photoscanopia.",
        });
      } else if (res.status === 404) {
        checks.push({
          key:    "GITHUB_TOKEN",
          status: "error",
          message: `Repositorio "${owner}/${repo}" no encontrado. Verificá GITHUB_OWNER y GITHUB_REPO.`,
        });
      } else {
        checks.push({
          key:    "GITHUB_TOKEN",
          status: "error",
          message: `GitHub respondió con HTTP ${res.status}.`,
        });
      }
    } catch (err) {
      checks.push({
        key:    "GITHUB_TOKEN",
        status: "error",
        message: `No se pudo conectar con GitHub: ${err.message}`,
      });
    }
  }

  // ── 2. GITHUB_OWNER ────────────────────────────────────────────────────────
  checks.push({
    key:    "GITHUB_OWNER",
    status: owner ? "ok" : "missing",
    value:  owner || null,
    message: owner
      ? `Configurado: "${owner}"`
      : "No configurado. Se usará el valor por defecto: FRANCOVICHO.",
  });

  // ── 3. GITHUB_REPO ─────────────────────────────────────────────────────────
  checks.push({
    key:    "GITHUB_REPO",
    status: repo ? "ok" : "missing",
    value:  repo || null,
    message: repo
      ? `Configurado: "${repo}"`
      : "No configurado. Se usará el valor por defecto: photoscanopia.",
  });

  // ── 4. GITHUB_BRANCH ───────────────────────────────────────────────────────
  checks.push({
    key:    "GITHUB_BRANCH",
    status: "ok",
    value:  branch,
    message: env.GITHUB_BRANCH
      ? `Configurado: "${branch}"`
      : `Usando valor por defecto: "${branch}".`,
  });

  // ── 5. ADMIN_PASSWORD ──────────────────────────────────────────────────────
  // Solo verificar si está configurada como variable de entorno (no hardcodeada)
  const hasEnvPassword = Boolean(env.ADMIN_PASSWORD);
  checks.push({
    key:    "ADMIN_PASSWORD",
    status: hasEnvPassword ? "ok" : "warning",
    message: hasEnvPassword
      ? "Configurada como variable de entorno."
      : "Usando contraseña hardcodeada del código fuente. Recomendado: configurarla como variable encriptada en Cloudflare Pages.",
  });

  // ── Resultado global ───────────────────────────────────────────────────────
  const hasErrors   = checks.some((c) => c.status === "error");
  const hasMissing  = checks.some((c) => c.status === "missing");
  const allOk       = !hasErrors && !hasMissing;

  return Response.json({
    ok:      allOk,
    status:  hasErrors ? "error" : hasMissing ? "incomplete" : "ok",
    summary: allOk
      ? "✓ Todo configurado correctamente. El sistema de imágenes está listo para producción."
      : hasErrors
        ? "✕ Hay errores de configuración. Las subidas a GitHub fallarán."
        : "⚠ Configuración incompleta. Algunas variables no están definidas.",
    checks,
    github: {
      owner,
      repo,
      branch,
      uploadUrl: `https://github.com/${owner}/${repo}`,
      rawBase:   `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`,
    },
  });
}
