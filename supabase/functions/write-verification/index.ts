import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

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

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const header = encode({ alg: 'RS256', typ: 'JWT' })
  const payload = encode(claim)
  const signingInput = `${header}.${payload}`

  const keyData = privateKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput)
  )

  const encodedSig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt = `${signingInput}.${encodedSig}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error(`Auth failed: ${JSON.stringify(tokenData)}`)
  return tokenData.access_token
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Puede ser llamado directo desde la app o vía Database Webhook
    const body = await req.json()
    const record = body.record || body

    const {
      spreadsheet_id,
      sheet_name = 'Hoja1',
      row_number,
      verified_by,
      verified_at,
      is_verified
    } = record

    // Solo procesar si es una verificación real
    if (!is_verified || !spreadsheet_id || !row_number) {
      return new Response(JSON.stringify({ message: 'Nada que escribir' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const accessToken = await getGoogleAccessToken()

    // Formatear fecha: DD/MM/YYYY HH:MM
    const date = new Date(verified_at)
    const dd   = String(date.getDate()).padStart(2, '0')
    const mm   = String(date.getMonth() + 1).padStart(2, '0')
    const yyyy = date.getFullYear()
    const hh   = String(date.getHours()).padStart(2, '0')
    const min  = String(date.getMinutes()).padStart(2, '0')
    const formattedDate = `${dd}/${mm}/${yyyy} ${hh}:${min}`

    // Actualizar columnas H (checkbox), I (fecha), J (usuario)
    const range = `${sheet_name}!H${row_number}:J${row_number}`
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet_id}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [[true, formattedDate, verified_by]] }),
    })

    const result = await res.json()

    return new Response(JSON.stringify({
      message: 'Write-back exitoso',
      updatedCells: result.updatedCells,
      row: row_number
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
