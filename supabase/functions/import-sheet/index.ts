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
  const claim = { iss: clientEmail, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }
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
    const { url: spreadsheetUrl } = await req.json()
    if (!spreadsheetUrl) throw new Error('URL requerida')

    const match = spreadsheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/)
    const spreadsheetId = match ? match[1] : spreadsheetUrl

    const accessToken = await getGoogleAccessToken()
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 1. Obtener Metadatos (PRESERVAR ORDEN DEL DRIVE)
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`
    const metaRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
    const metaData = await metaRes.json()

    // 2. Mapear hojas preservando el orden original x índice
    const activeSheets = metaData.sheets.map((s: any) => ({
        name: s.properties.title,
        visible: true // Por defecto visibles
    }))

    await supabase.from('app_settings').upsert({
      id: 1,
      active_spreadsheet_id: spreadsheetId,
      active_sheets: JSON.stringify(activeSheets),
      updated_at: new Date().toISOString()
    })

    const dataSheets = activeSheets.slice(1, 10).map((s: any) => s.name)
    let totalImported = 0

    for (const sheetName of dataSheets) {
      const range = `${sheetName}!A2:J10000`
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`
      const sheetsRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      const sheetsData = await sheetsRes.json()

      if (!sheetsData.values?.length) continue

      const records = sheetsData.values
        .map((row: string[], index: number) => ({
          spreadsheet_id: spreadsheetId,
          sheet_name:     sheetName,
          row_number:     index + 2,
          lote:           row[0] || null,
          sku:            row[1] || null,
          coil:           row[2] || null,
          colada:         row[5] || null,
          diametro:       row[6] || null,
          peso:           row[4] ? parseFloat(row[4].replace(',', '')) : null,
          is_verified:    row[7] === 'TRUE' || row[7] === 'true' || row[7] === 'VERIFICADO',
          verified_at:    (row[8] && row[8].trim() !== '') ? new Date(row[8]).toISOString() : null,
          verified_by:    row[9] || null,
          updated_at:     new Date().toISOString(),
        }))
        .filter((r: any) => r.lote && r.lote.trim() !== '')

      if (records.length > 0) {
        const { error } = await supabase.from('registros_importacion').insert(records)
        totalImported += records.length
      }
    }

    return new Response(JSON.stringify({ message: 'Drive Sincronizado v4.1', total: totalImported }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
