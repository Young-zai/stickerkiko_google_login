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

    // 通过 Google OAuth 代码获取 id_token
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

    const firstName = (payload.given_name || "") as string;
    const lastName = (payload.family_name || "") as string;
    const googleSub = (payload.sub || "") as string;

    let customer = await findCustomerByEmail(email);
    let customerId = customer?.id as string | undefined;

    if (!customerId) {
      customerId = await createCustomer({ email, firstName, lastName });
    }

    await setMetafields(customerId, { google_sub: googleSub });

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


/** 解析 JWT payload */
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

async function createCustomer(input: { email: string; firstName?: string; lastName?: string }) {
  const mutation = `
    mutation ($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id email }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphQL(mutation, {
    input: {
      email: input.email,
      firstName: input.firstName || undefined,
      lastName: input.lastName || undefined,
    },
  });

  const err = data.customerCreate.userErrors?.[0];
  if (err) throw new Error(err.message);

  return data.customerCreate.customer.id as string;
}

async function setMetafields(customerId: string, extra: any = {}) {
  const fields = [
    { ownerId: customerId, namespace: "profile", key: "google_sub", type: "single_line_text_field", value: String(extra.google_sub) },
    { ownerId: customerId, namespace: "profile", key: "signup_source", type: "single_line_text_field", value: "google" },
  ];

  const m = `
    mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { message }
      }
    }
  `;

  const data = await shopifyGraphQL(m, { metafields: fields });
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

    // 通过 Google OAuth 代码获取 id_token
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

    const firstName = (payload.given_name || "") as string;
    const lastName = (payload.family_name || "") as string;
    const googleSub = (payload.sub || "") as string;

    let customer = await findCustomerByEmail(email);
    let customerId = customer?.id as string | undefined;

    if (!customerId) {
      customerId = await createCustomer({ email, firstName, lastName });
    }

    await setMetafields(customerId, { google_sub: googleSub });

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

