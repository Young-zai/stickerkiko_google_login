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

/** 解析 JWT payload（注意：这里只是解析，不验签；生产建议验签或调用 tokeninfo） */
function parseJwtPayload(jwt: string) {
  const [, payload] = jwt.split(".");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Buffer.from(normalized, "base64").toString("utf8");
  return JSON.parse(decoded);
}

async function shopifyGraphQL(query: string, variables: any) {
  const shop = process.env.SHOPIFY_SHOP!;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;

  const r = await fetch(`https://${shop}/admin/api/2025-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await r.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function findCustomerByEmail(email: string) {
  const q = `
    query($query: String!) {
      customers(first: 1, query: $query) {
        edges { node { id email firstName lastName phone } }
      }
    }
  `;
  const data = await shopifyGraphQL(q, { query: `email:${email}` });
  return data.customers.edges[0]?.node || null;
}



export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");

    // ✅ Google 登录不需要 extra；如果你后面做“完善资料页”再传 extra 也行
    const { code } = await req.json();

    if (!code) {
      return NextResponse.json(
        { error: "Missing code" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // popup code flow：redirect_uri=postmessage
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
    if (!id_token) {
      return NextResponse.json(
        { error: "No id_token returned by Google", details: tokenData },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const payload = parseJwtPayload(id_token);

    const email = payload.email as string | undefined;
    if (!email) throw new Error("No email in token");

    // ✅ Google 给你的“默认可用字段”
    const firstName = (payload.given_name || "") as string;
    const lastName = (payload.family_name || "") as string;
    const googleSub = (payload.sub || "") as string;

    const existing = await findCustomerByEmail(email);
    let customerId = existing?.id as string | undefined;


    return NextResponse.json(
      { ok: true, email, customerId },
      { headers: corsHeaders(origin) }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500, headers: corsHeaders(null) }
    );
  }
}
