import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    define: {
      __SB_URL__: JSON.stringify(env.VITE_SUPABASE_URL || "https://rsuvfbcpribrmkbveiyp.supabase.co"),
      __SB_KEY__: JSON.stringify(env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzdXZmYmNwcmlicm1rYnZlaXlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NzM0MjksImV4cCI6MjA5NDI0OTQyOX0.w76osoCdCN_Jkjge-fhZTHB7XUUM_vVTsFrt-CYCdfo"),
    },
  };
});
