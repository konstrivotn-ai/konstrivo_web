import { GoogleGenAI } from "@google/genai";
import express from "express";
import path from "path";
import { setupV1Router } from "./server/routes/v1";
import { bootstrapAdmin } from "./server/bootstrap";
import { authenticate } from './server/middleware/auth';
import { createLimiter } from './server/middleware/rateLimit';
import { applyCors } from './server/middleware/cors';
import { applySecurityHeaders } from './server/middleware/securityHeaders';
import type { DevisDocument } from './src/types';

// Exportable factory: create an AI estimator handler that accepts an optional aiClient.
export function createAiEstimatorHandler(aiClient?: any) {
  return async function aiEstimatorHandler(req: express.Request, res: express.Response) {
    try {
      const { prompt, currentDevis, region } = req.body as { prompt?: string; currentDevis?: any; region?: string };

      // Basic validation
      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'Prompt required' });
      }
      if (prompt.length > 2000) {
        return res.status(400).json({ error: 'Prompt too long (max 2000 chars)' });
      }
      if (region && typeof region !== 'string') {
        return res.status(400).json({ error: 'Invalid region' });
      }

      // Sanitize currentDevis: include only necessary, non-PII fields
      let sanitizedDevis: Partial<DevisDocument> | null = null;
      if (currentDevis && typeof currentDevis === 'object') {
        sanitizedDevis = {
          projectTitle: typeof currentDevis.projectTitle === 'string' ? currentDevis.projectTitle : undefined,
          country: typeof currentDevis.country === 'string' ? currentDevis.country : undefined,
          currency: typeof currentDevis.currency === 'string' ? currentDevis.currency : undefined,
          region: typeof currentDevis.region === 'string' ? currentDevis.region : region || undefined,
          items: Array.isArray(currentDevis.items)
            ? currentDevis.items.map((it: any) => ({
                trade: it?.trade,
                title: it?.title,
                quantity: it?.quantity,
                unit: it?.unit,
                unitPrice: it?.unitPrice
              }))
            : undefined,
          subtotalMaterials: typeof currentDevis.subtotalMaterials === 'number' ? currentDevis.subtotalMaterials : undefined,
          subtotalLabor: typeof currentDevis.subtotalLabor === 'number' ? currentDevis.subtotalLabor : undefined,
          total: typeof currentDevis.total === 'number' ? currentDevis.total : undefined,
          tvaPercent: typeof currentDevis.tvaPercent === 'number' ? currentDevis.tvaPercent : undefined,
        };
      }

      // If aiClient is not injected, create a real GoogleGenAI client and require GEMINI_API_KEY.
      let client = aiClient;
      if (!client) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          return res.status(503).json({ error: 'AI provider not configured' });
        }
        client = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
      }

      const systemInstructionBase = `You are KONSTRIVO AI, the premier expert Senior Construction Engineer and Quantity Surveyor for Tunisia 2026. Your mission: provide material & labor estimates and practical advice.`;
      const systemInstruction = `${systemInstructionBase}\nCurrent Region context: ${region || 'Tunisie'}\nContext Devis: ${sanitizedDevis ? JSON.stringify(sanitizedDevis) : 'Aucun'}`;

      const modelsToTry = ['gemini-3.6-flash'];
      let generatedText = '';

      for (const modelName of modelsToTry) {
        try {
          const response = await client.models.generateContent({ model: modelName, contents: prompt, config: { systemInstruction, temperature: 0.7 } });
          if (response && (response as any).text) {
            generatedText = (response as any).text;
            break;
          }
        } catch (err) {
          console.warn(`Model ${modelName} failed`);
        }
      }

      if (!generatedText) {
        const cleanPrompt = prompt.toLowerCase();
        let fallbackMsg = `🇹🇳 **KONSTRIVO AI - الحساب الآلي المباشر (تونس 2026)**\\n\\n`;
        if (cleanPrompt.includes('démontable') || cleanPrompt.includes('تفكيكي') || cleanPrompt.includes('60x60')) {
          fallbackMsg += 'حساب سقف مستعار تفكيكي (نمطي) -- استخدام المولد المحلي للردود.';
        } else {
          fallbackMsg += 'أهلاً بك! استخدم وصفاً أو أبعاداً واضحة للحصول على تقدير سريع.';
        }
        generatedText = fallbackMsg;
      }

      res.json({ text: generatedText });
    } catch (err) {
      console.error('Gemini AI Estimator error');
      res.json({ text: `🇹🇳 **KONSTRIVO AI - المساعد الفني**\\n\\nمشكلة داخلية عند تجهيز الرد.` });
    }
  };
}

export async function createApp() {
  const app = express();

  // ── Phase 2 API: /api/v1 (mounted BEFORE Vite/SPA middleware) ──────────
  // Apply security headers first
  applySecurityHeaders(app);

  // Apply CORS before any routes
  applyCors(app);

  app.use(express.json({ limit: '10mb' }));

  // ── Phase 2 API: /api/v1 (mounted BEFORE Vite/SPA middleware) ──────────
  const v1Router = setupV1Router();
  app.use("/api/v1", v1Router);

  // API Routes
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: "KONSTRIVO BTP Tunisia 2026", timestamp: new Date().toISOString() });
  });

  // Gemini AI Construction Estimator Assistant (secured) — single source of truth
  app.post('/api/ai-estimator', authenticate, createLimiter('aiEstimator'), createAiEstimatorHandler());

  // Vite middleware in Development.
  // Dynamic import: the Vercel serverless function (NODE_ENV=production) must
  // never load vite — it is ESM-only and crashes CJS function init there
  // (FUNCTION_INVOCATION_FAILED). Local dev (Node >= 22.12/24) still works.
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

async function startServer() {
  // ── TEMP DIAGNOSTIC (prints ONLY booleans / non-secrets; never env values) ──
  console.log(
    `[KONSTRIVO][DIAG] RESEND_API_KEY=${Boolean(process.env.RESEND_API_KEY)} EMAIL_FROM=${Boolean(process.env.EMAIL_FROM)} NODE_ENV=${process.env.NODE_ENV}`
  );

  const app = await createApp();

  // Bootstrap admin user from environment variables
  await bootstrapAdmin();

  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[KONSTRIVO] Server running on http://0.0.0.0:${PORT}`);
  });
}

// Start the server only when NOT running on Vercel (local / Render).
// On Vercel, api/index.ts handles requests via serverless functions.
if (!process.env.VERCEL) {
  startServer();
}


