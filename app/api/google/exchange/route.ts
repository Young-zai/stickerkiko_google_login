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

// 使用 Shopify API 查询邮箱是否已存在
async function findCustomerByEmail(email: string) {
  const query = `
    query($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
            email
            firstName
            lastName
          }
        }
      }
    }
  `;

  const response = await fetch(`https://${process.env.SHOPIFY_SHOP}/admin/api/2025-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!,
    },
    body: JSON.stringify({
      query,
      variables: { query: `email:${email}` },
    }),
  });

  const data = await response.json();
  return data.data.customers.edges[0]?.node || null;
}

// 解析 JWT token
function parseJwtPayload(jwt: string) {
  const [, payload] = jwt.split(".");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Buffer.from(normalized, "base64").toString("utf8");
  return JSON.parse(decoded);
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

    // 使用 code 请求 id_token
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

    // 查询 Shopify 用户是否存在
    const existingCustomer = await findCustomerByEmail(email);

    if (existingCustomer) {
      // 用户已存在，返回用户信息
      return NextResponse.json(
        { ok: true, email, customerId: existingCustomer.id },
        { headers: corsHeaders(origin) }
      );
    }

    // 用户不存在，返回创建新用户的信息（可以在前端使用这个信息来创建用户）
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
