// app/api/google/exchange/route.ts

import { NextResponse } from "next/server";

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
        edges { node { id email } }
      }
    }
  `;
  const data = await shopifyGraphQL(q, { query: `email:${email}` });
  return data.customers.edges[0]?.node || null;
}

async function createCustomer(input: { email: string; firstName: string; lastName: string }) {
  const m = `
    mutation($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphQL(m, {
    input: { ...input, verifiedEmail: true },
  });
  const err = data.customerCreate.userErrors?.[0];
  if (err) throw new Error(err.message);
  return data.customerCreate.customer.id as string;
}

async function setMetafields(customerId: string, extra: any = {}) {
  const metafields = [
    { ownerId: customerId, namespace: "profile", key: "company", type: "single_line_text_field", value: String(extra.company || "") },
    { ownerId: customerId, namespace: "profile", key: "vat", type: "single_line_text_field", value: String(extra.vat || "") },
    { ownerId: customerId, namespace: "profile", key: "phone", type: "single_line_text_field", value: String(extra.phone || "") },
    { ownerId: customerId, namespace: "profile", key: "google_sub", type: "single_line_text_field", value: String(extra.google_sub || "") },
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

export async function POST(req: Request) {
  try {
    const { code, extra, redirectUri } = await req.json();

    if (!code) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const redirect_uri = redirectUri || "https://stickerkiko.com";

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResp.json();
    if (!tokenResp.ok) {
      return NextResponse.json({ error: "Google exchange failed", details: tokenData }, { status: 400 });
    }

    const id_token = tokenData.id_token;
    if (!id_token) {
      return NextResponse.json({ error: "No id_token", details: tokenData }, { status: 400 });
    }

    const payload = parseJwtPayload(id_token);
    const email = payload.email as string | undefined;
    if (!email) return NextResponse.json({ error: "No email in id_token" }, { status: 400 });

    const firstName = (payload.given_name || "") as string;
    const lastName = (payload.family_name || "") as string;
    const googleSub = (payload.sub || "") as string;

    const existing = await findCustomerByEmail(email);
    let customerId = existing?.id as string | undefined;

    if (!customerId) {
      customerId = await createCustomer({ email, firstName, lastName });
    }

    await setMetafields(customerId, { ...(extra || {}), google_sub: googleSub });

    return NextResponse.json({ ok: true, email, customerId, nextUrl: "/account" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
