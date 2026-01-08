import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.js";
import pool from "./db.js";
import incidenciasRouter from "./routes/incidencias.js";
import incidenciasCreateRouter from "./routes/incidencias_create.js";
import incidenciasPlacaRouter from "./routes/incidencias_placa.js";
import categoriasRouter from "./routes/categorias_incidencia.js";

import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

// prueba conexión

// Ruta auth
// Para servir imágenes (uploads)
app.use("/uploads", express.static("uploads"));
app.use("/auth", authRoutes);
app.use("/incidencias", incidenciasRouter);
app.use("/incidencias", incidenciasCreateRouter);
app.use("/incidencias", incidenciasPlacaRouter);
app.use("/categorias_incidencia", categoriasRouter);

app.get("/ping", async (req, res) => {
  const [rows] = await pool.query("SELECT 1 AS ok");
  res.json({ ok: true, rows });
});

// listar incidencias (para mapa/panel)
app.get("/incidencias", async (req, res) => {
  const [rows] = await pool.query(`
    SELECT *
    FROM vw_incidencias_panel
    ORDER BY creado_en DESC
    LIMIT 200
  `);
  res.json(rows);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API corriendo en http://localhost:${PORT}`);
});
