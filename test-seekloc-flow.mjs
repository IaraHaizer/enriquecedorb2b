const user = "webservice";
const pwd = "2010";
const emp = "6454";
const documento = "24473793000124"; // The CNPJ the user requested

async function testSeeklocFlow() {
  console.log("Step 1: Using tp=14 to get ID...");
  const form1 = new FormData();
  form1.append("usr", user);
  form1.append("pwd", pwd);
  form1.append("emp", emp);
  form1.append("tp", "14");
  form1.append("doc", documento);

  let data1;
  try {
    const res = await fetch("http://200.201.193.100/seekloc/ws.php", { method: "POST", body: form1 });
    data1 = await res.json();
    console.log("Step 1 Output:", JSON.stringify(data1, null, 2));
  } catch (err) {
    console.error("Step 1 Failed:", err);
    return;
  }

  const id = data1.docs?.[0]?.id || data1.pessoa?.id || data1.id;
  if (!id) {
    console.log("No ID found in Step 1!");
    return;
  }

  console.log(`\nStep 2: Using tp=3 with id=${id} to get details...`);
  const form2 = new FormData();
  form2.append("usr", user);
  form2.append("pwd", pwd);
  form2.append("emp", emp);
  form2.append("tp", "3");
  form2.append("id", id);
  form2.append("doc", documento);

  try {
    const res = await fetch("http://200.201.193.100/seekloc/ws.php", { method: "POST", body: form2 });
    const data2 = await res.json();
    console.log("Step 2 Output:", JSON.stringify(data2, null, 2));
  } catch (err) {
    console.error("Step 2 Failed:", err);
  }
}

testSeeklocFlow();
