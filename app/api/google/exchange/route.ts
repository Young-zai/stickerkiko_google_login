import { NextResponse } from "next/server";

// 设置允许的跨域来源
const ALLOWED_ORIGIN = "https://stickerkiko.com";

function corsHeaders(origin: string | null) {
  const o = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": o,  // 允许的来源
    "Access-Control-Allow-Methods": "POST, OPTIONS",  // 允许的方法
    "Access-Control-Allow-Headers": "Content-Type",  // 允许的头部
  };
}

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    console.log("Request received from origin:", origin);

    // 获取请求中的 code
    const { code } = await req.json();
    if (!code) {
      console.error("Error: Missing code");  // 输出日志，便于调试
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
        redirect_uri: "postmessage",  // 必须与 Google 配置的 redirect URI 一致
        grant_type: "authorization_code",
      }),
    });

    // 如果请求失败，返回错误信息
    if (!tokenResp.ok) {
      console.error("Failed to exchange code for token");
      return NextResponse.json(
        { error: "Failed to exchange code for token" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const tokenData = await tokenResp.json();
    const id_token = tokenData.id_token;

    if (!id_token) {
      console.error("Google exchange failed");
      return NextResponse.json(
        { error: "Google exchange failed" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // 解析 id_token 获取用户信息
    const payload = parseJwtPayload(id_token);
    const email = payload.email as string;

    if (!email) throw new Error("No email in token");

    // 查询 Shopify 用户是否存在
    const existingCustomer = await findCustomerByEmail(email);

    if (existingCustomer) {
      console.log("User exists:", existingCustomer);
      return NextResponse.json(
        { ok: true, email, customerId: existingCustomer.id },
        { headers: corsHeaders(origin) }
      );
    }

    console.log("User does not exist, returning email:", email);
    return NextResponse.json(
      { ok: true, email },
      { headers: corsHeaders(origin) }
    );
  } catch (e: any) {
    console.error("Error processing request:", e);
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500, headers: corsHeaders(null) }
    );
  }
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
  return data.data.customers.edges[0]?.node || null;  // 返回第一个匹配的客户
}

// 解析 JWT token
function parseJwtPayload(jwt: string) {
  const [, payload] = jwt.split(".");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Buffer.from(normalized, "base64").toString("utf8");
  const payloadJson = JSON.parse(decoded);

  // 验证 token 的有效性
  if (payloadJson.aud !== process.env.GOOGLE_CLIENT_ID) {
    throw new Error("Invalid audience in token");
  }
  if (payloadJson.iss !== "https://accounts.google.com") {
    throw new Error("Invalid issuer in token");
  }

  return payloadJson;
}

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");

    // 获取请求中的 code
    const { code } = await req.json();
    if (!code) {
      console.error("Error: Missing code");  // 输出日志，便于调试
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
        redirect_uri: "postmessage",  // 必须与 Google 配置的 redirect URI 一致
        grant_type: "authorization_code",
      }),
    });

    // 如果请求失败，返回错误信息
    if (!tokenResp.ok) {
      console.error("Failed to exchange code for token");  // 输出日志，便于调试
      return NextResponse.json(
        { error: "Failed to exchange code for token" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const tokenData = await tokenResp.json();
    const id_token = tokenData.id_token;

    // 如果没有 id_token，返回错误
    if (!id_token) {
      console.error("Google exchange failed");  // 输出日志，便于调试
      return NextResponse.json(
        { error: "Google exchange failed" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // 解析 id_token 获取用户信息
    const payload = parseJwtPayload(id_token);
    const email = payload.email as string;

    if (!email) throw new Error("No email in token");

    // 查询 Shopify 用户是否存在
    const existingCustomer = await findCustomerByEmail(email);

    if (existingCustomer) {
      console.log("User exists:", existingCustomer);  // 输出用户信息，便于调试
      // 用户已存在，返回用户信息
      return NextResponse.json(
        { ok: true, email, customerId: existingCustomer.id },
        { headers: corsHeaders(origin) }
      );
    }

    // 用户不存在，返回创建新用户的信息
    console.log("User does not exist, returning email:", email);  // 输出信息，便于调试
    return NextResponse.json(
      { ok: true, email },
      { headers: corsHeaders(origin) }
    );
  } catch (e: any) {
    console.error("Error processing request:", e);  // 输出错误信息，便于调试
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500, headers: corsHeaders(null) }
    );
  }
}

