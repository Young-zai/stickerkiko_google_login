// app/api/google/exchange/route.ts
import { NextResponse } from "next/server";

const ALLOWED_ORIGIN = "https://stickerkiko.com";

function corsHeaders(origin: string | null) {
  const o = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

/** 处理预检请求（CORS 关键） */
export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

/** 解析 JWT payload（暂不验签，先跑通流程） */
function parseJwtPayload(jwt: string) {
  const [, payload] = jwt.split(".");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Buffer.from(normalized, "base64").toString("utf8");
  return JSON.parse(decoded);
}


export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    const { code, extra } = await req.json();

    if (!code) {
      return NextResponse.json(
        { error: "Missing code" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    /** popup code flow 必须用 postmessage */
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: "postmessage",
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResp.json();
    if (!tokenResp.ok) {
      return NextResponse.json(
        { error: "Google exchange failed", details: tokenData },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const id_token = tokenData.id_token;
    const payload = parseJwtPayload(id_token);

    const email = payload.email;
    if (!email) throw new Error("No email in token");

    const firstName = payload.given_name || "";
    const lastName = payload.family_name || "";
    const googleSub = payload.sub || "";

    let customer = await findCustomerByEmail(email);
    let customerId = customer?.id;

    if (!customerId) {
      customerId = await createCustomer({ email, firstName, lastName });
    }

    await setMetafields(customerId, { ...(extra || {}), google_sub: googleSub });

    return NextResponse.json(
      { ok: true, email, customerId },
      { headers: corsHeaders(origin) }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Server error" },
      { status: 500, headers: corsHeaders(null) }
    );
  }
}

