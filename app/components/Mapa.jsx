"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  Marker,
  ZoomControl,
  ScaleControl,
} from "react-leaflet";

import L from "leaflet";
import "leaflet/dist/leaflet.css";

const GEO_URL = process.env.NEXT_PUBLIC_GEO_URL;
const CRM_URL = process.env.NEXT_PUBLIC_CRM_URL;

function getFeatId(feature) {
  const p = feature?.properties || {};

  if (p.nome != null) {
    const s = String(p.nome).trim();
    if (/^\d+$/.test(s)) return String(Number(s));
  }

  const candidates = [p.id, p.ID, p.territorio, p.TERRITORIO, p["Território"]];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (/^\d+$/.test(s)) return String(Number(s));
  }

  return null;
}

function formatRegional(value) {
  if (!value) return "Regional não informada";
  return String(value).replace(/^SER\s*/i, "Regional ").trim();
}

function normalizeBairros(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item).split(";"))
      .map((bairro) => bairro.trim())
      .filter(Boolean);
  }

  return String(value)
    .split(";")
    .map((bairro) => bairro.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function colorScale(value, max) {
  if (!value || !max) return "#dbeafe";

  const t = Math.min(1, value / max);

  const start = [219, 234, 254];
  const mid = [96, 165, 250];
  const end = [30, 64, 175];

  const a = t < 0.55 ? start : mid;
  const b = t < 0.55 ? mid : end;
  const k = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45;

  const mix = (x, y) => Math.round(x + (y - x) * k);

  return `rgb(${mix(a[0], b[0])}, ${mix(a[1], b[1])}, ${mix(a[2], b[2])})`;
}

function toRoman(value) {
  const num = Number(value);

  if (!Number.isFinite(num) || num <= 0) return "?";

  const table = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];

  let n = num;
  let result = "";

  for (const [arabic, roman] of table) {
    while (n >= arabic) {
      result += roman;
      n -= arabic;
    }
  }

  return result;
}

function getRegionalRoman(value) {
  const text = String(value ?? "").toUpperCase();

  const roman = text.match(/\b[IVXLCDM]+\b/);
  if (roman) return roman[0];

  const number = text.match(/\d+/);
  if (number) return toRoman(Number(number[0]));

  return "?";
}

function cloneBounds(bounds) {
  return L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
}

