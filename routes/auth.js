import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, message: "Falta username o password" });
    }

    const [rows] = await pool.query(
      "SELECT id, username, rol_id, password_hash FROM usuarios WHERE username = ? LIMIT 1",
      [username]
    );

    if (!rows.length) {
      return res.status(401).json({ ok: false, message: "Usuario o contraseña incorrectos" });
    }

    const user = rows[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ ok: false, message: "Usuario o contraseña incorrectos" });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, rol_id: user.rol_id },
      process.env.JWT_SECRET || "CUSCO_REPORTA_SECRET",
      { expiresIn: "2h" }
    );

    return res.json({
      ok: true,
      token,
      user: { id: user.id, username: user.username, rol_id: user.rol_id },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ ok: false, message: "Error interno en login" });
  }
});
router.post("/register", async (req, res) => {
  try {
    const {
      nombre_completo,
      dni,
      email,
      telefono,
      direccion,
      username,
      password
    } = req.body || {};

    // Validación mínima (ajusta a tus campos reales)
    if (!nombre_completo || !dni || !email || !telefono || !direccion || !username || !password) {
      return res.status(400).json({ ok: false, message: "Faltan campos obligatorios" });
    }

    // Verificar si existe username o dni o email
    const [existe] = await pool.query(
      "SELECT id FROM usuarios WHERE username = ? OR dni = ? OR email = ? LIMIT 1",
      [username, dni, email]
    );
    if (existe.length) {
      return res.status(409).json({ ok: false, message: "El usuario ya existe (username/dni/email)" });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // rol_id (ejemplo: 1 ciudadano, 2 admin). Ajusta si tu BD usa otro.
    const rol_id = 1;

    const [r] = await pool.query(
      `INSERT INTO usuarios (nombre_completo, dni, email, telefono, direccion, username, password_hash, rol_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nombre_completo, dni, email, telefono, direccion, username, password_hash, rol_id]
    );

    const user = { id: r.insertId, nombre_completo, username, rol_id };

    const token = jwt.sign(
      { id: user.id, username: user.username, rol_id: user.rol_id },
      process.env.JWT_SECRET || "CUSCO_REPORTA_SECRET",
      { expiresIn: "2h" }
    );

    return res.status(201).json({ ok: true, token, user });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ ok: false, message: "Error interno en registro" });
  }
});

export default router;
