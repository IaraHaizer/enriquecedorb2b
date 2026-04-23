const user = "webservice";
const pwd = "2010";
const emp = "6454";
const documento = "07526557000100"; // Ambev CNPJ
const tipo = "1";

const body = new URLSearchParams();
body.append("usr", user);
body.append("pwd", pwd);
body.append("emp", emp);
body.append("tp", tipo);
body.append("doc", documento);

console.log("Fetching Seekloc...");

fetch("http://200.201.193.100/seekloc/ws.php", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "Mozilla/5.0",
  },
  body: body.toString(),
})
  .then((res) => {
    console.log("Status:", res.status);
    return res.text();
  })
  .then((text) => {
    console.log("Response length:", text.length);
    console.log("Response text:", text.slice(0, 500));
  })
  .catch((err) => {
    console.error("Error:", err);
  });