function makeAreaLabelIcon(label, active = false) {
  const safeLabel = escapeHtml(label);

  return L.divIcon({
    className: "areaLabelIcon",
    html: `
      <div class="mapAreaLabel ${active ? "selected" : ""} ${String(label).length > 4 ? "long" : ""
      }">
        ${safeLabel}
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function aggregateHistory(items) {
  const byMonth = new Map();

  items.forEach((item) => {
    (item?.historico || []).forEach((h) => {
      const mes = h?.mes;
      if (!mes) return;

      const qtd = Number(h?.quantidade || 0);
      byMonth.set(mes, (byMonth.get(mes) || 0) + qtd);
    });
  });

  return Array.from(byMonth.entries()).map(([mes, quantidade]) => ({
    mes,
    quantidade,
  }));
}

function HistoryBars({ historico }) {
  const max = Math.max(1, ...historico.map((h) => Number(h.quantidade || 0)));

  if (!historico.length) {
    return <div className="emptyState">Sem histórico mensal disponível.</div>;
  }

  return (
    <div className="historyBars">
      {historico.map((h) => {
        const value = Number(h.quantidade || 0);
        const width = `${Math.max(3, (value / max) * 100)}%`;

        return (
          <div className="historyRow" key={h.mes}>
            <div className="historyMonth">{h.mes}</div>

            <div className="historyTrack" aria-hidden="true">
              <div className="historyFill" style={{ width }} />
            </div>

            <div className="historyValue">{value}</div>
          </div>
        );
      })}
    </div>
  );
}

function Legend() {
  const steps = [100, 200, 300, 400, 500];

  return (
    <div className="legend">
      <div className="legendTitle">Quantidade</div>

      <div className="legendScale">
        {steps.map((value) => (
          <div className="legendItem" key={value}>
            <span
              className="legendColor"
              style={{ background: colorScale(value, 500) }}
            />
            <span>{value}+</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailsPanel({ selectedData, mode, onClose }) {
  if (!selectedData) {
    return (
      <aside className="detailsPanel compact">
        <div className="panelHeader">
          <div>
            <div className="eyebrow">Mapa de violências</div>
            <h2>Selecione uma área</h2>
          </div>
        </div>

        <p className="muted">
          Passe o mouse sobre o mapa para identificação rápida. Clique em um
          território ou regional para abrir o histórico mensal completo.
        </p>
      </aside>
    );
  }

  const bairros = selectedData.bairros || [];
  const historico = selectedData.historico || [];
  const last = historico[historico.length - 1];
  const peak = historico.reduce(
    (acc, item) =>
      Number(item.quantidade || 0) > Number(acc?.quantidade || 0) ? item : acc,
    historico[0]
  );

  return (
    <aside className="detailsPanel">
      <div className="panelHeader">
        <div>
          <div className="eyebrow">
            {mode === "regional" ? "Visualização regional" : "Visualização territorial"}
          </div>

          <h2>{selectedData.title}</h2>

          {selectedData.subtitle && (
            <p className="panelSubtitle">{selectedData.subtitle}</p>
          )}
        </div>

        <button className="iconButton" onClick={onClose} aria-label="Fechar painel">
          ×
        </button>
      </div>

      <div className="metricGrid">
        <div className="metricCard">
          <span>Total</span>
          <strong>{selectedData.quantidade}</strong>
        </div>

        <div className="metricCard">
          <span>Bairros</span>
          <strong>{bairros.length}</strong>
        </div>

        <div className="metricCard">
          <span>Último mês</span>
          <strong>{last ? last.quantidade : "—"}</strong>
        </div>

        <div className="metricCard">
          <span>Pico mensal</span>
          <strong>{peak ? peak.quantidade : "—"}</strong>
        </div>
      </div>

      {peak && (
        <div className="insightBox">
          Maior registro mensal em <strong>{peak.mes}</strong>, com{" "}
          <strong>{peak.quantidade}</strong> ocorrências.
        </div>
      )}

      <section className="panelSection">
        <div className="sectionHeader">
          <h3>Histórico mensal</h3>
          <span>{historico.length} meses</span>
        </div>

        <HistoryBars historico={historico} />
      </section>

      {!!bairros.length && (
        <section className="panelSection">
          <div className="sectionHeader">
            <h3>Bairros</h3>
            <span>{bairros.length}</span>
          </div>

          <div className="chips">
            {bairros.map((bairro) => (
              <span className="chip" key={bairro}>
                {bairro}
              </span>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}

export default function Mapa() {
  const [geo, setGeo] = useState(null);
  const [stats, setStats] = useState(null);
  const [mode, setMode] = useState("territorio");
  const [regionalFilter, setRegionalFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const mapRef = useRef(null);
  const geoRef = useRef(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);
        setErrorMsg("");

        const [geoResponse, crmResponse] = await Promise.all([
          fetch(GEO_URL),
          fetch(CRM_URL),
        ]);

        if (!geoResponse.ok) throw new Error("Falha ao carregar GeoJSON.");
        if (!crmResponse.ok) throw new Error("Falha ao carregar CRM.");

        const [g, crm] = await Promise.all([
          geoResponse.json(),
          crmResponse.json(),
        ]);

        if (!alive) return;

        const idx = {};

        (crm?.data || []).forEach((d) => {
          const key = String(
            Number(String(d.territorio).match(/\d+/)?.[0] || 0)
          );

          if (key !== "0") {
            idx[key] = {
              ...d,
              regionalFormatada: formatRegional(d.regional),
              quantidade: Number(d.quantidade || 0),
              bairros: normalizeBairros(d.bairros),
              historico: Array.isArray(d.historico) ? d.historico : [],
            };
          }
        });

        setGeo(g);
        setStats(idx);
      } catch (error) {
        console.error(error);
        setErrorMsg(
          "Não foi possível carregar os dados do mapa. Verifique as URLs do GeoJSON e do CRM."
        );
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, []);

  const regionalStats = useMemo(() => {
    if (!stats) return {};

    const grouped = {};

    Object.entries(stats).forEach(([territorioId, item]) => {
      const regional = item.regionalFormatada || "Regional não informada";

      if (!grouped[regional]) {
        grouped[regional] = {
          key: regional,
          title: regional,
          subtitle: "Dados agregados por regional",
          quantidade: 0,
          bairrosSet: new Set(),
          territorios: [],
          items: [],
        };
      }

      grouped[regional].quantidade += Number(item.quantidade || 0);
      grouped[regional].territorios.push(territorioId);
      grouped[regional].items.push(item);

      (item.bairros || []).forEach((bairro) => {
        grouped[regional].bairrosSet.add(bairro);
      });
    });

    Object.values(grouped).forEach((regional) => {
      regional.bairros = Array.from(regional.bairrosSet).sort();
      regional.historico = aggregateHistory(regional.items);
      delete regional.bairrosSet;
      delete regional.items;
    });

    return grouped;
  }, [stats]);

  const regionalOptions = useMemo(() => {
    return Object.keys(regionalStats).sort((a, b) =>
      a.localeCompare(b, "pt-BR", { numeric: true })
    );
  }, [regionalStats]);

  const visibleGeo = useMemo(() => {
    if (!geo || !stats || regionalFilter === "all") return geo;

    return {
      ...geo,
      features: (geo.features || []).filter((feature) => {
        const id = getFeatId(feature);
        return stats?.[id]?.regionalFormatada === regionalFilter;
      }),
    };
  }, [geo, stats, regionalFilter]);

  const maxTerritory = useMemo(() => {
    if (!stats) return 0;

    return Math.max(
      0,
      ...Object.values(stats)
        .filter((item) =>
          regionalFilter === "all"
            ? true
            : item.regionalFormatada === regionalFilter
        )
        .map((item) => Number(item.quantidade || 0))
    );
  }, [stats, regionalFilter]);

  const maxRegional = useMemo(() => {
    const values = Object.values(regionalStats)
      .filter((item) =>
        regionalFilter === "all" ? true : item.key === regionalFilter
      )
      .map((item) => Number(item.quantidade || 0));

    return Math.max(0, ...values);
  }, [regionalStats, regionalFilter]);

  const activeMax = mode === "regional" ? maxRegional : maxTerritory;

  const getRegionalBounds = useCallback(
    (regionalKey) => {
      if (!visibleGeo || !stats) return null;

      let combinedBounds = null;

      (visibleGeo.features || []).forEach((feature) => {
        const id = getFeatId(feature);
        const item = stats?.[id];

        if (!item || item.regionalFormatada !== regionalKey) return;

        const featureBounds = L.geoJSON(feature).getBounds();

        if (!featureBounds?.isValid()) return;

        if (!combinedBounds) {
          combinedBounds = cloneBounds(featureBounds);
        } else {
          combinedBounds.extend(featureBounds);
        }
      });

      return combinedBounds;
    },
    [visibleGeo, stats]
  );

  const mapLabels = useMemo(() => {
    if (!visibleGeo || !stats) return [];

    const features = visibleGeo.features || [];

    if (mode === "territorio") {
      return features
        .map((feature) => {
          const id = getFeatId(feature);
          const item = stats?.[id];

          if (!id || !item) return null;

          const bounds = L.geoJSON(feature).getBounds();
          if (!bounds?.isValid()) return null;

          const center = bounds.getCenter();

          return {
            key: `territorio-${id}`,
            position: [center.lat, center.lng],
            label: String(Number(id)),
            selected: selected?.type === "territorio" && selected.id === id,
          };
        })
        .filter(Boolean);
    }

    const grouped = new Map();

    features.forEach((feature) => {
      const id = getFeatId(feature);
      const item = stats?.[id];

      if (!item) return;

      const regionalKey = item.regionalFormatada;
      const bounds = L.geoJSON(feature).getBounds();

      if (!bounds?.isValid()) return;

      if (!grouped.has(regionalKey)) {
        grouped.set(regionalKey, {
          key: regionalKey,
          label: getRegionalRoman(regionalKey),
          bounds: cloneBounds(bounds),
        });
      } else {
        grouped.get(regionalKey).bounds.extend(bounds);
      }
    });

    return Array.from(grouped.values()).map((regional) => {
      const center = regional.bounds.getCenter();

      return {
        key: `regional-${regional.key}`,
        position: [center.lat, center.lng],
        label: regional.label,
        selected: selected?.type === "regional" && selected.key === regional.key,
      };
    });
  }, [visibleGeo, stats, mode, selected]);

  const selectedData = useMemo(() => {
    if (!selected || !stats) return null;

    if (selected.type === "regional") {
      return regionalStats[selected.key] || null;
    }

    const item = stats[selected.id];
    if (!item) return null;

    return {
      key: selected.id,
      title: `Território ${selected.id}`,
      subtitle: item.regionalFormatada,
      quantidade: item.quantidade,
      bairros: item.bairros || [],
      historico: item.historico || [],
    };
  }, [selected, stats, regionalStats]);

  const fitToGeo = useCallback(() => {
  const map = mapRef.current;
  const layer = geoRef.current;

  if (!map || !layer?.getBounds) return;

  const bounds = layer.getBounds();

  if (bounds?.isValid()) {
    map.fitBounds(bounds, {
      paddingTopLeft: [28, 120],
      paddingBottomRight: [430, 48],
      maxZoom: regionalFilter === "all" ? 12 : 12.25,
      animate: true,
    });
  }
}, [regionalFilter]);

  useEffect(() => {
    const timer = setTimeout(() => fitToGeo(), 80);
    return () => clearTimeout(timer);
  }, [visibleGeo, fitToGeo]);

  const getFeatureValue = useCallback(
    (feature) => {
      const id = getFeatId(feature);
      const item = stats?.[id];

      if (!item) return 0;

      if (mode === "regional") {
        return regionalStats?.[item.regionalFormatada]?.quantidade || 0;
      }

      return item.quantidade || 0;
    },
    [stats, regionalStats, mode]
  );

  const isFeatureSelected = useCallback(
    (feature) => {
      const id = getFeatId(feature);
      const item = stats?.[id];

      if (!selected || !item) return false;

      if (selected.type === "regional") {
        return item.regionalFormatada === selected.key;
      }

      return selected.id === id;
    },
    [selected, stats]
  );

  const baseStyle = useCallback(
    (feature) => {
      const value = getFeatureValue(feature);
      const selectedFeature = isFeatureSelected(feature);

      return {
        color: selectedFeature ? "#0f172a" : "#2563eb",
        weight: selectedFeature ? 3 : mode === "regional" ? 1.1 : 1.25,
        fillColor: colorScale(value, activeMax),
        fillOpacity: value ? (selectedFeature ? 0.58 : 0.36) : 0.08,
        opacity: 0.95,
        dashArray: mode === "regional" ? "0" : "0",
      };
    },
    [getFeatureValue, isFeatureSelected, activeMax, mode]
  );

  const handleSelectFeature = useCallback(
    (feature, layer) => {
      const id = getFeatId(feature);
      const item = stats?.[id];

      if (!id || !item) return;

      let targetBounds = null;

      if (mode === "regional") {
        setSelected({
          type: "regional",
          key: item.regionalFormatada,
        });

        targetBounds = getRegionalBounds(item.regionalFormatada);
      } else {
        setSelected({
          type: "territorio",
          id,
        });

        targetBounds = layer?.getBounds?.();
      }

      const map = mapRef.current;

      if (map && targetBounds?.isValid()) {
        map.fitBounds(targetBounds, {
          paddingTopLeft: [28, 120],
          paddingBottomRight: [430, 80],
          maxZoom: mode === "regional" ? 11.8 : 12.25,
          animate: true,
        });
      }
    },
    [stats, mode, getRegionalBounds]
  );

  const onEach = useCallback(
    (feature, layer) => {
      const id = getFeatId(feature);
      const item = stats?.[id];

      if (!id || !item) return;

      const total = Number(item.quantidade || 0);
      const regional = item.regionalFormatada;

      const tooltip =
        mode === "regional"
          ? `
            <div class="mapTooltip">
              <strong>${escapeHtml(regional)}</strong>
              <span>Total agregado: ${escapeHtml(
            regionalStats?.[regional]?.quantidade || 0
          )}</span>
              <small>Clique para abrir o painel da regional</small>
            </div>
          `
          : `
            <div class="mapTooltip">
              <strong>Território ${escapeHtml(id)}</strong>
              <span>${escapeHtml(regional)}</span>
              <span>Total: ${escapeHtml(total)}</span>
              <small>Clique para abrir o histórico</small>
            </div>
          `;

      layer.bindTooltip(tooltip, {
        sticky: true,
        direction: "top",
        opacity: 0.96,
        className: "cleanTooltip",
      });

      layer.on({
        mouseover: (event) => {
          event.target.setStyle({
            weight: 3,
            fillOpacity: 0.58,
          });

          event.target.bringToFront();
        },

        mouseout: (event) => {
          event.target.setStyle(baseStyle(feature));
        },

        click: () => {
          handleSelectFeature(feature, layer);
        },
      });
    },
    [stats, mode, regionalStats, baseStyle, handleSelectFeature]
  );

  function resetView() {
    setSelected(null);
    fitToGeo();
  }

  function changeMode(nextMode) {
    setMode(nextMode);
    setSelected(null);
  }

  function changeRegionalFilter(value) {
    setRegionalFilter(value);
    setSelected(null);
  }

  return (
    <div className="mapPage">
      <MapContainer
        ref={mapRef}
        center={[-3.73, -38.54]}
        zoom={12}
        minZoom={10.5}
        maxZoom={17}
        zoomSnap={0.25}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={180}
        wheelDebounceTime={90}
        scrollWheelZoom
        zoomControl={false}
        preferCanvas
        className="mapCanvas"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />

        <ZoomControl position="topleft" />
        <ScaleControl position="bottomleft" imperial={false} />

        {visibleGeo && stats && (
          <GeoJSON
            key={`${mode}-${regionalFilter}-${selected?.type || "none"}-${selected?.id || selected?.key || "none"
              }`}
            ref={geoRef}
            data={visibleGeo}
            style={baseStyle}
            onEachFeature={onEach}
          />
        )}

        {mapLabels.map((label) => (
          <Marker
            key={label.key}
            position={label.position}
            icon={makeAreaLabelIcon(label.label, label.selected)}
            interactive={false}
          />
        ))}
      </MapContainer>

      <header className="topBar">
        <div>
          <h1>Mapa de Violências</h1>
          <p className="sourceText">Fonte: CRM Fortaleza</p>
        </div>

        <div className="topControls">
          <div className="segmented">
            <button
              className={mode === "territorio" ? "active" : ""}
              onClick={() => changeMode("territorio")}
            >
              Territórios
            </button>

            <button
              className={mode === "regional" ? "active" : ""}
              onClick={() => changeMode("regional")}
            >
              Regionais
            </button>
          </div>

          <select
            value={regionalFilter}
            onChange={(event) => changeRegionalFilter(event.target.value)}
          >
            <option value="all">Todas as regionais</option>
            {regionalOptions.map((regional) => (
              <option value={regional} key={regional}>
                {regional}
              </option>
            ))}
          </select>

          <button className="ghostButton" onClick={resetView}>
            Recentrar
          </button>
        </div>
      </header>

      <Legend />

      <DetailsPanel
        selectedData={selectedData}
        mode={mode}
        onClose={() => setSelected(null)}
      />

      {loading && (
        <div className="loadingOverlay">
          <div className="loaderCard">Carregando dados do mapa…</div>
        </div>
      )}

      {!!errorMsg && (
        <div className="errorToast">
          {errorMsg}
        </div>
      )}

      <style jsx global>{`
        html,
        body {
          margin: 0;
          background: #f8fafc;
        }

        .mapPage {
          position: relative;
          width: 100%;
          height: 100vh;
          overflow: hidden;
          background: #f8fafc;
          color: #0f172a;
          font-family: "Poppins", sans-serif;
        }

        .mapCanvas {
          width: 100%;
          height: 100%;
          background: #eef2f7;
        }

        .topBar {
          position: absolute;
          top: 18px;
          left: 18px;
          right: 18px;
          z-index: 1100;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 14px 16px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 20px 45px rgba(15, 23, 42, 0.12);
          backdrop-filter: blur(14px);
        }

        
        .eyebrow {
  color: #2563eb;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.topBar h1 {
  margin: 0;
  color: #6963a5;
  font-size: 22px;
  line-height: 1.1;
  letter-spacing: -0.035em;
}

.sourceText {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.leaflet-top.leaflet-left {
  top: 132px;
  left: 18px;
}

.leaflet-bottom.leaflet-left {
  bottom: 112px;
  left: 18px;
}

.leaflet-control-zoom {
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.38) !important;
  border-radius: 14px !important;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.14) !important;
}

.leaflet-control-zoom a {
  width: 36px !important;
  height: 36px !important;
  line-height: 36px !important;
  border: 0 !important;
  color: #0f172a !important;
  font-weight: 800;
}

.leaflet-control-scale {
  margin: 0 !important;
}

.areaLabelIcon {
  border: 0 !important;
  background: transparent !important;
}

.mapAreaLabel {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(15, 23, 42, 0.22);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #1e293b;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
  backdrop-filter: blur(8px);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: -0.02em;
  pointer-events: none;
  user-select: none;
}

.mapAreaLabel.long {
  font-size: 10px;
}

.mapAreaLabel.selected {
  background: #6963a5;
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.9);
  transform: scale(1.08);
}

        .topControls {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .segmented {
          display: flex;
          padding: 3px;
          border-radius: 999px;
          background: #e2e8f0;
        }

        .segmented button,
        .ghostButton,
        .iconButton,
        select {
          border: 0;
          font: inherit;
        }

        .segmented button {
          cursor: pointer;
          padding: 8px 13px;
          border-radius: 999px;
          background: transparent;
          color: #475569;
          font-size: 13px;
          font-weight: 700;
        }

        .segmented button.active {
          background: #ffffff;
          color: #0f172a;
          box-shadow: 0 5px 14px rgba(15, 23, 42, 0.12);
        }

        select {
          min-width: 190px;
          padding: 9px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          background: #ffffff;
          color: #0f172a;
          font-size: 13px;
          font-weight: 650;
          outline: none;
        }

        .ghostButton {
          cursor: pointer;
          padding: 9px 12px;
          border-radius: 12px;
          background: #0f172a;
          color: #ffffff;
          font-size: 13px;
          font-weight: 750;
        }

        .legend {
  position: absolute;
  left: 18px;
  bottom: 18px;
  z-index: 1000;
  width: 280px;
  padding: 13px 14px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(12px);
}

        .legendTitle {
          margin-bottom: 10px;
          font-size: 12px;
          font-weight: 800;
          color: #334155;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .legendScale {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 8px;
        }

        .legendItem {
          display: flex;
          flex-direction: column;
          gap: 5px;
          color: #475569;
          font-size: 11px;
          font-weight: 700;
        }

        .legendColor {
          width: 100%;
          height: 9px;
          border-radius: 999px;
          border: 1px solid rgba(15, 23, 42, 0.1);
        }

        .detailsPanel {
          position: absolute;
          top: 98px;
          right: 18px;
          bottom: 18px;
          z-index: 1050;
          width: 370px;
          overflow: auto;
          padding: 18px;
          border: 1px solid rgba(148, 163, 184, 0.32);
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 24px 70px rgba(15, 23, 42, 0.18);
          backdrop-filter: blur(14px);
        }

        .detailsPanel.compact {
          bottom: auto;
        }

        .panelHeader {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          margin-bottom: 14px;
        }

        .panelHeader h2 {
          margin: 4px 0 0;
          font-size: 22px;
          line-height: 1.1;
          letter-spacing: -0.04em;
        }

        .panelSubtitle {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
          font-weight: 650;
        }

        .iconButton {
          cursor: pointer;
          width: 34px;
          height: 34px;
          border-radius: 999px;
          background: #f1f5f9;
          color: #475569;
          font-size: 22px;
          line-height: 1;
        }

        .muted {
          color: #64748b;
          line-height: 1.5;
          font-size: 14px;
        }

        .metricGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin: 16px 0;
        }

        .metricCard {
          padding: 13px;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          background: #f8fafc;
        }

        .metricCard span {
          display: block;
          margin-bottom: 4px;
          color: #64748b;
          font-size: 12px;
          font-weight: 750;
        }

        .metricCard strong {
          font-size: 24px;
          letter-spacing: -0.04em;
        }

        .insightBox {
          margin-bottom: 18px;
          padding: 12px 13px;
          border-radius: 15px;
          background: #eff6ff;
          color: #1e3a8a;
          font-size: 13px;
          line-height: 1.45;
        }

        .panelSection {
          margin-top: 18px;
        }

        .sectionHeader {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .sectionHeader h3 {
          margin: 0;
          font-size: 15px;
          letter-spacing: -0.02em;
        }

        .sectionHeader span {
          color: #64748b;
          font-size: 12px;
          font-weight: 750;
        }

        .historyBars {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .historyRow {
          display: grid;
          grid-template-columns: 112px 1fr 34px;
          align-items: center;
          gap: 8px;
        }

        .historyMonth {
          color: #334155;
          font-size: 12px;
          font-weight: 650;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .historyTrack {
          height: 10px;
          overflow: hidden;
          border-radius: 999px;
          background: #e2e8f0;
        }

        .historyFill {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #60a5fa, #1d4ed8);
          transition: width 280ms ease;
        }

        .historyValue {
          text-align: right;
          color: #0f172a;
          font-size: 12px;
          font-weight: 800;
        }

        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
        }

        .chip {
          padding: 6px 9px;
          border-radius: 999px;
          background: #f1f5f9;
          color: #334155;
          font-size: 12px;
          font-weight: 700;
        }

        .emptyState {
          padding: 12px;
          border-radius: 14px;
          background: #f8fafc;
          color: #64748b;
          font-size: 13px;
        }

        .cleanTooltip {
          padding: 0 !important;
          border: 0 !important;
          border-radius: 14px !important;
          background: transparent !important;
          box-shadow: none !important;
        }

        .cleanTooltip::before {
          display: none;
        }

        .mapTooltip {
          min-width: 170px;
          padding: 10px 11px;
          border: 1px solid rgba(148, 163, 184, 0.32);
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.92);
          color: #ffffff;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.25);
        }

        .mapTooltip strong,
        .mapTooltip span,
        .mapTooltip small {
          display: block;
        }

        .mapTooltip strong {
          margin-bottom: 4px;
          font-size: 13px;
        }

        .mapTooltip span {
          color: #dbeafe;
          font-size: 12px;
          line-height: 1.35;
        }

        .mapTooltip small {
          margin-top: 6px;
          color: #bfdbfe;
          font-size: 11px;
        }

        .loadingOverlay {
          position: absolute;
          inset: 0;
          z-index: 1300;
          display: grid;
          place-items: center;
          background: rgba(248, 250, 252, 0.55);
          backdrop-filter: blur(2px);
        }

        .loaderCard {
          padding: 14px 18px;
          border-radius: 16px;
          background: #ffffff;
          box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);
          color: #334155;
          font-weight: 800;
        }

        .errorToast {
          position: absolute;
          left: 50%;
          bottom: 24px;
          z-index: 1400;
          transform: translateX(-50%);
          max-width: 520px;
          padding: 12px 16px;
          border-radius: 14px;
          background: #991b1b;
          color: white;
          box-shadow: 0 18px 45px rgba(127, 29, 29, 0.25);
          font-size: 13px;
          font-weight: 700;
        }

        @media (max-width: 900px) {
          .topBar {
            align-items: flex-start;
            flex-direction: column;
          }

          .topControls {
            width: 100%;
            justify-content: flex-start;
          }

          .detailsPanel {
            top: auto;
            left: 12px;
            right: 12px;
            bottom: 12px;
            width: auto;
            max-height: 46vh;
            border-radius: 20px;
          }

          .legend {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}