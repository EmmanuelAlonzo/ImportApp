import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getGoogleAccessToken(): Promise<string> {
  const clientEmail = Deno.env.get('GOOGLE_CLIENT_EMAIL')!
  const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')!.replace(/\\n/g, '\n')
  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const encode = (obj: object) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const header = encode({ alg: 'RS256', typ: 'JWT' })
  const payload = encode(claim)
  const signingInput = `${header}.${payload}`
  const keyData = privateKey.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '')
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput))
  const encodedSig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const jwt = `${signingInput}.${encodedSig}`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const tokenData = await tokenRes.json()
  return tokenData.access_token
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const record = await req.json()
    const { lote, diametro, sku, sae, peso, colada, coil, verified_by, verified_at } = record

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 1. Obtener el ID del Spreadsheet desde app_settings (Esquema Original)
    const { data: settings } = await supabase.from('app_settings').select('active_spreadsheet_id').eq('id', 1).single()
    const spreadsheetId = settings?.active_spreadsheet_id

    if (!spreadsheetId) throw new Error('No hay Spreadsheet configurado en app_settings')

    const accessToken = await getGoogleAccessToken()

    // 2. Preparar la fila para el Drive (A-J)
    const rowValues = [
      lote,           // A: Lote
      sku || "",      // B: SKU
      coil || "",     // C: Coil/Bundle
      sae || "",      // D: SAE
      peso || 0,      // E: Peso
      colada || "",   // F: Colada
      diametro,       // G: Diámetro
      "TRUE",         // H: is_verified
      verified_at  || new Date().toISOString(), // I: verified_at
      verified_by  || "MANUAL ENTRY"            // J: verified_by
    ]

    // 3. Escribir en la hoja del diámetro correspondiente (G: Diámetro se usa como nombre de hoja)
    const range = `${diametro}!A:J`
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`

    const appendRes = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [rowValues] })
    })

    const result = await appendRes.json()

    return new Response(JSON.stringify({ 
      message: 'Sincronización Manual Exitosa (v4.0)', 
      lote,
      sheet: diametro 
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
