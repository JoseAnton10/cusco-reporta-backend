import pool from "./db.js";

try {
  const [rows] = await pool.query("SELECT 1");
  console.log("✅ Conexión a MySQL exitosa");
  process.exit(0);
} catch (err) {
  console.error("❌ Error de conexión:", err.message);
  process.exit(1);
}
