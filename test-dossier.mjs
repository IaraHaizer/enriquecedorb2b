import fs from 'fs';

const url = "https://icqxxgnogbsnzmlydevh.supabase.co/functions/v1/generate-dossier";
const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljcXh4Z25vZ2JzbnptbHlkZXZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MDA3NTQsImV4cCI6MjA5MTM3Njc1NH0.P_d2tH1pZfHchTS1hzHID6hmWJxUY5DBGRoc5muQtCs";

async function test() {
  console.log("Testing generate-dossier with CNPJ 24.473.793/0001-24...");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${anonKey}`
      },
      body: JSON.stringify({
        input: "24473793000124",
        input_type: "cnpj",
        skip_cache: true
      })
    });
    
    if (!res.ok) {
      console.log(`Failed: ${res.status}`);
      console.log(await res.text());
      return;
    }
    
    const data = await res.json();
    console.log("Data Sources:", JSON.stringify(data.data_sources, null, 2));
    if (data.data_sources?.seekloc_details) {
       console.log("Seekloc Details:", JSON.stringify(data.data_sources.seekloc_details, null, 2));
    }
    console.log("Dossier Summary:");
    console.log(data.dossier?.resumo);
    
    fs.writeFileSync("test-output.json", JSON.stringify(data, null, 2));
    console.log("Full response saved to test-output.json");
    
  } catch (err) {
    console.error(err);
  }
}

test();
