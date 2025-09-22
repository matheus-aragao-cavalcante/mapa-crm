"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";

// URLs da API
const GEO_URL = process.env.NEXT_PUBLIC_GEO_URL;
const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL;

export default function Mapa() {
  const [geo, setGeo] = useState(null);
  const [stats, setStats] = useState(null); // { [territorio]: {regional, quantidade, bairros[] } }
  const geoRef = useRef(null);

  // carrega GeoJSON + CRM em paralelo
  useEffect(() => {
    Promise.all([
      fetch(GEO_URL).then(r => { if (!r.ok) throw new Error("GeoJSON"); return r.json(); }),
      fetch(CRM_URL).then(r => { if (!r.ok) throw new Error("CRM");     return r.json();  }),
    ])
      .then(([g, crm]) => {
        setGeo(g);
        const idx = {};
        (crm?.data || []).forEach(d => { idx[d.territorio] = d; });
        setStats(idx);
      })
      .catch(err => {
        console.error("Falha ao carregar dados:", err);
        alert("Falha ao carregar GeoJSON/CRM. Abra as URLs no navegador e verifique se retornam JSON.");
      });
  }, []);

  // máximo de quantidade para escalar cor
  const maxQ = useMemo(() => {
    if (!stats) return 0;
    return Math.max(0, ...Object.values(stats).map(s => s.quantidade || 0));
  }, [stats]);

  // cor por intensidade (azul claro → azul escuro)
  const colorFor = (q) => {
    if (!q || !maxQ) return "#9ecae1"; // neutro
    const t = Math.min(1, q / maxQ);   // 0..1
    const start = [158, 202, 225];     // rgb para baixo
    const end   = [ 31, 119, 180];     // rgb para alto
    const mix = (a,b)=>Math.round(a+(b-a)*t);
    return `rgb(${mix(start[0],end[0])},${mix(start[1],end[1])},${mix(start[2],end[2])})`;
  };

  const baseStyle = (feature) => {
    const id = feature?.properties?.id;
    const q  = stats?.[id]?.quantidade || 0;
    return {
      color: "#1f77b4",
      weight: 1.25,
      fillColor: colorFor(q),
      fillOpacity: q ? 0.25 : 0.12,
    };
  };

  const onEach = (feature, layer) => {
    const id = feature?.properties?.id;
    const nome = feature?.properties?.nome || "";
    const s = stats?.[id];

    const regional  = s?.regional || "";
    const quantidade = s?.quantidade ?? 0;
    const bairros = (s?.bairros || []).slice(0, 12); // limita lista no tooltip

    const html = `
      <div style="line-height:1.2">
        <div><strong>Território ${id ?? ""}</strong> ${regional ? `(${regional})` : ""}</div>
        ${nome ? `<div style="opacity:.8">${nome}</div>` : ""}
        <div style="margin-top:6px"><strong>Quantidade:</strong> ${quantidade}</div>
        ${bairros.length ? `<div style="margin-top:4px"><strong>Bairros:</strong> ${bairros.join(", ")}${s?.bairros?.length > bairros.length ? "…" : ""}</div>` : ""}
      </div>`;

    layer.bindTooltip(html, { sticky: true });

    layer.on({
      mouseover: (e) => e.target.setStyle({ weight: 2, fillOpacity: 0.35 }),
      mouseout:  (e) => e.target.setStyle(baseStyle(feature)),
      click:     (e) => e.target._map.fitBounds(e.target.getBounds(), { padding: [18,18] })
    });
  };

  // fit bounds quando carregar
  useEffect(() => {
    if (geoRef.current && geo) {
      const bounds = geoRef.current.getBounds?.();
      if (bounds?.isValid()) geoRef.current._map.fitBounds(bounds, { padding: [20,20] });
    }
  }, [geo]);

  // legendinha simples
  const Legend = () => (
    <div style={{
      position:"absolute", bottom:12, left:12,
      background:"#fff", padding:"8px 10px", border:"1px solid #ddd",
      fontSize:12, borderRadius:4
    }}>
      <div style={{fontWeight:600, marginBottom:4}}>Quantidade</div>
      <div style={{display:"flex", gap:4}}>
        {[0, .25, .5, .75, 1].map(t => {
          const q = Math.round(t * (maxQ || 10));
          const c = colorFor(q);
          return <div key={t} style={{display:"flex", alignItems:"center", gap:4}}>
            <div style={{width:18, height:10, background:c, border:"1px solid #aaa"}} />
            <span>{q}</span>
          </div>;
        })}
      </div>
    </div>
  );

  return (
    <div style={{ height: "100vh", width: "100%", background: "#fff", position:"relative" }}>
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
