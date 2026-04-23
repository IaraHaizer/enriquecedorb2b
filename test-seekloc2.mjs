const user = "webservice";
const pwd = "2010";
const emp = "6454";

// Try with FormData format and doc 01833558650
async function testSeekloc() {
  const body = new FormData();
  body.append("usr", user);
  body.append("pwd", pwd);
  body.append("emp", emp);
  body.append("tp", "3");
  body.append("doc", "01833558650");

  try {
    const res = await fetch("http://200.201.193.100/seekloc/ws.php", {
      method: "POST",
      body: body
    });
    
    const text = await res.text();
    console.log("Status FormData tp=3:", res.status);
    console.log("Response:", text.slice(0, 500));
  } catch (e) {
    console.error(e);
  }

  // Also try URLSearchParams just in case tp=3 works for both
  const params = new URLSearchParams();
  params.append("usr", user);
  params.append("pwd", pwd);
  params.append("emp", emp);
  params.append("tp", "3");
  params.append("doc", "01833558650");

  try {
    const res = await fetch("http://200.201.193.100/seekloc/ws.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    
    const text = await res.text();
    console.log("Status URLSearchParams tp=3:", res.status);
    console.log("Response:", text.slice(0, 500));
  } catch (e) {
    console.error(e);
  }

  // Also try tp=1 (CNPJ) with FormData
  const params1 = new FormData();
  params1.append("usr", user);
  params1.append("pwd", pwd);
  params1.append("emp", emp);
  params1.append("tp", "1");
  params1.append("doc", "07526557000100");

  try {
    const res = await fetch("http://200.201.193.100/seekloc/ws.php", {
      method: "POST",
      body: params1
    });
    
    const text = await res.text();
    console.log("Status FormData tp=1:", res.status);
    console.log("Response:", text.slice(0, 500));
  } catch (e) {
    console.error(e);
  }
}

testSeekloc();
