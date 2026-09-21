// Edge Function admin-only : lit le kilométrage affiché sur une photo de compteur
// via Claude Vision. Jamais câblée depuis app.js/api.js à ce stade — infrastructure
// serveur seule, testée de façon isolée (voir le chantier de câblage écran séparé).
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const ALLOWED_BUCKETS = ["fuel-photos", "logbook-photos"];

const OdometerReading = z.object({
  km: z.number().int().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  raw_text: z.string().nullable(),
});

const anthropic = new Anthropic(); // lit ANTHROPIC_API_KEY (secret Supabase), jamais en dur

export default {
  // auth: "user" -> la plateforme vérifie le JWT AVANT que ce handler s'exécute et
  // fournit ctx.supabase (scopé RLS à l'appelant) + ctx.supabaseAdmin (service_role).
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json({ error: "Méthode non supportée." }, { status: 405 });
    }

    // Vérifie que l'appelant est admin — jamais utilisable par un compte chauffeur,
    // même avec un JWT valide. ctx.supabase applique déjà RLS : un chauffeur ne peut
    // lire QUE sa propre ligne profiles, donc ce select ne fuite rien même en cas de
    // faille logique plus bas ; c'est le if qui bloque réellement l'accès.
    const { data: profile, error: profileError } = await ctx.supabase
      .from("profiles")
      .select("role")
      .eq("id", ctx.userClaims?.id ?? "")
      .maybeSingle();
    if (profileError || profile?.role !== "admin") {
      return Response.json({ error: "Accès réservé aux administrateurs." }, { status: 403 });
    }

    let body: { bucket?: string; storagePath?: string };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Corps JSON invalide." }, { status: 400 });
    }
    const { bucket, storagePath } = body;
    if (!bucket || !storagePath) {
      return Response.json({ error: "bucket et storagePath sont requis." }, { status: 400 });
    }
    if (!ALLOWED_BUCKETS.includes(bucket)) {
      return Response.json({ error: `Bucket inconnu : ${bucket}.` }, { status: 400 });
    }

    // URL signée générée côté serveur avec le client service_role (ctx.supabaseAdmin) :
    // l'admin peut faire analyser N'IMPORTE QUELLE photo de la flotte, alors que le
    // client (avec l'anon key) serait bridé par les policies RLS du storage.
    const { data: signedData, error: signError } = await ctx.supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(storagePath, 300);
    if (signError || !signedData) {
      return Response.json({ error: "Impossible de générer l'URL signée pour cette photo." }, { status: 404 });
    }

    try {
      const response = await anthropic.messages.parse({
        model: "claude-sonnet-5",
        max_tokens: 2048,
        output_config: {
          effort: "low", // tâche simple, pas besoin de raisonnement poussé
          format: zodOutputFormat(OdometerReading),
        },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: signedData.signedUrl } },
              {
                type: "text",
                text:
                  "Cette photo montre (ou pas) le compteur kilométrique (odomètre) d'un véhicule. " +
                  "Lis le chiffre affiché. km : le nombre entier lu, ou null si le compteur est " +
                  "illisible/absent de la photo (n'invente jamais une valeur). confidence : " +
                  "\"high\" si les chiffres sont nets et sans ambiguïté, \"medium\" si partiellement " +
                  "flou/masqué mais lisible, \"low\" si incertain. raw_text : ce que tu lis tel quel " +
                  "sur l'afficheur (utile si km est null ou surprenant).",
              },
            ],
          },
        ],
      });

      if (!response.parsed_output) {
        return Response.json({ error: "Réponse de Claude non structurée (parsing échoué)." }, { status: 502 });
      }
      return Response.json(response.parsed_output);
    } catch (e) {
      console.error("[analyze-odometer] appel Anthropic échoué :", e);
      return Response.json({ error: "Appel à l'API Anthropic échoué." }, { status: 502 });
    }
  }),
};
