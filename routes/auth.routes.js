import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

/**
 * POST /auth/login
 * body: { username, password }
 */
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ ok: false, message: "Faltan datos" });
    }

    // ⚠️ AJUSTA nombres de columnas según tu tabla usuarios
    const [rows] = await pool.query(
      `SELECT id, username, password_hash, estado
       FROM usuarios
       WHERE username = ? LIMIT 1`,
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ ok: false, message: "Usuario no existe" });
    }

    const user = rows[0];

    // Si tu password está guardado como texto plano:
    // if (user.password_hash !== password) ...

    // Si tu password está hasheado, avísame y lo conectamos con bcrypt.
    if (user.password_hash !== password) {
      return res.status(401).json({ ok: false, message: "Contraseña incorrecta" });
    }

    if (user.estado && user.estado !== "ACTIVO") {
      return res.status(403).json({ ok: false, message: "Usuario inactivo" });
    }

    // respuesta mínima (luego podemos agregar JWT)
    return res.json({
      ok: true,
      user: { id: user.id, username: user.username,rol_id: user.rol_id,
      nombre_completo: user.nombre_completo,
      email: user.email, },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, message: "Error del servidor" });
  }
});

export default router;
