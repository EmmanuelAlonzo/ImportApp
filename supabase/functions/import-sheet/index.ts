import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import * as jose from "https://deno.land/x/jose@v4.14.4/index.ts";

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

interface CleanKeyResult {
  binaryKey: Uint8Array;
  cleanPem: string;
  isPkcs1: boolean;
}

// Sanitiza y decodifica robustamente el PEM de GOOGLE_PRIVATE_KEY a Uint8Array
function cleanPrivateKey(rawKey: string): CleanKeyResult {
  if (!rawKey) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY no está configurada en las variables de entorno de Supabase.",
    );
  }

  let key = rawKey.trim();

  // Logs diagnósticos iniciales
  console.log(`[cleanPrivateKey] Longitud raw inicial: ${key.length}`);
  console.log(
    `[cleanPrivateKey] Primeros 30 chars raw: ${JSON.stringify(key.slice(0, 30))}`,
  );
  console.log(
    `[cleanPrivateKey] Últimos 30 chars raw: ${JSON.stringify(key.slice(-30))}`,
  );

  // 1. Detectar si el contenido es un JSON completo de Service Account (o empieza con {)
  if (
    key.startsWith("{") ||
    key.includes('"private_key"') ||
    key.includes('\\"private_key\\"')
  ) {
    console.log(
      "[cleanPrivateKey] Detectado JSON de Service Account de Google. Extrayendo 'private_key'...",
    );
    try {
      let jsonCandidate = key;
      if (jsonCandidate.includes('\\"')) {
        jsonCandidate = jsonCandidate.replace(/\\"/g, '"');
      }
      const parsed = JSON.parse(jsonCandidate);
      if (parsed.private_key) {
        key = parsed.private_key.trim();
        console.log(
          `[cleanPrivateKey] 'private_key' extraída del JSON. Nueva longitud: ${key.length}`,
        );
      }
    } catch (e: any) {
      console.warn(
        "[cleanPrivateKey] Intento de parsear JSON falló:",
        e.message,
      );
    }
  }

  // 2. Quitar comillas exteriores si existen (ej. "..." o '...')
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  // 3. Reemplazar saltos de línea escapados literales (\n -> salto real, \r -> retorno)
  key = key.replace(/\\n/g, "\n").replace(/\\r/g, "\r");

  // 4. Detectar si era PKCS#1 (RSA PRIVATE KEY)
  const isPkcs1 =
    /BEGIN (?:RSA )?PRIVATE KEY/.test(key) &&
    !/BEGIN PRIVATE KEY/.test(key);

  // 5. Extraer directamente el bloque PEM si existe
  const pemMatch = key.match(
    /-----BEGIN (?:RSA )?PRIVATE KEY-----([\s\S]*?)-----END (?:RSA )?PRIVATE KEY-----/,
  );
  let base64Body = "";
  if (pemMatch && pemMatch[1]) {
    base64Body = pemMatch[1];
  } else {
    // Si no contiene encabezados estándar, limpiar manualmente
    base64Body = key
      .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, "")
      .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, "");
  }

  // Limpiar cualquier espacio, salto de línea o tabulación
  base64Body = base64Body.replace(/\s+/g, "");

  // 6. Detectar caracteres no válidos antes del saneamiento
  const invalidChars = base64Body.match(/[^A-Za-z0-9+/=_-]/g);
  if (invalidChars && invalidChars.length > 0) {
    console.warn(
      `[cleanPrivateKey] Caracteres no válidos detectados (${invalidChars.length}):`,
      [...new Set(invalidChars)].join(", "),
    );
  }

  // Eliminar cualquier caracter no base64
  base64Body = base64Body.replace(/[^A-Za-z0-9+/=_-]/g, "");
  // Normalizar base64url a base64 estándar
  base64Body = base64Body.replace(/-/g, "+").replace(/_/g, "/");

  // 7. Asegurar padding correcto para base64 (longitud múltiplo de 4)
  const remainder = base64Body.length % 4;
  if (remainder === 2) {
    base64Body += "==";
  } else if (remainder === 3) {
    base64Body += "=";
  } else if (remainder === 1) {
    console.warn(
      "[cleanPrivateKey] Longitud base64 con residuo 1 inválido, recortando último byte sobrante.",
    );
    base64Body = base64Body.slice(0, -1);
  }

  console.log(
    `[cleanPrivateKey] Longitud limpia base64 para decodificar: ${base64Body.length} (módulo 4: ${base64Body.length % 4})`,
  );
  console.log(
    `[cleanPrivateKey] Primeros 30 chars limpios: ${JSON.stringify(base64Body.slice(0, 30))}`,
  );
  console.log(
    `[cleanPrivateKey] Últimos 30 chars limpios: ${JSON.stringify(base64Body.slice(-30))}`,
  );

  // Reconstruir un PEM estándar limpio
  const header = isPkcs1
    ? "-----BEGIN RSA PRIVATE KEY-----"
    : "-----BEGIN PRIVATE KEY-----";
  const footer = isPkcs1
    ? "-----END RSA PRIVATE KEY-----"
    : "-----END PRIVATE KEY-----";
  const cleanPem = `${header}\n${base64Body.match(/.{1,64}/g)?.join("\n") || base64Body}\n${footer}`;

  // 8. Decodificación a Uint8Array
  // Intento A: Deno std decodeBase64
  try {
    const bytes = decodeBase64(base64Body);
    console.log(
      `[cleanPrivateKey] Decodificado exitoso mediante Deno std base64: ${bytes.length} bytes`,
    );
    return { binaryKey: bytes, cleanPem, isPkcs1 };
  } catch (stdErr: any) {
    console.warn(
      `[cleanPrivateKey] decodeBase64 de std falló: ${stdErr.message}, intentando atob...`,
    );
  }

  // Intento B: atob estándar con recorrido de bytes
  try {
    const binaryString = atob(base64Body);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    console.log(
      `[cleanPrivateKey] Decodificado exitoso mediante atob: ${bytes.length} bytes`,
    );
    return { binaryKey: bytes, cleanPem, isPkcs1 };
  } catch (atobErr: any) {
    console.error(
      `[cleanPrivateKey] Fallo en atob: ${atobErr.message}`,
    );
    throw new Error(
      `Fallo al decodificar base64 de GOOGLE_PRIVATE_KEY: ${atobErr.message}`,
    );
  }
}

