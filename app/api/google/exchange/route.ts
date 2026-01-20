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

/** 创建 customer */
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

/** 激活客户 */
async function activateCustomer(customerId: string, activationToken: string, password: string) {
  const mutation = `
    mutation customerActivate($id: ID!, $input: CustomerActivateInput!) {
      customerActivate(id: $id, input: $input) {
        customer {
          id
          email
        }
        customerAccessToken {
          accessToken
        }
        customerUserErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    id: customerId,
    input: {
      activationToken: activationToken, // 确保你在这里传递正确的激活令牌
      password: password, // 用于自动登录的密码
    },
  };

  const data = await shopifyGraphQL(mutation, variables);
  const errors = data.customerActivate.customerUserErrors;

  if (errors && errors.length > 0) {
    throw new Error(errors.map((error: any) => error.message).join(", "));
  }

  return data.customerActivate.customerAccessToken.accessToken;
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

    const existing = await findCustomerByEmail(email);
    let customerId = existing?.id as string | undefined;

    if (!customerId) {
      customerId = await createCustomer({ email, firstName, lastName });
    }

    const activationToken = "generated-activation-token"; // You would need to generate or get this token

    // 激活用户并获取 accessToken
    const accessToken = await activateCustomer(customerId, activationToken, "googleAutoGeneratedPassword123");

    return NextResponse.json(
      { ok: true, email, accessToken },
      { headers: corsHeaders(origin) }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500, headers: corsHeaders(null) }
    );
  }
}

