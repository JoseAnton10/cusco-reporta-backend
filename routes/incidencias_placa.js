import express from "express";
import pool from "../db.js";

const router = express.Router();

// GET /incidencias/placa?placa=X1A-123
router.get("/placa", async (req, res) => {
  try {
    const placa = String(req.query.placa || "").trim().toUpperCase();
    if (!placa) return res.status(400).json({ ok: false, message: "Falta placa" });

    const [rows] = await pool.query(
      `SELECT id, fecha_incidente, titulo, referencia_lugar, distrito, provincia, departamento, estado, placa
       FROM incidencias
       WHERE placa = ?
       ORDER BY fecha_incidente DESC`,
      [placa]
    );

    // “reportado o no”
    return res.json({
      ok: true,
      placa,
      reportado: rows.length > 0,
      total: rows.length,
      incidencias: rows,
    });
  } catch (err) {
    console.error("INCIDENCIA PLACA ERROR:", err);
    return res.status(500).json({ ok: false, message: "Error interno al consultar por placa" });
  }
});

export default router;
