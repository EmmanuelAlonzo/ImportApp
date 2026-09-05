import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Convierte una clave privada en formato PKCS#1 a envoltorio PKCS#8 para WebCrypto si fuese necesario
function pkcs1ToPkcs8(pkcs1Bytes: Uint8Array): Uint8Array {
  const algorithmIdentifier = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ]);

  function encodeLength(len: number): Uint8Array {
    if (len < 128) return new Uint8Array([len]);
    if (len < 256) return new Uint8Array([0x81, len]);
    return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
  }

  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const octetStringHeader = new Uint8Array([
    0x04,
    ...encodeLength(pkcs1Bytes.length),
  ]);

  const inner = new Uint8Array([
    ...version,
    ...algorithmIdentifier,
    ...octetStringHeader,
    ...pkcs1Bytes,
  ]);

  const sequenceHeader = new Uint8Array([0x30, ...encodeLength(inner.length)]);
  return new Uint8Array([...sequenceHeader, ...inner]);
}

// Sanitiza y decodifica robustamente el PEM de GOOGLE_PRIVATE_KEY a Uint8Array
function cleanPrivateKey(rawKey: string): Uint8Array {
  if (!rawKey) {
    throw new Error("GOOGLE_PRIVATE_KEY no está configurada.");
  }

  let key = rawKey.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }

  key = key.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
  key = key
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  key = key.replace(/[^A-Za-z0-9+/=_-]/g, "");
  key = key.replace(/-/g, "+").replace(/_/g, "/");

  const remainder = key.length % 4;
  if (remainder === 2) {
    key += "==";
  } else if (remainder === 3) {
    key += "=";
  }

  try {
    const binaryString = atob(key);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (err: any) {
    throw new Error(`Fallo al decodificar base64 de GOOGLE_PRIVATE_KEY: ${err.message}`);
  }
}

