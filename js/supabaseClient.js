import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://idmdonujkmbeawtgutya.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bfDdD4Dfk8PvkttI01RL7w_QU0rZUCk";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function testProfilesConnection() {
  if (SUPABASE_ANON_KEY === "PASTE_YOUR_PUBLISHABLE_KEY_HERE") {
    console.info("Supabase connection test skipped: add your publishable key in js/supabaseClient.js.");
    return;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .limit(5);

  if (error) {
    console.error("Supabase profiles read failed.", error);
    return;
  }

  console.info("Supabase profiles read succeeded.", data);
}
