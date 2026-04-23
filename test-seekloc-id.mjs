const user = "webservice";
const pwd = "2010";
const emp = "6454";

async function testSeeklocId() {
  const body = new FormData();
  body.append("usr", user);
  body.append("pwd", pwd);
  body.append("emp", emp);
  body.append("tp", "2"); // Is it tp=2 for details? Or tp=1 with ID? The user passed tp=3 to get details? But tp=3 is for CPF details. Maybe tp=4 for CNPJ details?
  
  // Let's try passing what the user passed but with our ID.
  // Wait, let's just pass tp=1 with id.
  const tests = [
    { tp: "1", id: "136785055" },
    { tp: "2", id: "136785055" },
    { tp: "3", id: "136785055" },
    { tp: "4", id: "136785055" }
  ];

  for (const t of tests) {
    const form = new FormData();
    form.append("usr", user);
    form.append("pwd", pwd);
    form.append("emp", emp);
    form.append("tp", t.tp);
    form.append("id", t.id);

    try {
      const res = await fetch("http://200.201.193.100/seekloc/ws.php", {
        method: "POST",
        body: form
      });
      const text = await res.text();
      console.log(`\n--- Status tp=${t.tp} id=${t.id}: ${res.status}`);
      console.log(text.slice(0, 300));
    } catch (e) {
      console.error(e);
    }
  }
}

testSeeklocId();
