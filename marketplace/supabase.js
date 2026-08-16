const { createClient } = require("@supabase/supabase-js");

let client;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Marketplace is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY on the bot server.",
    );
  }

  if (!client) {
    client = createClient(url, secretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  return client;
}

module.exports = { getSupabase };
