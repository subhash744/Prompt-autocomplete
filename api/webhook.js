// api/webhook.js — Dodo Payments webhook handler
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function generateLicenseKey() {
  const seg = () => crypto.randomBytes(3).toString("hex").toUpperCase();
  return `PA-${seg()}-${seg()}-${seg()}`;
}

function verifyDodoSignature(rawBody, signature, secret) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody);
  const expected = hmac.digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Get raw body for signature verification
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers["dodo-signature"] || req.headers["x-dodo-signature"] || "";

  // Verify webhook signature
  const webhookSecret = process.env.DODO_WEBHOOK_SECRET;
  if (webhookSecret && signature) {
    const sig = signature.replace("sha256=", "");
    if (!verifyDodoSignature(rawBody, sig, webhookSecret)) {
      console.error("Invalid webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }
  }

  const event = req.body;
  const eventType = event.type || event.event_type;

  console.log("Dodo webhook event:", eventType, JSON.stringify(event).slice(0, 200));

  // Handle subscription activated or payment succeeded
  if (
    eventType === "subscription.active" ||
    eventType === "subscription.activated" ||
    eventType === "payment.succeeded" ||
    eventType === "checkout.completed"
  ) {
    try {
      // Extract customer email from various possible payload shapes
      const email =
        event?.data?.customer?.email ||
        event?.customer?.email ||
        event?.data?.billing_address?.email ||
        event?.email ||
        null;

      const customerId =
        event?.data?.customer?.id ||
        event?.customer_id ||
        event?.data?.customer_id ||
        null;

      const subscriptionId =
        event?.data?.subscription_id ||
        event?.data?.id ||
        event?.subscription_id ||
        null;

      if (!email) {
        console.error("No email in webhook payload:", JSON.stringify(event));
        return res.status(200).json({ received: true, warning: "no email found" });
      }

      // Check if license already exists for this email
      const { data: existing } = await supabase
        .from("licenses")
        .select("license_key")
        .eq("email", email.toLowerCase())
        .single();

      let licenseKey;

      if (existing?.license_key) {
        // Reuse existing key (e.g. renewal)
        licenseKey = existing.license_key;
        await supabase
          .from("licenses")
          .update({
            status: "active",
            subscription_id: subscriptionId,
            updated_at: new Date().toISOString(),
          })
          .eq("email", email.toLowerCase());
      } else {
        // Generate new license key
        licenseKey = generateLicenseKey();
        const { error } = await supabase.from("licenses").insert({
          email: email.toLowerCase(),
          license_key: licenseKey,
          customer_id: customerId,
          subscription_id: subscriptionId,
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        if (error) {
          console.error("Supabase insert error:", error);
          return res.status(500).json({ error: "DB error" });
        }
      }

      console.log(`License issued: ${licenseKey} → ${email}`);
      return res.status(200).json({ received: true, license_key: licenseKey });

    } catch (err) {
      console.error("Webhook handler error:", err);
      return res.status(500).json({ error: "Internal error" });
    }
  }

  // Handle subscription cancellation / payment failed
  if (
    eventType === "subscription.cancelled" ||
    eventType === "subscription.canceled" ||
    eventType === "subscription.ended" ||
    eventType === "payment.failed"
  ) {
    try {
      const email =
        event?.data?.customer?.email ||
        event?.customer?.email ||
        event?.email ||
        null;

      if (email) {
        await supabase
          .from("licenses")
          .update({ status: "inactive", updated_at: new Date().toISOString() })
          .eq("email", email.toLowerCase());

        console.log(`License deactivated for: ${email}`);
      }
    } catch (err) {
      console.error("Deactivation error:", err);
    }
    return res.status(200).json({ received: true });
  }

  return res.status(200).json({ received: true });
}
