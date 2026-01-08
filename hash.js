import bcrypt from "bcryptjs";

const password = "Juanp123";

const hash = await bcrypt.hash(password, 10);
console.log("PASSWORD:", password);
console.log("HASH:", hash);