async function getGoogleAccessToken(): Promise<string> {
  const clientEmail = Deno.env.get("GOOGLE_CLIENT_EMAIL")!;
  const rawKey = Deno.env.get("GOOGLE_PRIVATE_KEY")!;

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope:
      "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const header = encode({ alg: "RS256", typ: "JWT" });
  const payload = encode(claim);
  const signingInput = `${header}.${payload}`;

  const binaryKey = cleanPrivateKey(rawKey);

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      binaryKey.buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (pkcs8Err: any) {
    try {
      const pkcs8Wrapped = pkcs1ToPkcs8(binaryKey);
      cryptoKey = await crypto.subtle.importKey(
        "pkcs8",
        pkcs8Wrapped.buffer as ArrayBuffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );
    } catch {
      throw new Error(`Error importando la clave privada: ${pkcs8Err.message}`);
    }
  }

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const encodedSig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${signingInput}.${encodedSig}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token)
    throw new Error(`Auth failed: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

// Descubrimiento autónomo global mediante Google Drive API v3
async function discoverActiveSheet(accessToken: string): Promise<string> {
  const query = encodeURIComponent(
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=modifiedTime desc&pageSize=10&fields=files(id,name,modifiedTime,createdTime)`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Google Drive API Error: ${JSON.stringify(data.error)}`);
  }
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  throw new Error(
    "No se encontró ningún archivo de Google Sheets activo en la cuenta de servicio de Google Drive.",
  );
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();

    let recordsToProcess: any[] = [];

    // Caso 1: Sincronización masiva forzada de todos los verificados pendientes en DB
    if (body.sync_all_pending === true) {
      const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      let query = supabaseClient
        .from("registros_importacion")
        .select("*")
        .eq("is_verified", true)
        .not("row_number", "is", null);

      if (!body.force_all) {
        query = query.is("last_sync", null);
      }

      const { data: dbRecords, error: dbErr } = await query;

      if (dbErr) {
        throw new Error(`Error consultando registros en Supabase: ${dbErr.message}`);
      }
      recordsToProcess = dbRecords || [];
    } else if (Array.isArray(body.records)) {
      // Caso 2: Lote explícito de registros (batch de 10)
      recordsToProcess = body.records;
    } else if (Array.isArray(body)) {
      recordsToProcess = body;
    } else {
      // Caso 3: Registro individual (webhook o llamada directa)
      const record = body.record || body;
      const oldRecord = body.old_record || {};

      // Protección frente a múltiples triggers concurrentes si viene de webhook
      if (
        body.type === "UPDATE" &&
        oldRecord.is_verified === record.is_verified
      ) {
        return new Response(
          JSON.stringify({ message: "Ignorado: Sin cambio en verificación" }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      recordsToProcess = [record];
    }

    // Filtrar únicamente los verificados que posean row_number
    const validRecords = recordsToProcess.filter(
      (r) => r && r.is_verified && r.row_number,
    );

    if (validRecords.length === 0) {
      return new Response(
        JSON.stringify({
          message: "Nada que escribir (no hay registros verificados con row_number)",
          count: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const accessToken = await getGoogleAccessToken();

    // 1. Resolver spreadsheet_id
    let spreadsheet_id = validRecords[0]?.spreadsheet_id || body.spreadsheet_id;

    if (!spreadsheet_id) {
      try {
        const supabaseClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data: settings, error: settingsError } = await supabaseClient
          .from("app_settings")
          .select("active_spreadsheet_id")
          .eq("id", 1)
          .single();

        if (!settingsError && settings?.active_spreadsheet_id) {
          spreadsheet_id = settings.active_spreadsheet_id;
        }
      } catch (dbErr) {
        console.error("Error consultando app_settings en DB:", dbErr.message);
      }
    }

    // 2. Si sigue sin existir, descubrir dinámicamente vía Drive API (último modificado)
    if (!spreadsheet_id) {
      console.log(
        "Resolviendo spreadsheet_id de forma autónoma desde Google Drive...",
      );
      spreadsheet_id = await discoverActiveSheet(accessToken);
    }

    if (!spreadsheet_id) {
      throw new Error(
        "No se pudo resolver el spreadsheet_id para la escritura en Sheets.",
      );
    }

    // 3. Mapear cada registro a su rango de celdas H:J
    const updateRanges = validRecords.map((item) => {
      const date = new Date(item.verified_at || Date.now());
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const hh = String(date.getHours()).padStart(2, "0");
      const min = String(date.getMinutes()).padStart(2, "0");
      const ss = String(date.getSeconds()).padStart(2, "0");
      const formattedDate = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;

      const sheetName = item.sheet_name || "Hoja1";
      const rowNum = item.row_number;
      const verifiedBy = item.verified_by || "Operador";

      return {
        range: `${sheetName}!H${rowNum}:J${rowNum}`,
        values: [[true, formattedDate, verifiedBy]],
      };
    });

    // 4. Actualizar columnas H (checkbox), I (fecha), J (usuario) utilizando batchUpdate
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values:batchUpdate`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: updateRanges,
      }),
    });

    const result = await res.json();
    if (result.error) {
      throw new Error(
        `Google Sheets API Error: ${JSON.stringify(result.error)}`,
      );
    }

    // 5. Actualizar last_sync = NOW() en Supabase para las filas inyectadas a Google Sheets
    const syncedRecordIds = validRecords.map((r) => r.id).filter(Boolean);
    if (syncedRecordIds.length > 0) {
      try {
        const supabaseClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const nowIso = new Date().toISOString();
        await supabaseClient
          .from("registros_importacion")
          .update({
            last_sync: nowIso,
            updated_at: nowIso,
          })
          .in("id", syncedRecordIds);
      } catch (dbErr: any) {
        console.warn("Aviso actualizando last_sync en Supabase:", dbErr.message);
      }
    }

    return new Response(
      JSON.stringify({
        message: `Sincronización con Google Sheets exitosa. ${updateRanges.length} registros inyectados.`,
        spreadsheet_id,
        count: updateRanges.length,
        updatedCells:
          result.totalUpdatedCells || result.responses?.[0]?.updatedCells,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Error fatal en write-verification:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
