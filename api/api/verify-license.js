// api/verify-license.js — validates license key from extension
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // Allow CORS from extension
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { license_key } = req.body;

  if (!license_key || typeof license_key !== "string") {
    return res.status(400).json({ valid: false, error: "Missing license key" });
  }

  const key = license_key.trim().toUpperCase();

  try {
    const { data, error } = await supabase
      .from("licenses")
      .select("email, status, created_at")
      .eq("license_key", key)
      .single();

    if (error || !data) {
      return res.status(200).json({ valid: false, error: "License not found" });
    }

    if (data.status !== "active") {
      return res.status(200).json({ valid: false, error: "License inactive" });
    }

    return res.status(200).json({
      valid: true,
      email: data.email,
      activated_at: data.created_at,
    });

  } catch (err) {
    console.error("Verify license error:", err);
    return res.status(500).json({ valid: false, error: "Server error" });
  }
}
