"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";

// URLs da API
const GEO_URL = process.env.NEXT_PUBLIC_GEO_URL;
const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL;

// Extrai o NÚMERO do território a partir do GeoJSON.
// No seu arquivo, o número do território está em `properties.nome` (string "1".."39").
// Se não houver, cai para `properties.id`.
function getFeatId(feature) {
  const p = feature?.properties || {};

  // 1) usar `nome` se for puramente numérico
  if (p.nome != null) {
    const s = String(p.nome).trim();
    if (/^\d+$/.test(s)) return String(Number(s)); // "01" -> "1"
  }

  // 2) fallback para campos id/territorio se existirem
  const candidates = [p.id, p.ID, p.territorio, p.TERRITORIO, p["Território"]];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (/^\d+$/.test(s)) return String(Number(s));
  }

  return null;
}



export default function Mapa() {
  const [geo, setGeo] = useState(null);
  const [stats, setStats] = useState(null); // { [territorio:string]: {regional, quantidade, bairros[], historico[] } }
  const geoRef = useRef(null);

  useEffect(() => {
    Promise.all([
      fetch(GEO_URL).then(r => { if (!r.ok) throw new Error("GeoJSON"); return r.json(); }),
      fetch(CRM_URL).then(r => { if (!r.ok) throw new Error("CRM"); return r.json(); }),
    ])
      .then(([g, crm]) => {
        setGeo(g);
        const idx = {};
        (crm?.data || []).forEach(d => {
          const key = String(Number(String(d.territorio).match(/\d+/)?.[0] || 0));
          if (key !== "0") idx[key] = d;
        });
        setStats(idx);

        // diagnóstico
        try {
          const geoIds = new Set();
          (g.features || []).forEach(f => { const id = getFeatId(f); if (id) geoIds.add(id); });
          const crmIds = new Set(Object.keys(idx));
          const faltandoNoCRM = [...geoIds].filter(k => !crmIds.has(k));
          const sobrandoNoCRM = [...crmIds].filter(k => !geoIds.has(k));
          console.group("%cDiagnóstico IDs", "color:#1f77b4;font-weight:bold");
          console.log("IDs no Geo:", [...geoIds].sort());
          console.log("IDs no CRM:", [...crmIds].sort());
          if (faltandoNoCRM.length) console.warn("Geo sem CRM p/ IDs:", faltandoNoCRM);
          if (sobrandoNoCRM.length) console.warn("CRM sem Geo p/ IDs:", sobrandoNoCRM);
          console.groupEnd();
        } catch { }
      })
      .catch(err => {
        console.error("Falha ao carregar dados:", err);
        alert("Falha ao carregar GeoJSON/CRM. Abra as URLs no navegador e verifique se retornam JSON.");
      });
  }, []);

  const maxQ = useMemo(() => {
    if (!stats) return 0;
    return Math.max(0, ...Object.values(stats).map(s => s.quantidade || 0));
  }, [stats]);

  const colorFor = (q) => {
    if (!q || !maxQ) return "#9ecae1";
    const t = Math.min(1, q / maxQ);
    const start = [158, 202, 225];
    const end = [31, 119, 180];
    const mix = (a, b) => Math.round(a + (b - a) * t);
    return `rgb(${mix(start[0], end[0])},${mix(start[1], end[1])},${mix(start[2], end[2])})`;
  };

  const baseStyle = (feature) => {
    const id = getFeatId(feature);
    const q = stats?.[id]?.quantidade || 0;
    return {
      color: "#1f77b4",
      weight: 1.25,
      fillColor: colorFor(q),
      fillOpacity: q ? 0.25 : 0.12,
    };
  };

  const onEach = (feature, layer) => {
    const id = getFeatId(feature);
    const rawNome = feature?.properties?.nome ?? "";
    // se "nome" for apenas número, não mostra
    const nome = (/^\d+$/.test(String(rawNome)) ? "" : String(rawNome));

    const s = id ? stats?.[id] : null;

    // "SER X" -> "Regional X" na UI (sem mexer no backend)
    const regionalText = s?.regional
      ? String(s.regional).replace(/^SER\s*/i, "Regional ")
      : "";

    const quantidade = s?.quantidade ?? 0;
    const bairrosFull = s?.bairros || [];
    const bairros = bairrosFull.slice(0, 12);
    const historico = s?.historico || [];

    // tooltip (hover)
    const tooltipHtml = `
    <div style="line-height:1.2">
      <div><strong>Território ${id ?? "?"}</strong> ${regionalText ? `(${regionalText})` : ""}</div>
      ${nome ? `<div style="opacity:.8">${nome}</div>` : ""}
      <div style="margin-top:6px"><strong>Quantidade total:</strong> ${quantidade}</div>
      ${bairros.length ? `<div style="margin-top:4px"><strong>Bairros:</strong> ${bairros.join(", ")}${bairrosFull.length > bairros.length ? "…" : ""}</div>` : ""}
      ${historico.length ? `<div style="margin-top:4px; opacity:.75">Clique para ver o histórico mensal</div>` : ""}
    </div>`;
    layer.bindTooltip(tooltipHtml, { sticky: true });

    const histHtml = historico.length
      ? `
    <div style="min-width:280px; line-height:1.3">
      <div style="font-weight:700; margin-bottom:8px">
        Território ${id ?? "?"} ${regionalText ? `(${regionalText})` : ""}
      </div>

      ${nome ? `<div style="opacity:.85; margin-bottom:8px">${nome}</div>` : ""}

      <div style="margin-bottom:8px">
        <span style="display:inline-block; font-weight:700; margin-right:6px;">Total:</span>
        <span>${quantidade}</span>
      </div>

      <div style="font-weight:700; margin-bottom:6px;">Histórico</div>

      <table style="
        width:100%;
        border-collapse:separate;
        border-spacing:0;
        border:1px solid #e6e6e6;
        border-radius:6px;
        overflow:hidden;
        font-size:13px;
      ">
        <thead>
          <tr style="background:#f7f7f7;">
            <th style="text-align:left; padding:8px 10px; border-bottom:1px solid #e6e6e6;">Mês/ano</th>
            <th style="text-align:right; padding:8px 10px; border-bottom:1px solid #e6e6e6;">Quantidade de violências</th>
          </tr>
        </thead>
        <tbody>
          ${historico.map((h, i) => `
            <tr style="${i % 2 ? 'background:#fcfcfc;' : ''}">
              <td style="padding:8px 10px;">${h.mes}</td>
              <td style="padding:8px 10px; text-align:right; font-weight:600;">${h.quantidade}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`
      : `<div style="min-width:240px">Sem histórico para este território.</div>`;


    // handlers
    layer.on({
      mouseover: (e) => e.target.setStyle({ weight: 2, fillOpacity: 0.35 }),
      mouseout: (e) => e.target.setStyle(baseStyle(feature)),
      click: (e) => {
        // só abre popup se tiver um ID válido
        if (id) {
          e.target._map.fitBounds(e.target.getBounds(), { padding: [18, 18] });
          e.target.openPopup();
        }
      }
    });
    layer.bindPopup(histHtml, { maxWidth: 360 });
  };



  useEffect(() => {
    if (geoRef.current && geo) {
      const bounds = geoRef.current.getBounds?.();
      if (bounds?.isValid()) geoRef.current._map.fitBounds(bounds, { padding: [20, 20] });
    }
  }, [geo]);

  const Legend = () => (
    <div style={{
      position: "absolute", bottom: 12, left: 12,
      background: "#fff", padding: "8px 10px", border: "1px solid #ddd",
      fontSize: 12, borderRadius: 4
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Quantidade</div>
      <div style={{ display: "flex", gap: 4 }}>
        {[0, .25, .5, .75, 1].map(t => {
          const q = Math.round(t * (maxQ || 10));
          const c = colorFor(q);
          return <div key={t} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 18, height: 10, background: c, border: "1px solid #aaa" }} />
            <span>{q}</span>
          </div>;
        })}
      </div>
    </div>
  );

  return (
    <div style={{ height: "100vh", width: "100%", background: "#fff", position: "relative" }}>
      <Legend />
      <MapContainer
        center={[-3.73, -38.54]}
        zoom={11}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {geo && (
          <GeoJSON
            ref={geoRef}
            data={geo}
            style={baseStyle}
            onEachFeature={onEach}
          />
        )}
      </MapContainer>
    </div>
  );
}
