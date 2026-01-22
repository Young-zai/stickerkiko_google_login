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

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

/** 解析 JWT payload（仅解析；生产建议验签） */
function parseJwtPayload(jwt: string) {
  const [, payload] = jwt.split(".");
  if (!payload) throw new Error("Invalid id_token");
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

  const json = await r.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function findCustomerByEmail(email: string) {
  const q = `
    query($query: String!) {
      customers(first: 1, query: $query) {
        edges { node { id email } }
      }
    }
  `;
  const data = await shopifyGraphQL(q, { query: `email:${email}` });
  return data.customers.edges[0]?.node || null;
}
// ✅ 新增：写入 customer metafield custom.login_key
async function setDescriptionzMetafield(customerId: string, value: string) {
  const metafields = [
    {
      ownerId: customerId,
      namespace: "custom",
      key: "login_key",
      type: "single_line_text_field",
      value: String(value),
    },
  ];

  const m = `
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphQL(m, { metafields });
  const err = data.metafieldsSet.userErrors?.[0];
  if (err) throw new Error(err.message);
}

/** 可选：如果已存在客户，就把 google_sub 写到 metafield（你想做绑定的话很有用） */
async function setMetafields(customerId: string, googleSub: string) {
  const metafields = [
    { ownerId: customerId, namespace: "profile", key: "google_sub", type: "single_line_text_field", value: String(googleSub) },
    { ownerId: customerId, namespace: "profile", key: "signup_source", type: "single_line_text_field", value: "google" },
  ];

  const m = `
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { message }
      }
    }
  `;

  const data = await shopifyGraphQL(m, { metafields });
  const err = data.metafieldsSet.userErrors?.[0];
  if (err) throw new Error(err.message);
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

    // ✅ GIS popup code flow：redirect_uri 必须是 postmessage
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

    const id_token = tokenData.id_token as string | undefined;
    if (!id_token) {
      return NextResponse.json(
        { error: "No id_token returned by Google", details: tokenData },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const payload = parseJwtPayload(id_token);

    const email = payload.email as string | undefined;
    if (!email) throw new Error("No email in token");

    const firstName = (payload.given_name || "") as string;
    const lastName = (payload.family_name || "") as string;
    const googleSub = (payload.sub || "") as string;

    // ✅ 查 Shopify 是否已存在该 email
    const existing = await findCustomerByEmail(email);
    const exists = !!existing?.id;

    // ✅ 可选：已存在就写 google_sub（用于“绑定 Google”）
    if (exists && googleSub) {
      await setMetafields(existing.id, googleSub);
    }
    // ✅ 新增：如果 customer 已存在（或已被创建完成），写入 descriptionz metafield
    try {
      const existing = await findCustomerByEmail(email);
      if (existing?.id) {
        await setDescriptionzMetafield(existing.id, "signup_with_google");
      }
    } catch (err) {
      // 不影响你原有登录流程：写 metafield 失败不阻断
      console.error("set descriptionz metafield failed:", err);
    }

    // ✅ 返回给前端：用这些字段去提交 create_customer
    return NextResponse.json(
      { ok: true, exists, email, firstName, lastName, googleSub },
      { headers: corsHeaders(origin) }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500, headers: corsHeaders(null) }
    );
  }
}


