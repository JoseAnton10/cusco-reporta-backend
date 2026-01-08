import express from "express";
import pool from "../db.js";

const router = express.Router();

// GET /categorias_incidencia
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nombre FROM categorias_incidencia ORDER BY nombre ASC"
    );
    return res.json({ ok: true, categorias: rows });
  } catch (err) {
    console.error("CATEGORIAS ERROR:", err);
    return res.status(500).json({ ok: false, message: "Error al listar categorías" });
  }
});

export default router;
