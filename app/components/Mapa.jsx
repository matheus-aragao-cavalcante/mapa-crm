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

const COLOR_RAMP = [
  [239, 246, 255],
  [219, 234, 254],
  [147, 197, 253],
  [59, 130, 246],
  [124, 58, 237],
  [76, 29, 149],
];

function getNiceStep(value) {
  const max = Number(value || 0);

  if (max <= 50) return 10;
  if (max <= 150) return 25;
  if (max <= 400) return 50;
  if (max <= 1000) return 100;
  if (max <= 2000) return 200;
  if (max <= 5000) return 500;

  return 1000;
}

function roundUpToStep(value, step = 50) {
  return Math.ceil(Number(value || 0) / step) * step;
}

function getAdaptiveLegendMax(value) {
  const max = Number(value || 0);

  if (max <= 0) return 50;

  const step = getNiceStep(max);
  return Math.max(step, roundUpToStep(max, step));
}

function getHeatDomainMax(legendMax) {
  return Math.max(1, Number(legendMax || 50));
}

function getLegendSteps(max) {
  const legendMax = Math.max(1, Number(max || 50));

  return Array.from({ length: 5 }, (_, index) =>
    Math.round((legendMax / 5) * (index + 1))
  );
}

function colorScale(value, domainMax = 500) {
  const n = Number(value || 0);
  const max = Math.max(1, Number(domainMax || 500));

  if (!n || n <= 0) return "rgb(239, 246, 255)";

  const ratio = Math.min(1, Math.max(0, n / max));
  const t = Math.pow(ratio, 0.68);
  const scaled = t * (COLOR_RAMP.length - 1);

  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(COLOR_RAMP.length - 1, lowerIndex + 1);

  const lower = COLOR_RAMP[lowerIndex];
  const upper = COLOR_RAMP[upperIndex];

  const k = scaled - lowerIndex;
  const mix = (a, b) => Math.round(a + (b - a) * k);

  return `rgb(${mix(lower[0], upper[0])}, ${mix(
    lower[1],
    upper[1]
  )}, ${mix(lower[2], upper[2])})`;
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

function getResponsiveFitOptions({
  viewport,
  regionalFilter,
  mode,
  isSelection = false,
}) {
  const width = viewport?.width || 1200;
  const height = viewport?.height || 800;

  const isLandscapePhone = width <= 760 && height <= 520;
  const isPhone = width <= 560;
  const isTablet = width <= 900;

  const baseMaxZoom =
    mode === "regional" ? 14 : regionalFilter === "all" ? 14 : 13.25;

  if (isLandscapePhone) {
    return {
      paddingTopLeft: [14, 76],
      paddingBottomRight: [isSelection ? 308 : 14, 14],
      maxZoom: Math.min(baseMaxZoom, regionalFilter === "all" ? 11.5 : 12),
      animate: true,
    };
  }

  if (isPhone) {
    return {
      paddingTopLeft: [14, 156],
      paddingBottomRight: [14, isSelection ? 286 : 72],
      maxZoom: Math.min(baseMaxZoom, regionalFilter === "all" ? 11.4 : 12),
      animate: true,
    };
  }

  if (isTablet) {
    return {
      paddingTopLeft: [18, 154],
      paddingBottomRight: [isSelection ? 24 : 18, isSelection ? 260 : 74],
      maxZoom: Math.min(baseMaxZoom, 12),
      animate: true,
    };
  }

  return {
    paddingTopLeft: [28, 120],
    paddingBottomRight: [430, 48],
    maxZoom: baseMaxZoom,
    animate: true,
  };
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

  return Array.from(byMonth.entries())
  .map(([mes, quantidade]) => ({
    mes,
    quantidade,
    key: parseMonthKey(mes),
  }))
  .sort((a, b) => String(a.key || "").localeCompare(String(b.key || "")))
  .map(({ mes, quantidade }) => ({ mes, quantidade }));
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

function Legend({
  steps,
  scaleMax,
  heatDomainMax,
  adaptiveLegendMax,
  scaleMaxOverride,
  onScaleMaxChange,
  onAutoScale,
  scaleControlOpen,
  onToggleScaleControl,
}) {
  const sliderStep = getNiceStep(adaptiveLegendMax);
  const sliderMax = Math.max(
    sliderStep * 5,
    adaptiveLegendMax + sliderStep * 6
  );

  return (
    <div className={`legend ${scaleControlOpen ? "expanded" : "compact"}`}>
      <div className="legendHeader">
        <div className="legendTitle">Quantidade</div>

        <button
          type="button"
          className="legendToggleButton"
          onClick={onToggleScaleControl}
          aria-label={
            scaleControlOpen
              ? "Ocultar controle da escala máxima"
              : "Mostrar controle da escala máxima"
          }
          title={
            scaleControlOpen
              ? "Ocultar escala máxima"
              : "Ajustar escala máxima"
          }
        >
          ▦
        </button>
      </div>

      <div className="legendScale">
        {steps.map((value, index) => {
          const isLast = index === steps.length - 1;

          return (
            <div className="legendItem" key={value}>
              <span
                className="legendColor"
                style={{ background: colorScale(value, heatDomainMax) }}
              />
              <span>{isLast ? `${value}+` : value}</span>
            </div>
          );
        })}
      </div>

      {scaleControlOpen && (
        <div className="legendControl">
          <div className="legendControlHeader">
            <span>Escala máxima</span>
            <strong>{scaleMax}+</strong>
          </div>

          <input
            type="range"
            min={sliderStep}
            max={sliderMax}
            step={sliderStep}
            value={scaleMax}
            onChange={(event) => onScaleMaxChange(Number(event.target.value))}
          />

          <button
            type="button"
            className="legendAutoButton"
            onClick={onAutoScale}
            disabled={scaleMaxOverride == null}
          >
            Auto
          </button>
        </div>
      )}
    </div>
  );
}

function TemporalChart({ historico, selectedMonthKey, onMonthClick }) {
  const data = [...(historico || [])].filter((item) =>
    Number.isFinite(Number(item.quantidade))
  );

  if (data.length < 2) {
    return null;
  }

  const width = 320;
  const height = 120;
  const padding = 16;

  const max = Math.max(1, ...data.map((item) => Number(item.quantidade || 0)));

  const points = data.map((item, index) => {
    const x =
      padding +
      (index / Math.max(1, data.length - 1)) * (width - padding * 2);

    const y =
      height -
      padding -
      (Number(item.quantidade || 0) / max) * (height - padding * 2);

    return { x, y, item, monthKey: parseMonthKey(item.mes) };
  });

  const path = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <section className="panelSection temporalChartSection">
      <div className="sectionHeader">
        <h3>Evolução temporal</h3>
        <span>{data.length} meses</span>
      </div>

      <div className="temporalChart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img">
          <polyline
            points={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {points.map((point) => {
            const value = Number(point.item.quantidade || 0);
            const isActive =
              !!point.monthKey && point.monthKey === selectedMonthKey;

            return (
              <g
                key={`${point.item.mes}-${point.x}`}
                className={`temporalPoint ${isActive ? "active" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`Filtrar mapa por ${point.item.mes}, ${value} ocorrências`}
                onClick={() => onMonthClick?.(point.monthKey)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onMonthClick?.(point.monthKey);
                  }
                }}
              >
                <title>{`${point.item.mes}: ${formatNumber(value)} ocorrências`}</title>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isActive ? 6 : 4}
                  fill="currentColor"
                />
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("pt-BR");
}

function formatDelta(value) {
  const number = Number(value || 0);

  if (number > 0) return `+${formatNumber(number)}`;
  return formatNumber(number);
}

function formatPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";

  const number = Number(value);
  const sign = number > 0 ? "+" : "";

  return `${sign}${number.toFixed(1).replace(".", ",")}%`;
}

function ComparisonItems({ items, periodMode }) {
  if (!items || items.length < 2) return null;

  return (
    <section className="panelSection">
      <div className="sectionHeader">
        <h3>Áreas comparadas</h3>
        <span>{items.length}</span>
      </div>

      <div className="comparisonList">
        {items.map((item) => {
          const quantidadeA = Number(item.quantidade || 0);
          const quantidadeB =
            item.compareQuantidade == null
              ? null
              : Number(item.compareQuantidade || 0);

          const delta =
            quantidadeB == null ? null : quantidadeA - quantidadeB;

          const percent =
            quantidadeB && quantidadeB !== 0
              ? (delta / quantidadeB) * 100
              : null;

          return (
            <div className="comparisonItem" key={item.key}>
              <div>
                <strong>{item.title}</strong>

                {item.subtitle && (
                  <span>{item.subtitle}</span>
                )}
              </div>

              <div className="comparisonNumbers">
                <strong>{formatNumber(quantidadeA)}</strong>

                {periodMode === "compare" && quantidadeB != null && (
                  <>
                    <small>B: {formatNumber(quantidadeB)}</small>
                    <small>
                      Δ {formatDelta(delta)} · {formatPercent(percent)}
                    </small>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PeriodComparisonSummary({ selectedData, periodMode }) {
  if (periodMode !== "compare") return null;
  if (!selectedData || selectedData.compareQuantidade == null) return null;

  const quantidadeA = Number(selectedData.quantidade || 0);
  const quantidadeB = Number(selectedData.compareQuantidade || 0);

  const delta = quantidadeA - quantidadeB;

  const percent =
    quantidadeB !== 0 ? (delta / quantidadeB) * 100 : null;

  return (
    <section className="panelSection">
      <div className="sectionHeader">
        <h3>Comparação entre períodos</h3>
        <span>A vs B</span>
      </div>

      <div className="periodComparisonGrid">
        <div className="periodMetricCard">
          <span>Período A</span>
          <strong>{formatNumber(quantidadeA)}</strong>
        </div>

        <div className="periodMetricCard">
          <span>Período B</span>
          <strong>{formatNumber(quantidadeB)}</strong>
        </div>

        <div className="periodMetricCard wide">
          <span>Variação A em relação a B</span>
          <strong>{formatDelta(delta)}</strong>
          <small>{formatPercent(percent)}</small>
        </div>
      </div>

      <div className="periodHistoryGrid">
        <div>
          <h4>Histórico do período A</h4>
          <HistoryBars historico={selectedData.historico || []} />
        </div>

        <div>
          <h4>Histórico do período B</h4>
          <HistoryBars historico={selectedData.compareHistorico || []} />
        </div>
      </div>
    </section>
  );
}

function DetailsPanel({
  selectedData,
  mode,
  periodMode,
  onClose,
  onMonthClick,
  selectedMonthKey,
}) {
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
  const chartHistorico = selectedData.fullHistorico || historico;
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

      <PeriodComparisonSummary
      selectedData={selectedData}
      periodMode={periodMode}
    />

     <ComparisonItems
      items={selectedData.comparisonItems}
      periodMode={periodMode}
    />

      <TemporalChart
        historico={chartHistorico}
        selectedMonthKey={selectedMonthKey}
        onMonthClick={onMonthClick}
      />


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

function getSelectionKey(selection) {
 if (!selection) return "";

 return selection.type === "regional"
   ? `regional:${selection.key}`
   : `territorio:${selection.id}`;
}

function sameSelection(a, b) {
 return getSelectionKey(a) === getSelectionKey(b);
}

function toggleSelection(list, item) {
 const exists = list.some((current) => sameSelection(current, item));

 if (exists) {
   return list.filter((current) => !sameSelection(current, item));
 }

 return [...list, item];
}

// helpers 

const MONTHS_PT = {
 janeiro: "01",
 fevereiro: "02",
 marco: "03",
 março: "03",
 abril: "04",
 maio: "05",
 junho: "06",
 julho: "07",
 agosto: "08",
 setembro: "09",
 outubro: "10",
 novembro: "11",
 dezembro: "12",
};

function normalizeText(value) {
 return String(value || "")
   .toLowerCase()
   .normalize("NFD")
   .replace(/[\u0300-\u036f]/g, "");
}

function parseMonthKey(value) {
 const text = normalizeText(value);

 const monthName = Object.keys(MONTHS_PT).find((month) =>
   text.includes(normalizeText(month))
 );

 const yearMatch = text.match(/\d{4}/);
 const shortYearMatch = text.match(/\b\d{2}\b/);

 const year = yearMatch
   ? yearMatch[0]
   : shortYearMatch
     ? `20${shortYearMatch[0]}`
     : null;

 if (!monthName || !year) return null;

 return `${year}-${MONTHS_PT[monthName]}`;
}

function monthKeyToLabel(key) {
 if (!key) return "";

 const [year, month] = key.split("-");
 const monthName = Object.entries(MONTHS_PT).find(
   ([, value]) => value === month
 )?.[0];

 if (!monthName) return key;

 return `${monthName} ${year}`;
}

function periodContains(key, period) {
 if (!key) return false;
 if (!period?.start && !period?.end) return true;
 if (period.start && key < period.start) return false;
 if (period.end && key > period.end) return false;

 return true;
}

function filterHistoryByPeriod(historico, period) {
 return (historico || []).filter((item) =>
   periodContains(parseMonthKey(item.mes), period)
 );
}

function sumHistory(historico) {
 return (historico || []).reduce(
   (sum, item) => sum + Number(item.quantidade || 0),
   0
 );
}


export default function Mapa() {
  // constantes pro filtro de período

const [geo, setGeo] = useState(null);
const [stats, setStats] = useState(null);
const [mode, setMode] = useState("territorio");
const [regionalFilter, setRegionalFilter] = useState("all");
const [selectedItems, setSelectedItems] = useState([]);
const [multiSelect, setMultiSelect] = useState(false);
const [filtersOpen, setFiltersOpen] = useState(false);
const [headerExpanded, setHeaderExpanded] = useState(false);
const [reportOpen, setReportOpen] = useState(false);
const [scaleControlOpen, setScaleControlOpen] = useState(false);
const [hoveredRegional, setHoveredRegional] = useState(null);

const [periodMode, setPeriodMode] = useState("all");
const [periodA, setPeriodA] = useState({ start: "", end: "" });
const [periodB, setPeriodB] = useState({ start: "", end: "" });

const monthOptions = useMemo(() => {
 if (!stats) return [];

 const keys = new Set();

 Object.values(stats).forEach((item) => {
   (item.historico || []).forEach((historyItem) => {
     const key = parseMonthKey(historyItem.mes);
     if (key) keys.add(key);
   });
 });

 return Array.from(keys)
   .sort()
   .map((key) => ({
     key,
     label: monthKeyToLabel(key),
   }));
}, [stats]);

const selectedMonthKey =
  periodMode === "range" && periodA.start && periodA.start === periodA.end
    ? periodA.start
    : "";

const applySingleMonthFilter = useCallback((monthKey) => {
  if (!monthKey) return;

  setPeriodMode("range");
  setPeriodA({ start: monthKey, end: monthKey });
  setPeriodB({ start: "", end: "" });
  setFiltersOpen(true);
}, []);

const getItemHistory = useCallback(
 (item, target = "a") => {
   const historico = item?.historico || [];

   if (periodMode === "all") return historico;

   const period = target === "b" ? periodB : periodA;

   return filterHistoryByPeriod(historico, period);
 },
 [periodMode, periodA, periodB]
);

const getItemQuantity = useCallback(
 (item, target = "a") => {
   if (periodMode === "all") {
     return Number(item?.quantidade || 0);
   }

   return sumHistory(getItemHistory(item, target));
 },
 [periodMode, getItemHistory]
);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const mapRef = useRef(null);
  const geoRef = useRef(null);
  const regionalLayersRef = useRef(new Map());

  const [viewport, setViewport] = useState({
    width: 1200,
    height: 800,
  });


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

  useEffect(() => {
    function updateViewport() {
      const nextViewport = {
        width: window.innerWidth,
        height: window.innerHeight,
      };

      setViewport(nextViewport);

      window.requestAnimationFrame(() => {
        mapRef.current?.invalidateSize?.();
      });
    }

    updateViewport();

    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
    };
  }, []);

  useEffect(() => {
    if (!selectedItems.length) {
      setReportOpen(false);
    }
  }, [selectedItems.length]);


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
        compareQuantidade: 0,
        bairrosSet: new Set(),
        territorios: [],
        items: [],
  };
  }

        grouped[regional].quantidade += getItemQuantity(item, "a");
        if (periodMode === "compare") {
        grouped[regional].compareQuantidade += getItemQuantity(item, "b");
  }
        grouped[regional].territorios.push(territorioId);
        grouped[regional].items.push(item);

        (item.bairros || []).forEach((bairro) => {
          grouped[regional].bairrosSet.add(bairro);
        });
      });

      Object.values(grouped).forEach((regional) => {
    regional.bairros = Array.from(regional.bairrosSet).sort();

    regional.fullHistorico = aggregateHistory(regional.items);

    regional.historico = aggregateHistory(
      regional.items.map((item) => ({
        ...item,
        historico: getItemHistory(item, "a"),
      }))
    );

    regional.compareHistorico =
      periodMode === "compare"
        ? aggregateHistory(
            regional.items.map((item) => ({
              ...item,
              historico: getItemHistory(item, "b"),
            }))
          )
        : [];

    delete regional.bairrosSet;
    delete regional.items;
  });

    return grouped;
  }, [stats, getItemQuantity, getItemHistory, periodMode]);

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
      .map((item) => getItemQuantity(item, "a"))
  );
}, [stats, regionalFilter, getItemQuantity]);

  const maxRegional = useMemo(() => {
    const values = Object.values(regionalStats)
      .filter((item) =>
        regionalFilter === "all" ? true : item.key === regionalFilter
      )
      .map((item) => Number(item.quantidade || 0));

    return Math.max(0, ...values);
  }, [regionalStats, regionalFilter]);

  const activeMax = mode === "regional" ? maxRegional : maxTerritory;

  const [scaleMaxOverride, setScaleMaxOverride] = useState(null);

  const adaptiveLegendMax = useMemo(
  () => getAdaptiveLegendMax(activeMax),
  [activeMax]
  );

  const scaleMax = scaleMaxOverride ?? adaptiveLegendMax;

  const heatDomainMax = useMemo(
  () => getHeatDomainMax(scaleMax),
  [scaleMax]
  );

  const legendSteps = useMemo(
  () => getLegendSteps(scaleMax),
  [scaleMax]
  );


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
            selected: selectedItems.some(
            (selection) => selection.type === "territorio" && selection.id === id
          ),
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
        selected: selectedItems.some(
        (selection) => selection.type === "regional" && selection.key === regional.key
      ),
      };
    });
  }, [visibleGeo, stats, mode, selectedItems]);

  const regionalHighlightGeo = useMemo(() => {
    if (mode !== "regional" || !visibleGeo || !stats) return null;

    const regionalKeys = new Set();

    if (hoveredRegional) {
      regionalKeys.add(hoveredRegional);
    }

    selectedItems.forEach((selection) => {
      if (selection.type === "regional") {
        regionalKeys.add(selection.key);
      }
    });

    if (!regionalKeys.size) return null;

    return {
      ...visibleGeo,
      features: (visibleGeo.features || []).filter((feature) => {
        const id = getFeatId(feature);
        const item = stats?.[id];

        return item && regionalKeys.has(item.regionalFormatada);
      }),
    };
  }, [mode, visibleGeo, stats, hoveredRegional, selectedItems]);

  const regionalHighlightStyle = useCallback(
    () => ({
      color: "#0f172a",
      weight: 3.5,
      fillColor: "#0f172a",
      fillOpacity: 0.06,
      opacity: 1,
      dashArray: "0",
    }),
    []
  );

  const selectedData = useMemo(() => {
    if (!selectedItems.length || !stats) return null;

 
    const dataItems = selectedItems
   .map((selection) => {
     if (selection.type === "regional") {
       return regionalStats[selection.key] || null;
     }

     const item = stats[selection.id];
     if (!item) return null;

     return {
      key: selection.id,
      title: `Território ${selection.id}`,
      subtitle: item.regionalFormatada,
      quantidade: getItemQuantity(item, "a"),
      compareQuantidade:
        periodMode === "compare" ? getItemQuantity(item, "b") : null,
      bairros: item.bairros || [],
      fullHistorico: item.historico || [],
      historico: getItemHistory(item, "a"),
      compareHistorico:
        periodMode === "compare" ? getItemHistory(item, "b") : [],
};
   })
   .filter(Boolean);

 if (!dataItems.length) return null;

 if (dataItems.length === 1) {
   return dataItems[0];
 }

 const bairros = Array.from(
   new Set(dataItems.flatMap((item) => item.bairros || []))
 ).sort();

 return {
  key: "comparacao",
  title: `${dataItems.length} áreas selecionadas`,
  subtitle:
    mode === "regional"
      ? "Comparação entre regionais"
      : "Comparação entre territórios",
  quantidade: dataItems.reduce(
    (sum, item) => sum + Number(item.quantidade || 0),
    0
  ),
  compareQuantidade:
    periodMode === "compare"
      ? dataItems.reduce(
          (sum, item) => sum + Number(item.compareQuantidade || 0),
          0
        )
      : null,
  bairros,
  fullHistorico: aggregateHistory(
    dataItems.map((item) => ({
      ...item,
      historico: item.fullHistorico || item.historico || [],
    }))
  ),
  historico: aggregateHistory(dataItems),
  compareHistorico:
    periodMode === "compare"
      ? aggregateHistory(
          dataItems.map((item) => ({
            ...item,
            historico: item.compareHistorico || [],
          }))
        )
      : [],
  comparisonItems: dataItems,
};

}, [selectedItems, stats, regionalStats, mode, getItemQuantity, getItemHistory, periodMode,
]);


  const fitToGeo = useCallback(() => {
    const map = mapRef.current;
    const layer = geoRef.current;

    if (!map || !layer?.getBounds) return;

    map.invalidateSize?.();

    const bounds = layer.getBounds();

    if (bounds?.isValid()) {
      map.fitBounds(
        bounds,
        getResponsiveFitOptions({
          viewport,
          regionalFilter,
          mode,
          isSelection: false,
        })
      );
    }
  }, [regionalFilter, mode, viewport]);


  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize?.();
      fitToGeo();
    }, 120);

    return () => clearTimeout(timer);
  }, [visibleGeo, viewport, fitToGeo]);


  const getFeatureValue = useCallback(
  (feature) => {
    const id = getFeatId(feature);
    const item = stats?.[id];

    if (!item) return 0;

    if (mode === "regional") {
      return regionalStats?.[item.regionalFormatada]?.quantidade || 0;
    }

    return getItemQuantity(item, "a");
  },
  [stats, regionalStats, mode, getItemQuantity]
);

  const isFeatureSelected = useCallback(
 (feature) => {
   const id = getFeatId(feature);
   const item = stats?.[id];

   if (!item) return false;

   return selectedItems.some((selection) => {
     if (selection.type === "regional") {
       return item.regionalFormatada === selection.key;
     }

     return selection.id === id;
   });
 },
 [selectedItems, stats]
);


  const baseStyle = useCallback(
 (feature) => {
   const value = getFeatureValue(feature);
   const selectedFeature = isFeatureSelected(feature);
   const regionalMode = mode === "regional";

   return {
     color: regionalMode
       ? selectedFeature
         ? "#0f172a"
         : "rgba(37, 99, 235, 0.32)"
       : selectedFeature
         ? "#0f172a"
         : "#2563eb",

     weight: regionalMode
       ? selectedFeature
         ? 2.4
         : 0.7
       : selectedFeature
         ? 3
         : 1.25,

     fillColor: colorScale(value, heatDomainMax),

     fillOpacity: value
       ? selectedFeature
         ? regionalMode
           ? 0.34
           : 0.58
         : regionalMode
           ? 0.22
           : 0.38
       : 0.08,

     opacity: regionalMode ? 0.85 : 0.95,
     dashArray: "0",
   };
 },
 [getFeatureValue, isFeatureSelected, mode, heatDomainMax]
);


  const setRegionalHover = useCallback(
 (regionalKey, hovered) => {
   const layers = regionalLayersRef.current.get(regionalKey);

   if (!layers) return;

   layers.forEach((targetLayer) => {
     if (hovered) {
       targetLayer.setStyle({
         color: "#0f172a",
         weight: 2.6,
         fillOpacity: 0.32,
         opacity: 1,
       });

       targetLayer.bringToFront?.();
     } else if (targetLayer.feature) {
       targetLayer.setStyle(baseStyle(targetLayer.feature));
     }
   });
 },
 [baseStyle]
);


  const handleSelectFeature = useCallback(
  (feature, layer) => {
    const id = getFeatId(feature);
    const item = stats?.[id];

    if (!id || !item) return;

    const nextSelection =
      mode === "regional"
        ? {
            type: "regional",
            key: item.regionalFormatada,
          }
        : {
            type: "territorio",
            id,
          };

    const nextSelectedItems = multiSelect
      ? toggleSelection(selectedItems, nextSelection)
      : [nextSelection];

    setSelectedItems(nextSelectedItems);
    setReportOpen(true);

    const targetBounds =
      mode === "regional"
        ? getRegionalBounds(item.regionalFormatada)
        : layer?.getBounds?.();

    const map = mapRef.current;

    if (map && targetBounds?.isValid()) {
      map.invalidateSize?.();

      map.fitBounds(
        targetBounds,
        getResponsiveFitOptions({
          viewport,
          regionalFilter,
          mode,
          isSelection: true,
        })
      );
    }
  },
  [
    stats,
    mode,
    getRegionalBounds,
    viewport,
    regionalFilter,
    multiSelect,
    selectedItems,
  ]
);


  const onEach = useCallback(
    (feature, layer) => {
      const id = getFeatId(feature);
      const item = stats?.[id];

      if (!id || !item) return;

      layer.feature = feature;

      const total = getItemQuantity(item, "a");
      const regional = item.regionalFormatada;

      if (mode === "regional") {
        if (!regionalLayersRef.current.has(regional)) {
          regionalLayersRef.current.set(regional, new Set());
        }

        regionalLayersRef.current.get(regional).add(layer);

        layer.on("remove", () => {
          regionalLayersRef.current.get(regional)?.delete(layer);
        });
      }

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
          if (mode === "regional") {
            setHoveredRegional(regional);
            setRegionalHover(regional, true);
            return;
          }

          event.target.setStyle({
            weight: 3,
            fillOpacity: 0.58,
          });

          event.target.bringToFront();
        },

        mouseout: (event) => {
          if (mode === "regional") {
            setHoveredRegional((current) =>
              current === regional ? null : current
            );
            setRegionalHover(regional, false);
            return;
          }

          event.target.setStyle(baseStyle(feature));
        },

        click: () => {
          handleSelectFeature(feature, layer);
        },
      });
    },
    [
      stats,
      mode,
      regionalStats,
      baseStyle,
      handleSelectFeature,
      setRegionalHover,
      getItemQuantity,
    ]
  );


  function resetView() {
  setSelectedItems([]);
  setHoveredRegional(null);
  setReportOpen(false);
  fitToGeo();
}

  function changeMode(nextMode) {
    setMode(nextMode);
    setSelectedItems([]);
    setHoveredRegional(null);
    setReportOpen(false);
  }

  function changeRegionalFilter(value) {
    setRegionalFilter(value);
    setSelectedItems([]);
    setHoveredRegional(null);
    setReportOpen(false);
  }

  const selectionKey = selectedItems.map(getSelectionKey).join("|");

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
        attributionControl={false}
        preferCanvas
        className="mapCanvas"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <ZoomControl position="topleft" />
        <ScaleControl position="bottomleft" imperial={false} />

        {visibleGeo && stats && (
          <GeoJSON
            key={`${mode}-${regionalFilter}-${selectionKey || "none"}`}
            ref={geoRef}
            data={visibleGeo}
            style={baseStyle}
            onEachFeature={onEach}
          />
        )}

        {regionalHighlightGeo && (
          <GeoJSON
            key={`regional-highlight-${hoveredRegional || selectionKey || "none"}`}
            data={regionalHighlightGeo}
            style={regionalHighlightStyle}
            interactive={false}
            className="regionalHoverLayer"
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

      <header className={`topBar ${headerExpanded ? "expanded" : "collapsed"}`}>
        <div className="brandBlock">
          <h1>Mapa de Violências</h1>
          <p className="sourceText">Fonte: CRM Fortaleza</p>
        </div>

        {headerExpanded && (
          <div className="topControls">
            <button
              type="button"
              className={`roundMapButton topControlsFilterButton ${
                filtersOpen ? "active" : ""
              }`}
              onClick={() => setFiltersOpen((current) => !current)}
              aria-label={filtersOpen ? "Ocultar filtros" : "Mostrar filtros"}
              title={filtersOpen ? "Ocultar filtros" : "Mostrar filtros"}
            >
              ⚙
            </button>

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
              aria-label="Filtrar por regional"
            >
              <option value="all">Todas as regionais</option>
              {regionalOptions.map((regional) => (
                <option value={regional} key={regional}>
                  {regional}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          className="collapseButton"
          onClick={() => setHeaderExpanded((current) => !current)}
          aria-label={
            headerExpanded ? "Minimizar cabeçalho" : "Expandir cabeçalho"
          }
          title={headerExpanded ? "Minimizar" : "Expandir"}
        >
          {headerExpanded ? "<" : ">"}
        </button>
      </header>

      <div className="mapFloatingActions" aria-label="Ações do mapa">
        {!headerExpanded && (
          <button
            type="button"
            className={`roundMapButton ${filtersOpen ? "active" : ""}`}
            onClick={() => setFiltersOpen((current) => !current)}
            aria-label={filtersOpen ? "Ocultar filtros" : "Mostrar filtros"}
            title={filtersOpen ? "Ocultar filtros" : "Mostrar filtros"}
          >
            ⚙
          </button>
        )}

        <button
          type="button"
          className="roundMapButton"
          onClick={resetView}
          aria-label="Recentrar mapa"
          title="Recentrar mapa"
        >
          ⌖
        </button>

        <button
          type="button"
          className="roundMapButton"
          onClick={() => selectedData && setReportOpen((current) => !current)}
          aria-label={reportOpen ? "Ocultar relatório" : "Mostrar relatório"}
          title={reportOpen ? "Ocultar relatório" : "Mostrar relatório"}
          disabled={!selectedData}
        >
          ▤
        </button>
      </div>

      {filtersOpen && (
        <div className="periodControls">
          <select
            value={periodMode}
            onChange={(event) => setPeriodMode(event.target.value)}
            aria-label="Filtro de período"
          >
            <option value="all">Todo o período</option>
            <option value="range">Período específico</option>
            <option value="compare">Comparar períodos</option>
          </select>

          <label className="checkboxControl">
            <input
              type="checkbox"
              checked={multiSelect}
              onChange={(event) => {
                const checked = event.target.checked;
                setMultiSelect(checked);

                if (!checked) {
                  setSelectedItems((current) => current.slice(0, 1));
                }
              }}
            />
            Comparar seleção
          </label>

          {periodMode !== "all" && (
            <>
              <select
                value={periodA.start}
                onChange={(event) =>
                  setPeriodA((current) => ({
                    ...current,
                    start: event.target.value,
                  }))
                }
              >
                <option value="">Período 1</option>
                {monthOptions.map((month) => (
                  <option key={month.key} value={month.key}>
                    {month.label}
                  </option>
                ))}
              </select>

              <select
                value={periodA.end}
                onChange={(event) =>
                  setPeriodA((current) => ({
                    ...current,
                    end: event.target.value,
                  }))
                }
              >
                <option value="">Fim A</option>
                {monthOptions.map((month) => (
                  <option key={month.key} value={month.key}>
                    {month.label}
                  </option>
                ))}
              </select>
            </>
          )}

          {periodMode === "compare" && (
            <>
              <select
                value={periodB.start}
                onChange={(event) =>
                  setPeriodB((current) => ({
                    ...current,
                    start: event.target.value,
                  }))
                }
              >
                <option value="">Período 2</option>
                {monthOptions.map((month) => (
                  <option key={month.key} value={month.key}>
                    {month.label}
                  </option>
                ))}
              </select>

              <select
                value={periodB.end}
                onChange={(event) =>
                  setPeriodB((current) => ({
                    ...current,
                    end: event.target.value,
                  }))
                }
              >
                <option value="">Fim B</option>
                {monthOptions.map((month) => (
                  <option key={month.key} value={month.key}>
                    {month.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      <Legend
        steps={legendSteps}
        scaleMax={scaleMax}
        heatDomainMax={heatDomainMax}
        adaptiveLegendMax={adaptiveLegendMax}
        scaleMaxOverride={scaleMaxOverride}
        onScaleMaxChange={setScaleMaxOverride}
        onAutoScale={() => setScaleMaxOverride(null)}
        scaleControlOpen={scaleControlOpen}
        onToggleScaleControl={() =>
          setScaleControlOpen((current) => !current)
        }
      />

      {selectedData && reportOpen && (
        <DetailsPanel
          selectedData={selectedData}
          mode={mode}
          periodMode={periodMode}
          onClose={() => {
            setSelectedItems([]);
            setReportOpen(false);
          }}
          onMonthClick={applySingleMonthFilter}
          selectedMonthKey={selectedMonthKey}
        />
      )}

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

        .legendControl {
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid rgba(148, 163, 184, 0.28);
        }

        .legendControlHeader {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
        color: #334155;
        font-size: 11px;
        font-weight: 800;
        }

        .legendControl input {
        width: 100%;
        }

        .legendAutoButton {
        margin-top: 6px;
        width: 100%;
        height: 28px;
        border: 0;
        border-radius: 10px;
        background: #e2e8f0;
        color: #0f172a;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
        }

        .legendAutoButton:disabled {
        opacity: 0.55;
        cursor: default;
        }

        .periodControls {
        position: absolute;
        top: 86px;
        left: 18px;
        right: 18px;
        z-index: 1090;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        padding: 10px 12px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.1);
        backdrop-filter: blur(12px);
        }

        .periodControls select {
        min-width: 150px;
        }

        .comparisonList {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .comparisonItem {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 11px;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        background: #f8fafc;
      }

      .comparisonItem strong,
      .comparisonItem span,
      .comparisonItem small {
        display: block;
      }

      .comparisonItem > div:first-child strong {
        color: #0f172a;
        font-size: 13px;
      }

      .comparisonItem > div:first-child span {
        margin-top: 3px;
        color: #64748b;
        font-size: 11px;
        font-weight: 700;
      }

      .comparisonNumbers {
        min-width: 92px;
        text-align: right;
      }

      .comparisonNumbers strong {
        color: #0f172a;
        font-size: 16px;
      }

      .comparisonNumbers small {
        margin-top: 3px;
        color: #64748b;
        font-size: 11px;
        font-weight: 750;
      }

      .periodComparisonGrid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .periodMetricCard {
        padding: 12px;
        border: 1px solid #e2e8f0;
        border-radius: 15px;
        background: #f8fafc;
      }

      .periodMetricCard.wide {
        grid-column: 1 / -1;
      }

      .periodMetricCard span {
        display: block;
        margin-bottom: 4px;
        color: #64748b;
        font-size: 11px;
        font-weight: 800;
      }

      .periodMetricCard strong {
        display: block;
        color: #0f172a;
        font-size: 22px;
        line-height: 1.1;
        letter-spacing: -0.04em;
      }

      .periodMetricCard small {
        display: block;
        margin-top: 4px;
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
      }

      .periodHistoryGrid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 12px;
        margin-top: 12px;
      }

      .periodHistoryGrid h4 {
        margin: 0 0 8px;
        color: #334155;
        font-size: 12px;
        font-weight: 900;
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
          top: 188px;
          left: 18px;
        }

        .leaflet-top .leaflet-control {
          margin-top: 26px;
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

        .temporalChart {
        height: 140px;
        padding: 10px;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        background: #f8fafc;
        color: #2563eb;
        }

        .temporalChart svg {
        width: 100%;
        height: 100%;
        display: block; 
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

        .leaflet-control-attribution {
          display: none !important;
        }

      .mapPage {
        height: 100svh;
        height: 100dvh;
      }

      @media (max-width: 900px) {
        .mapPage {
          height: 100svh;
          height: 100dvh;
        }

        .topBar {
          top: max(8px, env(safe-area-inset-top));
          left: 8px;
          right: 8px;
          z-index: 1120;
          flex-direction: column;
          align-items: stretch;
          gap: 10px;
          padding: 12px;
          border-radius: 18px;
        }

        .topBar h1 {
          font-size: 18px;
        }

        .sourceText {
          font-size: 10px;
        }

        .topControls {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .segmented {
          grid-column: 1 / -1;
          width: 100%;
        }

        .segmented button {
          flex: 1;
          padding: 8px 10px;
          font-size: 12px;
        }

        select {
          width: 100%;
          min-width: 0;
          height: 40px;
          padding: 8px 10px;
          font-size: 12px;
        }

        .ghostButton {
          width: 100%;
          height: 40px;
          padding: 8px 10px;
          font-size: 12px;
        }

        .detailsPanel {
          top: auto;
          left: 8px;
          right: 8px;
          bottom: max(8px, env(safe-area-inset-bottom));
          width: auto;
          max-height: min(42svh, 315px);
          padding: 14px;
          border-radius: 18px;
          z-index: 1060;
        }

        .detailsPanel.compact {
          display: none;
        }

        .panelHeader h2 {
          font-size: 19px;
        }

        .metricGrid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin: 12px 0;
        }

        .metricCard {
          padding: 10px;
          border-radius: 14px;
        }

        .metricCard strong {
          font-size: 20px;
        }

        .historyRow {
          grid-template-columns: 88px 1fr 28px;
          gap: 6px;
        }

        .historyMonth,
        .historyValue {
          font-size: 11px;
        }

        .legend {
          display: none;
        }

        .leaflet-top.leaflet-left {
          top: 148px;
          left: 8px;
        }

        .leaflet-bottom.leaflet-left {
          bottom: 8px;
          left: 8px;
        }

        .mapTooltip {
          min-width: 140px;
          max-width: 180px;
        }

        .errorToast {
          left: 8px;
          right: 8px;
          bottom: max(8px, env(safe-area-inset-bottom));
          transform: none;
          max-width: none;
        }
      }

      @media (max-width: 760px) and (max-height: 520px) {
        .topBar {
          flex-direction: row;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 14px;
        }

        .topBar h1 {
          font-size: 16px;
          white-space: nowrap;
        }

        .sourceText {
          display: none;
        }

        .topControls {
          flex: 1;
          width: auto;
          display: grid;
          grid-template-columns: auto minmax(128px, 1fr) auto;
          gap: 6px;
          align-items: center;
        }

        .segmented {
          grid-column: auto;
        }

        .segmented button {
          padding: 7px 9px;
          font-size: 11px;
        }

        select {
          height: 34px;
          padding: 6px 8px;
          font-size: 11px;
        }

        .ghostButton {
          height: 34px;
          padding: 6px 10px;
          font-size: 11px;
          white-space: nowrap;
        }

        .detailsPanel {
          top: 72px;
          right: 8px;
          left: auto;
          bottom: 8px;
          width: min(300px, 44vw);
          max-height: none;
          padding: 12px;
          border-radius: 16px;
        }

        .detailsPanel.compact {
          display: none;
        }

        .panelHeader {
          margin-bottom: 10px;
        }

        .panelHeader h2 {
          font-size: 17px;
        }

        .panelSubtitle {
          font-size: 11px;
        }

        .metricGrid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
          margin: 10px 0;
        }

        .metricCard {
          padding: 8px;
        }

        .metricCard span {
          font-size: 10px;
        }

        .metricCard strong {
          font-size: 18px;
        }

        .insightBox {
          margin-bottom: 10px;
          padding: 9px 10px;
          font-size: 11px;
        }

        .panelSection {
          margin-top: 12px;
        }

        .sectionHeader h3 {
          font-size: 13px;
        }

        .historyRow {
          grid-template-columns: 76px 1fr 24px;
        }

        .chips {
          gap: 5px;
        }

        .chip {
          padding: 5px 7px;
          font-size: 10px;
        }

        .leaflet-top.leaflet-left {
          top: 72px;
          left: 8px;
        }

        .leaflet-bottom.leaflet-left {
          bottom: 8px;
          left: 8px;
        }
      }


        .brandBlock {
          flex: 0 0 auto;
          min-width: 0;
        }

        .topBar {
          transition:
            max-width 260ms ease,
            padding 260ms ease,
            transform 260ms ease,
            border-radius 260ms ease;
        }

        .topBar.collapsed {
          right: auto;
          max-width: 360px;
          min-width: 260px;
        }

        .topBar.expanded {
          max-width: calc(100vw - 36px);
        }

        .collapseButton,
        .roundMapButton,
        .legendToggleButton {
          border: 0;
          font: inherit;
        }

        .collapseButton {
          flex: 0 0 auto;
          cursor: pointer;
          width: 34px;
          height: 34px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: #ffffff;
          color: #6963a5;
          font-size: 26px;
          font-weight: 900;
          line-height: 1;

          border: none;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
        }

        .mapFloatingActions {
          position: absolute;
          top: 94px;
          left: 28px;
          z-index: 1110;
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .roundMapButton {
          cursor: pointer;
          width: 42px;
          height: 42px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(255, 255, 255, 0.94);
          color: #0f172a;
          box-shadow: 0 14px 30px rgba(15, 23, 42, 0.14);
          backdrop-filter: blur(12px);
          font-size: 18px;
          font-weight: 900;
        }

        .roundMapButton.active {
          background: #6963a5;
          color: #ffffff;
          border-color: rgba(255, 255, 255, 0.75);
        }

        .roundMapButton:disabled {
          cursor: not-allowed;
          opacity: 0.48;
        }

        .topControlsFilterButton {
          width: 40px;
          height: 40px;
          box-shadow: none;
        }

        .periodControls {
          top: 88px;
          right: auto;
          width: min(760px, calc(100vw - 36px));
          align-items: center;
          animation: filterSlideDown 180ms ease both;
        }

        @keyframes filterSlideDown {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .checkboxControl {
          min-height: 40px;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 0 10px;
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          background: #ffffff;
          color: #0f172a;
          font-size: 13px;
          font-weight: 700;
          white-space: nowrap;
        }

        .legendHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }

        .legendTitle {
          margin-bottom: 0;
        }

        .legendToggleButton {
          cursor: pointer;
          width: 30px;
          height: 30px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          background: #f1f5f9;
          color: #0f172a;
          font-size: 15px;
          font-weight: 900;
        }

        .temporalPoint {
          cursor: pointer;
          outline: none;
        }

        .temporalPoint circle {
          transition: r 160ms ease, opacity 160ms ease;
        }

        .temporalPoint:hover circle,
        .temporalPoint:focus-visible circle,
        .temporalPoint.active circle {
          opacity: 0.82;
        }

        .regionalHoverLayer {
          pointer-events: none;
        }

        @media (min-width: 901px) {
          .topBar.collapsed + .mapFloatingActions {
            top: 154px;
          }

          .topBar.expanded + .mapFloatingActions {
            top: 154px;
          }
        }

        @media (max-width: 900px) {
          .topBar {
            transition:
              max-height 260ms ease,
              padding 260ms ease,
              transform 260ms ease;
          }

          .topBar.collapsed {
            max-width: none;
            min-width: 0;
            max-height: 76px;
            flex-direction: row;
            align-items: center;
          }

          .topBar.expanded {
            max-height: 230px;
          }

          .collapseButton {
            width: 32px;
            height: 32px;
            transform: rotate(90deg);
          }

          .mapFloatingActions {
            top: 84px;
            left: 8px;
            gap: 7px;
          }

          .roundMapButton {
            width: 38px;
            height: 38px;
            font-size: 16px;
          }

          .periodControls {
            top: 128px;
            left: 8px;
            right: 8px;
            width: auto;
            padding: 8px;
            gap: 7px;
          }

          .checkboxControl {
            width: 100%;
            min-height: 38px;
            font-size: 12px;
          }

          .detailsPanel .panelSection {
            display: none;
          }

          .detailsPanel {
            max-height: min(36svh, 250px);
          }

          .insightBox {
            margin-bottom: 0;
          }
        }

        @media (max-width: 760px) and (max-height: 520px) {
          .mapFloatingActions {
            top: 64px;
          }

          .periodControls {
            top: 104px;
          }
        }

      `}</style>
    </div>
  );
}