async function getGoogleAccessToken(): Promise<string> {
  let clientEmail = Deno.env.get("GOOGLE_CLIENT_EMAIL");
  let rawKey = Deno.env.get("GOOGLE_PRIVATE_KEY");

  // Si rawKey contiene el JSON de Service Account, extraer client_email si no estaba en env
  if (
    rawKey &&
    (rawKey.trim().startsWith("{") || rawKey.includes('"client_email"'))
  ) {
    try {
      const parsed = JSON.parse(rawKey.trim());
      if (!clientEmail && parsed.client_email) {
        console.log(
          "[getGoogleAccessToken] Auto-detectado client_email desde el JSON:",
          parsed.client_email,
        );
        clientEmail = parsed.client_email;
      }
    } catch (_) {}
  }

  if (!clientEmail || !rawKey) {
    throw new Error(
      "Faltan credenciales de Google Service Account (GOOGLE_CLIENT_EMAIL o GOOGLE_PRIVATE_KEY).",
    );
  }

  const { binaryKey, cleanPem, isPkcs1 } = cleanPrivateKey(rawKey);

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

  let cryptoKey: CryptoKey | null = null;

  // 1. Intento WebCrypto nativo con binaryKey
  try {
    const keyBytes = isPkcs1 ? pkcs1ToPkcs8(binaryKey) : binaryKey;
    cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      keyBytes.buffer as ArrayBuffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (pkcs8Err: any) {
    console.warn(
      "[getGoogleAccessToken] WebCrypto importKey directo falló:",
      pkcs8Err.message,
    );

    // Si falló y no habíamos probado envolver con pkcs1ToPkcs8
    if (!isPkcs1) {
      try {
        const pkcs8Wrapped = pkcs1ToPkcs8(binaryKey);
        cryptoKey = await crypto.subtle.importKey(
          "pkcs8",
          pkcs8Wrapped.buffer as ArrayBuffer,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["sign"],
        );
      } catch (_) {}
    }
  }

  // 2. Fallback con librería estándar JOSE (importPKCS8)
  if (!cryptoKey) {
    try {
      console.log(
        "[getGoogleAccessToken] Intentando importar clave con jose.importPKCS8...",
      );
      cryptoKey = (await jose.importPKCS8(cleanPem, "RS256")) as CryptoKey;
    } catch (joseErr: any) {
      console.error(
        "[getGoogleAccessToken] Fallback jose.importPKCS8 falló:",
        joseErr.message,
      );
      throw new Error(
        `No se pudo importar la clave privada de Google en WebCrypto ni JOSE: ${joseErr.message}`,
      );
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
  if (!tokenData.access_token) {
    throw new Error(`Google Auth failed: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

// Extrae el ID de una carpeta a partir de una URL o cadena de ID
function extractFolderId(input: string): string {
  if (!input) return "";
  const trimmed = input.trim();
  const match = trimmed.match(/folders\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  const cleaned = trimmed.split("?")[0].split("#")[0];
  const segments = cleaned.split("/").filter(Boolean);
  return segments[segments.length - 1] || trimmed;
}

// Extrae el ID de una hoja de cálculo a partir de una URL o cadena de ID
function extractSpreadsheetId(input: string): string {
  if (!input) return "";
  const trimmed = input.trim();
  const match = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  const cleaned = trimmed.split("?")[0].split("#")[0];
  const segments = cleaned.split("/").filter(Boolean);
  return segments[segments.length - 1] || trimmed;
}

// Buscar el archivo Google Sheet más reciente dentro de una carpeta específica de Google Drive
async function findLatestSheetInFolder(
  accessToken: string,
  folderId: string,
): Promise<any> {
  const query = encodeURIComponent(
    `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=modifiedTime desc&pageSize=1&fields=files(id,name,modifiedTime,createdTime)`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Google Drive API Error: ${JSON.stringify(data.error)}`);
  }
  if (!data.files || data.files.length === 0) {
    return null;
  }
  return data.files[0];
}

// Listar hojas de cálculo en una carpeta específica
async function listSheetsInFolder(
  accessToken: string,
  folderId: string,
): Promise<any[]> {
  const query = encodeURIComponent(
    `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=modifiedTime desc&pageSize=10&fields=files(id,name,modifiedTime,createdTime)`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Google Drive API Error: ${JSON.stringify(data.error)}`);
  }
  return data.files || [];
}

// Descubrimiento autónomo global de archivos en toda la cuenta de Google Drive
async function listDiscoveredSheets(accessToken: string): Promise<any[]> {
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
  return data.files || [];
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { folder_id, folderUrl, folderId, url: spreadsheetUrl, action } = body;

    const accessToken = await getGoogleAccessToken();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Acción para listar los archivos disponibles desde el panel de administración
    if (action === "list") {
      const rawFolder = folder_id || folderUrl || folderId;
      const targetFolderId = rawFolder ? extractFolderId(rawFolder) : "";
      const files = targetFolderId
        ? await listSheetsInFolder(accessToken, targetFolderId)
        : await listDiscoveredSheets(accessToken);
      return new Response(JSON.stringify({ files }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolver si viene folder_id o folderUrl, o si la url es una carpeta de Drive
    let targetFolder = folder_id || folderUrl || folderId || "";
    if (!targetFolder && spreadsheetUrl && spreadsheetUrl.includes("/folders/")) {
      targetFolder = spreadsheetUrl;
    }

    let spreadsheetId = "";
    let resolvedFileName = "";

    if (targetFolder) {
      const parsedFolderId = extractFolderId(targetFolder);
      if (!parsedFolderId) {
        return new Response(
          JSON.stringify({ error: "ID de carpeta no válido" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      console.log(
        `Buscando archivo de cálculo más reciente en carpeta: ${parsedFolderId}...`,
      );
      const latestFile = await findLatestSheetInFolder(
        accessToken,
        parsedFolderId,
      );
      if (!latestFile) {
        return new Response(
          JSON.stringify({
            error:
              "No se encontraron archivos de Google Sheets en la carpeta configurada",
          }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      spreadsheetId = latestFile.id;
      resolvedFileName = latestFile.name;
      console.log(
        `Archivo autónomo resuelto en carpeta: ${resolvedFileName} (${spreadsheetId})`,
      );
    } else if (spreadsheetUrl) {
      spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
      if (!spreadsheetId) {
        return new Response(
          JSON.stringify({ error: "URL de archivo no válida" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      console.log(`Procesando archivo directo: ${spreadsheetId}`);
    } else {
      return new Response(
        JSON.stringify({ error: "Se requiere folder_id o url" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 1. Obtener Metadatos del Sheet
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties`;
    const metaRes = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const metaData = await metaRes.json();
    if (metaData.error) {
      throw new Error(
        `Google Sheets API Error: ${JSON.stringify(metaData.error)}`,
      );
    }

    // 2. Mapear hojas preservando el orden original x índice
    const activeSheets = metaData.sheets.map((s: any) => ({
      name: s.properties.title,
      visible: true,
    }));

    // Guardar configuración global del Sheet activo en la BD
    const settingsUpdate: any = {
      id: 1,
      active_spreadsheet_id: spreadsheetId,
      active_sheets: JSON.stringify(activeSheets),
      updated_at: new Date().toISOString(),
    };
    if (targetFolder) {
      settingsUpdate.active_sheet_name = extractFolderId(targetFolder);
    }

    try {
      await supabase.from("app_settings").upsert(settingsUpdate);
    } catch (e) {
      console.warn("Advertencia al guardar app_settings:", e);
    }

    // Pestañas a importar: si hay más de 1, se omiten portadas según corresponda
    const dataSheets =
      activeSheets.length > 1
        ? activeSheets.slice(1, 10).map((s: any) => s.name)
        : activeSheets.map((s: any) => s.name);
    let totalImported = 0;

    // 3. Importar pestañas de producción
    for (const sheetName of dataSheets) {
      const range = `${sheetName}!A2:G`;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
      const sheetsRes = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const sheetsData = await sheetsRes.json();

      if (!sheetsData.values?.length) continue;

      const records = sheetsData.values
        .map((row: string[], index: number) => ({
          spreadsheet_id: spreadsheetId,
          sheet_name: sheetName,
          row_number: index + 2,
          lote: row[0] || null,
          sku: row[1] || null,
          coil: row[2] || null,
          sae: row[3] || null,
          peso: row[4] ? parseFloat(row[4].replace(/,/g, "")) : null,
          colada: row[5] || null,
          diametro: row[6] || null,
          is_verified: false,
          verified_at: null,
          verified_by: null,
          updated_at: new Date().toISOString(),
        }))
        .filter((r: any) => r.lote && r.lote.trim() !== "");

      if (records.length > 0) {
        const { error } = await supabase
          .from("registros_importacion")
          .upsert(records);
        if (error) console.error("Upsert Error:", error);
        totalImported += records.length;
      }
    }

    return new Response(
      JSON.stringify({
        message: "Drive Sincronizado Autónomo v4.8",
        spreadsheet_id: spreadsheetId,
        spreadsheet_name:
          metaData.properties?.title || resolvedFileName || "Spreadsheet",
        total: totalImported,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: any) {
    console.error("Error fatal en import-sheet:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
