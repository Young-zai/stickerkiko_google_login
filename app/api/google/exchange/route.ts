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

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");

    const { code } = await req.json();
    if (!code) {
      return NextResponse.json(
        { error: "Missing code" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // 请求 token，获取 id_token
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: "postmessage", // 必须与 Google 配置的 redirect URI 一致
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResp.json();
    const id_token = tokenData.id_token;

    if (!id_token) {
      return NextResponse.json(
        { error: "Google exchange failed" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const payload = parseJwtPayload(id_token);
    const email = payload.email as string;

    if (!email) throw new Error("No email in token");

    // 返回用户邮箱，前端可以使用该邮箱填充 Shopify 注册表单
    return NextResponse.json(
      { ok: true, email },
      { headers: corsHeaders(origin) }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500, headers: corsHeaders(null) }
    );
  }
}
